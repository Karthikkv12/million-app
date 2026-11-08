"""/hedge API: ingest auth + replace, per-user isolation, books from a fake market."""
import math
from datetime import date, timedelta

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from optionflow.core.settings import Settings
from optionflow.main import create_app
from optionflow.modules.hedge import service as hedge_service
from optionflow.modules.hedge.ivtrack import TRACKER
from optionflow.providers.market_data import CHAIN_COLUMNS, OptionChain

TOKEN = "test-ingest-token-0123456789"
PASSWORD = "HedgePassword123"
EXP = (date.today() + timedelta(days=5)).isoformat()


@pytest.fixture
def client(db_engine_and_session, settings_override, fake_market_data):
    settings_override(hedge_ingest_token=TOKEN)
    hedge_service.CACHE.clear()
    TRACKER.reset()
    from optionflow.modules.auth import service as auth
    auth.create_user("owner", PASSWORD)
    auth.create_user("other", PASSWORD)
    app = create_app(Settings(_env_file=None, jwt_secret="test-secret-do-not-use-in-prod",
                              jwt_audience="optionflow-app", jwt_issuer="optionflow-api",
                              hedge_ingest_token=TOKEN))
    c = TestClient(app)
    yield c, fake_market_data
    hedge_service.CACHE.clear()


def _login(c, username):
    r = c.post("/api/v1/auth/login", json={"username": username, "password": PASSWORD})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


BODY = {"username": "owner", "positions": [
    {"account": "Trading ••8453", "symbol": "xyz", "kind": "stock", "quantity": 100, "avg_price": 100.0},
    {"account": "Trading ••8453", "symbol": "XYZ", "kind": "option", "quantity": -1, "avg_price": 1.0,
     "option_type": "call", "strike": 101, "expiry": EXP},
]}


def test_ingest_requires_token(client):
    c, _ = client
    assert c.post("/api/v1/hedge/ingest", json=BODY).status_code == 401
    assert c.post("/api/v1/hedge/ingest", json=BODY, headers={"X-Hedge-Ingest-Token": "nope"}).status_code == 401


def test_ingest_disabled_without_configured_token(client, settings_override):
    c, _ = client
    settings_override(hedge_ingest_token="")
    assert c.post("/api/v1/hedge/ingest", json=BODY, headers={"X-Hedge-Ingest-Token": ""}).status_code == 401


def test_ingest_replaces_and_is_per_user(client):
    c, _ = client
    h = {"X-Hedge-Ingest-Token": TOKEN}
    assert c.post("/api/v1/hedge/ingest", json=BODY, headers=h).json()["count"] == 2
    assert c.post("/api/v1/hedge/ingest", json=BODY, headers=h).json()["count"] == 2   # replaced, not appended
    mine = c.get("/api/v1/hedge/positions", headers=_login(c, "owner")).json()
    assert len(mine) == 2 and {p["symbol"] for p in mine} == {"XYZ"}
    assert c.get("/api/v1/hedge/positions", headers=_login(c, "other")).json() == []
    bad = {"username": "owner", "positions": [{"symbol": "X", "kind": "option", "quantity": -1}]}
    assert c.post("/api/v1/hedge/ingest", json=bad, headers=h).status_code == 422
    assert c.post("/api/v1/hedge/ingest", json={**BODY, "username": "ghost"}, headers=h).status_code == 404


def test_books_compute_live_delta_and_suggestion(client):
    c, fake = client
    spot = 106.0
    rows = []
    for k in range(95, 112):
        for t in ("call", "put"):
            rows.append({"strike": float(k), "expiry": EXP, "otype": t, "oi": 100, "volume": 10,
                         "iv": 0.30, "mid": 1.5, "gamma": float("nan"), "T": 5.25 / 365})
    fake.chain_fn = lambda s: OptionChain(spot, pd.DataFrame(rows, columns=CHAIN_COLUMNS))
    fake.last_price = lambda s: spot
    fake.quote = lambda s: {"symbol": s, "price": spot, "prev_close": 105.0, "change": 1.0, "change_pct": 0.95}
    closes = [100 * math.exp(0.01 * (i % 2)) for i in range(80)]
    fake.price_history = lambda s, p, i: pd.DataFrame({"Close": closes})
    c.post("/api/v1/hedge/ingest", json=BODY, headers={"X-Hedge-Ingest-Token": TOKEN})

    r = c.get("/api/v1/hedge/books", headers=_login(c, "owner"))
    assert r.status_code == 200
    data = r.json()
    assert data["synced_at"] and len(data["books"]) == 1
    b = data["books"][0]
    assert b["error"] is None and b["symbol"] == "XYZ" and b["spot"] == 106.0
    assert b["shares"] == 100 and b["avg_cost"] == 100.0
    call = next(l for l in b["legs"] if l["kind"] == "option")
    assert call["iv"] == 0.30 and 0.9 < call["delta"] < 1.0               # deep ITM short 101C
    assert b["net_delta"] == pytest.approx(1 - call["delta"], abs=1e-3)
    assert b["net_gamma"] < 0                                             # short option = short gamma
    assert b["iv"]["atm_iv"] == pytest.approx(0.30) and b["iv"]["hv20"] > 0
    assert b["weekly_expiry"] == EXP
    assert b["suggestion"]["action"] in {"SELL_PUT", "WAIT", "HOLD"}
    assert c.get("/api/v1/hedge/books").status_code == 401


def test_stream_sends_books_event(client):
    c, fake = client
    fake.last_price = lambda s: 50.0
    c.post("/api/v1/hedge/ingest", json={"username": "owner", "positions": [
        {"symbol": "ABC", "kind": "stock", "quantity": 200, "avg_price": 40}]}, headers={"X-Hedge-Ingest-Token": TOKEN})
    tok = _login(c, "owner")["Authorization"].split()[1]
    with c.stream("GET", f"/api/v1/hedge/stream?limit=1&access_token={tok}") as r:
        body = "".join(r.iter_text())
    assert "event: books" in body and '"symbol":"ABC"' in body and '"net_delta":2.0' in body
