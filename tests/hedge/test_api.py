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
    settings_override(hedge_ingest_token=TOKEN, hedge_ingest_username="owner")
    hedge_service.CACHE.clear()
    TRACKER.reset()
    from optionflow.modules.auth import service as auth
    auth.create_user("owner", PASSWORD)
    auth.create_user("other", PASSWORD)
    app = create_app(Settings(_env_file=None, jwt_secret="test-secret-do-not-use-in-prod",
                              jwt_audience="optionflow-app", jwt_issuer="optionflow-api",
                              hedge_ingest_token=TOKEN, hedge_ingest_username="owner"))
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
    assert c.post("/api/v1/hedge/ingest", json={**BODY, "username": "ghost"}, headers=h).status_code == 403
    assert c.post("/api/v1/hedge/ingest", json={**BODY, "username": "other"}, headers=h).status_code == 403   # real user, not bound
    assert c.post("/api/v1/hedge/ingest", json={**BODY, "username": " OWNER "}, headers=h).status_code == 200
    big = {**BODY, "activity": [{"ext_id": f"x{i}", "kind": "realized", "ts": "2026-01-01T00:00:00Z", "symbol": "X"}
                                for i in range(20001)]}
    assert c.post("/api/v1/hedge/ingest", json=big, headers=h).status_code == 422


def test_ingest_disabled_without_bound_username(client, settings_override):
    c, _ = client
    settings_override(hedge_ingest_username="")
    assert c.post("/api/v1/hedge/ingest", json=BODY, headers={"X-Hedge-Ingest-Token": TOKEN}).status_code == 403


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
    fake.price_history = lambda s, p, i: pd.DataFrame({"close": closes})
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


def _daily(n=1600, start=100.0, drift=0.0004, seed=3):
    import random
    rnd = random.Random(seed)
    idx = pd.bdate_range(end=pd.Timestamp.today().normalize(), periods=n)
    px, p = [], start
    for _ in range(n):
        p *= 1 + rnd.gauss(drift, 0.015); px.append(p)
    return pd.DataFrame({"open": px, "high": [x * 1.01 for x in px], "low": [x * 0.99 for x in px], "close": px,
                         "volume": [1_000_000] * n}, index=idx)


def _signal_market(fake, spot):
    rows = [{"strike": float(k), "expiry": EXP, "otype": t, "oi": 100, "volume": 10, "iv": 0.30, "mid": 1.5,
             "gamma": float("nan"), "T": 5.25 / 365} for k in range(80, 130, 5) for t in ("call", "put")]
    fake.chain_fn = lambda s: OptionChain(spot, pd.DataFrame(rows, columns=CHAIN_COLUMNS))
    fake.last_price = lambda s: spot
    fake.quote = lambda s: {"symbol": s, "price": spot, "prev_close": spot, "change": 0.0, "change_pct": 0.0}
    hist = _daily()
    vix = _daily(seed=9) / 5
    fake.price_history = lambda s, p, i: vix if s == "^VIX" else hist


def test_signal_for_a_ticker_not_held_is_an_entry_decision(client):
    c, fake = client
    _signal_market(fake, 106.0)
    r = c.get("/api/v1/hedge/signal/abc", headers=_login(c, "owner"))
    assert r.status_code == 200
    d = r.json()
    assert d["symbol"] == "ABC" and d["held"] == "none" and d["error"] is None
    assert d["label"] in {"Buy", "Wait", "Don't buy yet"}
    assert not d["signal"]["headline"].startswith(("Hold", "Add", "Don’t add"))
    assert d["signal"]["probability"]["case"] in {"ADD", "LEAN", "CAUTION", "HOLD"}
    assert d["reasons"] and d["reasons"][0].startswith("Odds (2015–2026, unseen)")
    assert "plan" in d["signal"] and isinstance(d["signal"]["plan"]["lines"], list)
    assert c.get("/api/v1/hedge/signal/abc").status_code == 401
    assert c.get("/api/v1/hedge/signal/a$b", headers=_login(c, "owner")).status_code == 400


