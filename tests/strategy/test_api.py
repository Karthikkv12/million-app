"""/strategy API, the desk following the chosen strategy, and scanner notifications."""
import pytest
from fastapi.testclient import TestClient

from optionflow.core.settings import Settings
from optionflow.main import create_app
from optionflow.modules.notify import service as notify, webpush
from optionflow.modules.strategy import service, worker

PASSWORD = "Str0ng!Passw0rd#2026"


@pytest.fixture
def client(db_engine_and_session, settings_override):
    from optionflow.modules.auth import service as auth
    auth.create_user("owner", PASSWORD)
    auth.create_user("other", PASSWORD)
    worker.LATEST.clear()
    app = create_app(Settings(_env_file=None, jwt_secret="test-secret-do-not-use-in-prod",
                              jwt_audience="optionflow-app", jwt_issuer="optionflow-api"))
    return TestClient(app)


def _login(c, user="owner"):
    r = c.post("/api/v1/auth/login", json={"username": user, "password": PASSWORD})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _uid(name="owner"):
    from optionflow.modules.auth import service as auth
    return int(auth.get_user_by_username(name).id)


def test_needs_login(client):
    assert client.get("/api/v1/strategy").status_code == 401


def test_defaults_then_set_strategy_rules_and_filters(client):
    h = _login(client)
    body = client.get("/api/v1/strategy", headers=h).json()
    assert body["strategy"] == "spike_wheel" and body["notify"] is False and len(body["strategies"]) == 5
    assert body["scanner"] == body["filters_default"]
    r = client.put("/api/v1/strategy", headers=h, json={"strategy": "wheel", "rules": {"delta_max": 0.3, "dte_min": 30},
                                                         "scanner": {"min_iv": 0.35, "symbols": ["amd"]}, "notify": True}).json()
    assert r["strategy"] == "wheel" and r["rules"]["delta_max"] == 0.3 and r["rules"]["dte_min"] == 30
    assert r["overrides"] == {"delta_max": 0.3, "dte_min": 30} and r["scanner"]["min_iv"] == 0.35 and r["scanner"]["symbols"] == ["AMD"]
    # switching strategy resets the overrides (each strategy has its own defaults); filters stay
    r = client.put("/api/v1/strategy", headers=h, json={"strategy": "covered_call"}).json()
    assert r["overrides"] == {} and r["scanner"]["min_iv"] == 0.35 and r["notify"] is True
    assert client.put("/api/v1/strategy", headers=h, json={"strategy": "yolo"}).status_code == 400
    assert client.get("/api/v1/strategy", headers=_login(client, "other")).json()["strategy"] == "spike_wheel"


def test_desk_rules_follow_the_setting(client):
    uid = _uid()
    assert service.rules_for_user(uid) is None                     # spike wheel = the desk's own playbook
    service.update_settings(uid, strategy="cash_secured_put")
    r = service.rules_for_user(uid)
    assert r.key == "cash_secured_put" and r.require_pullback


def test_books_pass_the_users_rules_to_each_book(client, monkeypatch):
    from optionflow.modules.hedge import service as hedge
    uid = _uid()
    service.update_settings(uid, strategy="wheel")
    hedge.replace_positions(uid, "robinhood", [{"symbol": "XYZ", "kind": "stock", "quantity": 100, "avg_price": 50.0}])
    seen = []
    monkeypatch.setattr(hedge, "build_book", lambda sym, legs, avg, acc, rules=None: seen.append(rules) or {"symbol": sym})
    hedge.books_for(uid)
    assert seen[0].key == "wheel"


