"""HTTP contract tests for the auth, admin, market, flow and watchlist routes.

Written against the pre-step-4 routers to pin their behaviour, then run
against every prefix the API serves (legacy root paths and /api/v1).
"""
import time

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend_api.main import app
from conftest import make_memory_engine
from optionflow.core import db as core_db
from optionflow.modules.flow import service as flow_service
from optionflow.modules.flow.gamma import GEXResult

PREFIXES = [""]

PASSWORD = "GoodPassword12"


@pytest.fixture(params=PREFIXES, ids=lambda p: p or "legacy")
def prefix(request):
    return request.param


@pytest.fixture
def api(prefix, fake_market_data):
    """(client, url) with a fresh in-memory DB, a fake market-data provider and a fresh limiter."""
    engine = make_memory_engine()
    core_db.use_engine(engine)
    client = TestClient(app)
    try:
        yield client, (lambda path: prefix + path)
    finally:
        core_db.use_engine(None)
        engine.dispose()


def _user(username="alice", role="user"):
    from logic import auth_services
    return auth_services.create_user(username, PASSWORD, role=role)


def _login(client, url, username="alice", password=PASSWORD):
    return client.post(url("/auth/login"), json={"username": username, "password": password})


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


def _error_text(resp):
    body = resp.json()
    if "detail" in body:
        return body["detail"]
    return body["error"]["message"]


# ── Auth ──────────────────────────────────────────────────────────────────────
def test_login_success_and_me(api):
    client, url = api
    uid = _user()
    r = _login(client, url, username="  Alice ")            # trimmed + lowercased
    assert r.status_code == 200
    body = r.json()
    assert body["user_id"] == uid and body["username"] == "alice" and body["role"] == "user"
    assert body["token_type"] == "bearer" and body["access_token"] and body["refresh_token"]
    me = client.get(url("/auth/me"), headers=_bearer(body["access_token"]))
    assert me.status_code == 200 and me.json() == {"user_id": uid, "username": "alice", "role": "user"}


def test_login_wrong_password_401_and_logged(api):
    client, url = api
    _user()
    r = _login(client, url, password="WrongPassword99")
    assert r.status_code == 401 and _error_text(r) == "Invalid username or password"


def test_login_rate_limited_429(api, settings_override):
    client, url = api
    _user()
    settings_override(login_rate_limit_max_failures=2)
    for _ in range(2):
        assert _login(client, url, password="WrongPassword99").status_code == 401
    r = _login(client, url)
    assert r.status_code == 429 and "Too many login attempts" in _error_text(r)


def test_missing_and_bad_token_401(api):
    client, url = api
    assert client.get(url("/auth/me")).status_code == 401
    assert client.get(url("/auth/me"), headers=_bearer("not-a-jwt")).status_code == 401


def test_signup_closed_403(api):
    client, url = api
    r = client.post(url("/auth/signup"), json={"username": "bob", "password": PASSWORD})
    assert r.status_code == 403


def test_refresh_rotates_and_old_token_dies(api):
    client, url = api
    uid = _user()
    rt = _login(client, url).json()["refresh_token"]
    r = client.post(url("/auth/refresh"), json={"refresh_token": rt})
    assert r.status_code == 200
    body = r.json()
    assert body["user_id"] == uid and body["username"] == "alice" and body["refresh_token"] != rt
    again = client.post(url("/auth/refresh"), json={"refresh_token": rt})
    assert again.status_code == 401 and _error_text(again) == "Invalid refresh token"


def test_logout_revokes_access_and_refresh(api):
    client, url = api
    _user()
    tokens = _login(client, url).json()
    r = client.post(url("/auth/logout"), json={"refresh_token": tokens["refresh_token"]},
                    headers=_bearer(tokens["access_token"]))
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    assert client.get(url("/auth/me"), headers=_bearer(tokens["access_token"])).status_code == 401
    assert client.post(url("/auth/refresh"), json={"refresh_token": tokens["refresh_token"]}).status_code == 401