def test_signal_for_a_leaps_holding_is_the_hedge_desk_signal(client):
    c, fake = client
    _signal_market(fake, 106.0)
    leaps = (date.today() + timedelta(days=400)).isoformat()
    body = {"username": "owner", "positions": [{"account": "Trading ••8453", "symbol": "XYZ", "kind": "option", "quantity": 2,
                                                "avg_price": 20.0, "option_type": "call", "strike": 90, "expiry": leaps}]}
    assert c.post("/api/v1/hedge/ingest", json=body, headers={"X-Hedge-Ingest-Token": TOKEN}).status_code == 200
    h = _login(c, "owner")
    sig = c.get("/api/v1/hedge/signal/XYZ", headers=h).json()
    book = next(b for b in c.get("/api/v1/hedge/books", headers=h).json()["books"] if b["symbol"] == "XYZ")
    assert sig["held"] == "long_options" and book["strategy"] == "long_stock"
    for k in ("verdict", "headline", "score", "probability", "legs"):           # the stock page reads the desk's own signal
        assert sig["signal"][k] == book["signal"][k]
    assert sig["label"] in {"Add", "Hold", "Don't add", "Roll"}
    assert book["suggestion"]["reasons"][:len(sig["reasons"])] == sig["reasons"]
    other = c.get("/api/v1/hedge/signal/XYZ", headers=_login(c, "other")).json()  # another user doesn't hold it
    assert other["held"] == "none" and other["label"] in {"Buy", "Wait", "Don't buy yet"}


def test_signal_scan_ranks_by_fear_score_and_marks_holdings(client):
    from optionflow.modules.hedge import scan as sc
    c, fake = client
    _signal_market(fake, 106.0)
    out = sc.build(["AAA", "BBB", "CCC"])
    assert {r["symbol"] for r in out["rows"]} == {"AAA", "BBB", "CCC"} and not out["failed"]
    r = out["rows"][0]
    assert r["label"] in {"Buy", "Wait", "Don't buy yet"} and r["case"] in {"ADD", "LEAN", "CAUTION", "HOLD"}
    assert r["headline"].startswith(("Buy", "Wait", "Don’t buy yet"))
    body = {"username": "owner", "positions": [{"account": "x", "symbol": "BBB", "kind": "stock", "quantity": 10, "avg_price": 90.0}]}
    assert c.post("/api/v1/hedge/ingest", json=body, headers={"X-Hedge-Ingest-Token": TOKEN}).status_code == 200
    d = c.get("/api/v1/hedge/scan", headers=_login(c, "owner")).json()
    assert d["universe"] == 100 and d["score_cut"] == 0.283 and d["universe_key"] == "popular"
    assert [x["symbol"] for x in d["rows"] if x["held"]] == ["BBB"]
    assert c.get("/api/v1/hedge/scan").status_code == 401


def test_signal_scan_has_an_sp500_universe(client):
    from optionflow.modules.hedge import scan as sc
    c, fake = client
    _signal_market(fake, 106.0)
    assert len(sc.UNIVERSES["sp500"]) >= 500 and "BRK-B" in sc.UNIVERSES["sp500"]
    sc.build(["AAA", "BBB"], universe="sp500")
    d = c.get("/api/v1/hedge/scan?universe=sp500", headers=_login(c, "owner")).json()
    assert d["universe_key"] == "sp500" and d["universe"] == len(sc.UNIVERSES["sp500"])
    assert {r["symbol"] for r in d["rows"]} == {"AAA", "BBB"}
    assert c.get("/api/v1/hedge/scan?universe=nope", headers=_login(c, "owner")).status_code == 422


def test_signal_scan_breaks_fear_score_ties_by_rsi():
    from optionflow.modules.hedge import scan as sc
    rows = [{"symbol": s, "fear_score": f, "rsi": r, "vs_50d": d} for s, f, r, d in
            (("AAA", 0.362, 19.0, -0.24), ("BBB", 0.362, 11.0, -0.24), ("CCC", 0.40, 30.0, -0.1), ("DDD", 0.362, 11.0, -0.30))]
    key = lambda r: (-round(r["fear_score"] or 0.0, 3), r["rsi"] if r["rsi"] is not None else 100.0,
                     r["vs_50d"] if r["vs_50d"] is not None else 1.0, r["symbol"])
    assert [r["symbol"] for r in sorted(rows, key=key)] == ["CCC", "DDD", "BBB", "AAA"]
    import inspect
    assert "r[\"rsi\"] if r[\"rsi\"] is not None else 100.0" in inspect.getsource(sc.build)
