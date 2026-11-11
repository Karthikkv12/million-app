"""/strategy API and the desk following the chosen strategy."""
import pytest
from fastapi.testclient import TestClient

from optionflow.core.settings import Settings
from optionflow.main import create_app
from optionflow.modules.strategy import service

PASSWORD = "Str0ng!Passw0rd#2026"


@pytest.fixture
def client(db_engine_and_session, settings_override):
    from optionflow.modules.auth import service as auth
    auth.create_user("owner", PASSWORD)
    auth.create_user("other", PASSWORD)
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


def test_defaults_then_set_strategy_and_rules(client):
    h = _login(client)
    body = client.get("/api/v1/strategy", headers=h).json()
    assert body["strategy"] == "spike_wheel" and len(body["strategies"]) == 5
    r = client.put("/api/v1/strategy", headers=h, json={"strategy": "wheel", "rules": {"delta_max": 0.3, "dte_min": 30}}).json()
    assert r["strategy"] == "wheel" and r["rules"]["delta_max"] == 0.3 and r["rules"]["dte_min"] == 30
    assert r["overrides"] == {"delta_max": 0.3, "dte_min": 30}
    # switching strategy resets the overrides (each strategy has its own defaults)
    r = client.put("/api/v1/strategy", headers=h, json={"strategy": "covered_call"}).json()
    assert r["overrides"] == {} and r["strategy"] == "covered_call"
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