ROW = {"key": "wheel:XYZ:100:2026-12-18", "symbol": "XYZ", "strategy": "wheel", "action": "SELL_PUT", "headline": "Sell 100P",
       "strike": 100.0, "long_strike": None, "expiry": "2026-12-18", "dte": 37.0, "delta": -0.28, "premium": 2.5, "credit": 250.0,
       "yield_ann": 0.25, "collateral": 10000.0, "max_loss": None, "spot": 108.0, "day_change": -0.01, "pullback": 0.08,
       "rsi": 38.0, "sma200_gap": 0.1, "iv": 0.42, "hv20": 0.3, "iv_hv": 1.4, "iv_pctile": 0.7, "oi": 900, "spread_pct": 0.04,
       "earnings": None, "score": 71.0, "reasons": ["8% off the high."]}


def fake_scan(rows):
    return lambda rules, f, uid: {"as_of": "now", "strategy": rules.key, "strategy_name": "x", "universe": 1, "screened": 1,
                                  "chains": 1, "skipped": {}, "rows": rows, "seconds": 0.1}


def test_scan_endpoint_stores_picks_once(client, monkeypatch):
    h = _login(client)
    monkeypatch.setattr(worker.scanner, "scan", fake_scan([ROW]))
    r = client.post("/api/v1/strategy/scan", headers=h).json()
    assert r["rows"][0]["symbol"] == "XYZ" and r["new"] == [ROW["key"]]
    assert client.post("/api/v1/strategy/scan", headers=h).json()["new"] == []            # same day, same contract
    assert client.get("/api/v1/strategy/scan", headers=h).json()["rows"][0]["key"] == ROW["key"]
    picks = client.get("/api/v1/strategy/picks", headers=h).json()["picks"]
    assert len(picks) == 1 and picks[0]["found_at"] and picks[0]["notified"] is False
    assert client.get("/api/v1/strategy/picks", headers=_login(client, "other")).json()["picks"] == []


@pytest.fixture
def keys(monkeypatch):
    priv, _pub = webpush.generate_keys()
    monkeypatch.setenv("PUSH_VAPID_PRIVATE_KEY", priv)
    return priv


def test_background_scan_pushes_new_picks_once(client, keys, monkeypatch):
    uid = _uid()
    notify.subscribe(uid, "https://push.example/1", "p", "a", "iPhone")
    service.update_settings(uid, strategy="wheel", notify=True)
    monkeypatch.setattr(worker.scanner, "scan", fake_scan([ROW]))
    monkeypatch.setattr(notify, "market_open", lambda: True)
    sent = []
    monkeypatch.setattr(webpush, "send", lambda *a, **k: (sent.append(a[3]), webpush.SendResult(201, False))[1])
    worker._last_run.clear()
    assert worker.tick(now=1e9) == 1
    assert [p["title"] for p in sent] == ["Scanner: XYZ 100P 12-18"] and sent[0]["url"] == "/hedge/scanner"
    assert worker.tick(now=1e9 + 30) == 0                                 # interval not up yet
    assert worker.tick(now=1e9 + 3600) == 1 and len(sent) == 1            # ran again, nothing new to push
    assert service.recent_picks(uid)[0]["notified"] is True


def test_many_picks_become_one_summary(client, keys, monkeypatch):
    uid = _uid()
    notify.subscribe(uid, "https://push.example/1", "p", "a", None)
    many = [{**ROW, "key": f"wheel:S{i}:100:2026-12-18", "symbol": f"S{i}"} for i in range(8)]
    sent = []
    sender = lambda *a, **k: (sent.append(a[3]), webpush.SendResult(201, False))[1]   # noqa: E731
    worker.run_for_user(uid, notify=True, sender=sender, scan_fn=fake_scan(many))
    assert len(sent) == 1 and sent[0]["title"] == "Scanner: 8 new trades"


def test_notify_off_means_no_background_scan(client, keys, monkeypatch):
    uid = _uid()
    service.update_settings(uid, strategy="wheel", notify=False)
    monkeypatch.setattr(notify, "market_open", lambda: True)
    monkeypatch.setattr(worker.scanner, "scan", lambda *a: pytest.fail("should not scan"))
    assert worker.tick(now=2e9) == 0