def test_logout_all_invalidates_existing_tokens(api):
    client, url = api
    _user()
    a = _login(client, url).json()
    b = _login(client, url).json()
    r = client.post(url("/auth/logout-all"), headers=_bearer(a["access_token"]))
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    assert client.get(url("/auth/me"), headers=_bearer(b["access_token"])).status_code == 401
    assert client.post(url("/auth/refresh"), json={"refresh_token": b["refresh_token"]}).status_code == 401


def test_change_password(api):
    client, url = api
    _user()
    tok = _login(client, url).json()["access_token"]
    # The new token's iat is the old token's iat + 1s; real users change their
    # password long after login, so wait past that second like they would.
    time.sleep(1.1)
    bad = client.post(url("/auth/change-password"), headers=_bearer(tok),
                      json={"current_password": "nope", "new_password": "NewPassword123"})
    assert bad.status_code == 400
    ok = client.post(url("/auth/change-password"), headers=_bearer(tok),
                     json={"current_password": PASSWORD, "new_password": "NewPassword123"})
    assert ok.status_code == 200
    body = ok.json()
    assert body["username"] == "alice" and body["access_token"] and body["refresh_token"]
    assert client.get(url("/auth/me"), headers=_bearer(tok)).status_code == 401          # old token dead
    assert client.get(url("/auth/me"), headers=_bearer(body["access_token"])).status_code == 200
    assert _login(client, url, password="NewPassword123").status_code == 200


def test_sessions_events_and_revoke(api):
    client, url = api
    _user()
    tok = _login(client, url).json()["access_token"]
    sessions = client.get(url("/auth/sessions"), headers=_bearer(tok))
    assert sessions.status_code == 200 and len(sessions.json()) == 1
    assert set(sessions.json()[0]) == {"id", "created_at", "last_used_at", "ip", "user_agent", "expires_at"}
    events = client.get(url("/auth/events"), headers=_bearer(tok))
    assert events.status_code == 200 and events.json()[0]["event_type"] == "login"
    sid = sessions.json()[0]["id"]
    assert client.post(url(f"/auth/sessions/{sid + 999}/revoke"), headers=_bearer(tok)).status_code == 404
    r = client.post(url(f"/auth/sessions/{sid}/revoke"), headers=_bearer(tok))
    assert r.status_code == 200 and r.json() == {"status": "ok"}


# ── Admin ─────────────────────────────────────────────────────────────────────
def _admin_token(client, url):
    _user("root", role="admin")
    return _login(client, url, username="root").json()["access_token"]


def test_admin_requires_admin_role(api):
    client, url = api
    _user()
    tok = _login(client, url).json()["access_token"]
    assert client.get(url("/admin/users"), headers=_bearer(tok)).status_code == 403


def test_admin_user_lifecycle(api):
    client, url = api
    h = _bearer(_admin_token(client, url))
    users = client.get(url("/admin/users"), headers=h)
    assert users.status_code == 200 and [u["username"] for u in users.json()] == ["root"]
    created = client.post(url("/admin/users"), headers=h, json={"username": "bob", "password": PASSWORD})
    assert created.status_code == 201
    bob = created.json()
    assert set(bob) == {"user_id", "username", "role", "is_active", "created_at"} and bob["role"] == "user"
    assert client.post(url("/admin/users"), headers=h, json={"username": "bob", "password": PASSWORD}).status_code == 409
    assert client.patch(url(f"/admin/users/{bob['user_id']}"), headers=h, json={}).status_code == 422
    p = client.patch(url(f"/admin/users/{bob['user_id']}"), headers=h, json={"role": "admin", "is_active": False})
    assert p.status_code == 200 and p.json()["role"] == "admin" and p.json()["is_active"] is False
    assert client.patch(url("/admin/users/9999"), headers=h, json={"role": "user"}).status_code == 404
    assert client.delete(url(f"/admin/users/{bob['user_id']}"), headers=h).status_code == 204
    assert client.delete(url("/admin/users/9999"), headers=h).status_code == 404


# ── Market ────────────────────────────────────────────────────────────────────
def test_market_routes(api, fake_market_data):
    client, url = api
    _user()
    h = _bearer(_login(client, url).json()["access_token"])
    fake_market_data.search = lambda q, limit: [{"symbol": "AAPL", "name": "Apple", "type": "Equity", "exchange": "NASDAQ"}] * 3
    fake_market_data.quote = lambda s: {"symbol": s, "price": 10.0, "prev_close": 8.0, "change": 2.0, "change_pct": 25.0}
    fake_market_data.last_price = lambda s: 123.456789
    fake_market_data.stock_info = lambda s: {"symbol": s, "name": "Apple", "error": None}
    idx = pd.DatetimeIndex(["2026-11-05", "2026-11-06"], tz="UTC")
    fake_market_data.price_history = lambda s, p, i: pd.DataFrame(
        {"open": [1.0, 2.0], "high": [1.0, 2.0], "low": [1.0, 2.0], "close": [1.5, 2.5], "volume": [5, 6]}, index=idx)

    assert client.get(url("/search/tickers"), params={"q": ""}).json() == []
    s = client.get(url("/search/tickers"), params={"q": "app", "limit": 2})          # no auth needed
    assert s.status_code == 200 and len(s.json()) == 2 and s.json()[0]["symbol"] == "AAPL"
    q = client.get(url("/market/quotes"), params={"symbols": "spy, qqq"})            # no auth needed
    assert q.status_code == 200 and [x["symbol"] for x in q.json()] == ["SPY", "QQQ"]
    assert client.get(url("/market/quotes"), params={"symbols": ""}).status_code == 400
    lq = client.get(url("/quote/aapl"), headers=h)
    assert lq.json() == {"symbol": "AAPL", "price": 123.4568, "from_cache": False}
    info = client.get(url("/stocks/aapl/info"), headers=h)
    assert info.status_code == 200 and info.json()["name"] == "Apple"
    hist = client.get(url("/stocks/aapl/history"), headers=h, params={"period": "5d", "interval": "1d"})
    assert hist.json()["current_price"] == 2.5 and hist.json()["bars"][0]["date"] == "2026-11-05"
    assert client.get(url("/stocks/aapl/info")).status_code == 401


# ── Flow ──────────────────────────────────────────────────────────────────────
def test_flow_routes(api, monkeypatch):
    client, url = api
    _user()
    h = _bearer(_login(client, url).json()["access_token"])
    monkeypatch.setattr(flow_service, "compute_gamma_exposure",
                        lambda s: GEXResult(symbol=s, spot=500.0, expiries=["2026-11-20"],
                                            call_premium=600.0, put_premium=400.0, net_flow=200.0, total_volume=10))
    monkeypatch.setattr("optionflow.workers.backfill.start_backfill", lambda s: None)
    g = client.get(url("/options/gamma-exposure/spy"), headers=h)
    assert g.status_code == 200 and g.json()["symbol"] == "SPY" and g.json()["spot"] == 500.0
    assert g.json()["data_source"] == "yfinance"
    assert client.post(url("/options/watch"), headers=h, json={"symbols": ["spy"]}).status_code == 204
    hist = client.get(url("/options/net-flow-history/spy"), headers=h, params={"days": 1})
    assert hist.status_code == 200 and hist.json()[0]["net_flow"] == 200.0
    assert client.get(url("/options/gamma-exposure/spy")).status_code == 401


# ── Watchlist ─────────────────────────────────────────────────────────────────
def test_watchlist_routes(api):
    client, url = api
    _user()
    h = _bearer(_login(client, url).json()["access_token"])
    put = client.put(url("/watchlist/ aapl "), headers=h, json={"symbol": "aapl", "notes": "core"})
    assert put.status_code == 200
    item = put.json()
    assert item["symbol"] == "AAPL" and item["source"] == "manual" and item["notes"] == "core"
    assert set(item) == {"id", "symbol", "company_name", "source", "notes", "is_active", "added_at", "updated_at"}
    assert [w["symbol"] for w in client.get(url("/watchlist"), headers=h).json()] == ["AAPL"]
    assert client.delete(url("/watchlist/aapl"), headers=h).status_code == 204
    assert client.get(url("/watchlist"), headers=h).json() == []
    sync = client.post(url("/watchlist/sync"), headers=h)
    assert sync.status_code == 200 and sync.json() == {"positions_synced": 0, "holdings_synced": 0, "total_added": 0}
