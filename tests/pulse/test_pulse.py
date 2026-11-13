"""pulse: /alerts/price, /paper-trades and the price check (in-memory DB, no network)."""
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from optionflow.core.settings import Settings
from optionflow.main import create_app
from optionflow.modules.pulse import service, worker
from optionflow.workers.backfill import ET

PASSWORD = "Str0ng!Passw0rd#2026"
PRICES = {}


@pytest.fixture
def client(db_engine_and_session, monkeypatch):
    from optionflow.modules.auth import service as auth
    auth.create_user("owner", PASSWORD)
    auth.create_user("other", PASSWORD)
    PRICES.clear()
    PRICES.update({"AAPL": 200.0, "SPY": 600.0})
    monkeypatch.setattr(service, "prices", lambda syms: {s: PRICES[s] for s in syms if s in PRICES})
    app = create_app(Settings(_env_file=None, jwt_secret="test-secret-do-not-use-in-prod",
                              jwt_audience="optionflow-app", jwt_issuer="optionflow-api"))
    return TestClient(app)


def _login(c, user="owner"):
    r = c.post("/api/v1/auth/login", json={"username": user, "password": PASSWORD})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


class Pushes(list):
    def __call__(self, uid, payload):
        self.append((uid, payload))


def _check():
    sent = Pushes()
    events = service.check(push=sent)
    return events, sent


def test_needs_login(client):
    assert client.get("/api/v1/alerts/price").status_code == 401
    assert client.get("/api/v1/paper-trades").status_code == 401


def test_alert_crud_and_isolation(client):
    h, o = _login(client), _login(client, "other")
    r = client.post("/api/v1/alerts/price", headers=h, json={"symbol": "aapl", "price": 210, "direction": "above",
                                                              "note": "breakout"})
    assert r.status_code == 201
    a = r.json()
    assert a["symbol"] == "AAPL" and a["triggered_at"] is None
    assert client.get("/api/v1/alerts/price", headers=o).json() == []
    assert client.patch(f"/api/v1/alerts/price/{a['id']}", headers=o, json={"price": 1}).status_code == 404
    assert client.delete(f"/api/v1/alerts/price/{a['id']}", headers=o).status_code == 404
    assert client.patch(f"/api/v1/alerts/price/{a['id']}", headers=h, json={"price": 215}).json()["price"] == 215
    assert client.post("/api/v1/alerts/price", headers=h,
                       json={"symbol": "AAPL", "price": 1, "direction": "sideways"}).status_code == 422
    assert client.delete(f"/api/v1/alerts/price/{a['id']}", headers=h).status_code == 204
    assert client.get("/api/v1/alerts/price", headers=h).json() == []


def test_alert_fires_once_and_rearms_on_edit(client):
    h = _login(client)
    up = client.post("/api/v1/alerts/price", headers=h, json={"symbol": "AAPL", "price": 205, "direction": "above"}).json()
    down = client.post("/api/v1/alerts/price", headers=h, json={"symbol": "SPY", "price": 590, "direction": "below"}).json()
    assert _check()[0] == []
    PRICES["AAPL"] = 205.5
    events, sent = _check()
    assert [(e["kind"], e["id"]) for e in events] == [("price_alert", up["id"])]
    assert sent[0][1]["title"] == "AAPL above $205.00" and sent[0][1]["url"] == "/stocks/AAPL"
    assert _check()[0] == []                                          # fired once
    got = {a["id"]: a for a in client.get("/api/v1/alerts/price", headers=h).json()}
    assert got[up["id"]]["triggered_price"] == 205.5 and got[down["id"]]["triggered_at"] is None
    client.patch(f"/api/v1/alerts/price/{up['id']}", headers=h, json={"price": 206})
    PRICES["AAPL"] = 207.0
    assert [e["id"] for e in _check()[0]] == [up["id"]]               # re-armed by the edit


def test_paper_trade_planned_open_target(client):
    h = _login(client)
    t = client.post("/api/v1/paper-trades", headers=h, json={"symbol": "AAPL", "side": "long", "qty": 10,
                                                              "entry": 195, "stop": 190, "target": 210}).json()
    assert t["status"] == "planned" and t["created_price"] == 200.0
    PRICES["AAPL"] = 196.0
    assert _check()[0] == []                                          # entry below: waits for ≤ 195
    PRICES["AAPL"] = 194.9
    events, sent = _check()
    assert [e["kind"] for e in events] == ["paper_open"] and "entry reached" in sent[0][1]["title"]
    PRICES["AAPL"] = 211.0
    events, sent = _check()
    assert [e["kind"] for e in events] == ["paper_target"] and "+$160.00" in sent[0][1]["body"]
    got = client.get("/api/v1/paper-trades", headers=h).json()[0]
    assert got["status"] == "target" and got["exit_price"] == 211.0 and got["closed_at"]
    assert client.patch(f"/api/v1/paper-trades/{t['id']}", headers=h, json={"stop": 180}).status_code == 400


def test_paper_short_breakout_entry_and_stop(client):
    h = _login(client)
    t = client.post("/api/v1/paper-trades", headers=h, json={"symbol": "SPY", "side": "short", "qty": 2,
                                                              "entry": 605, "stop": 612}).json()
    PRICES["SPY"] = 606.0                                             # entry above the plan price: ≥ 605 opens
    assert [e["kind"] for e in _check()[0]] == ["paper_open"]
    PRICES["SPY"] = 613.0
    events, sent = _check()
    assert [e["kind"] for e in events] == ["paper_stopped"] and "−$16.00" in sent[0][1]["body"]
    assert client.get("/api/v1/paper-trades?status=stopped", headers=h).json()[0]["id"] == t["id"]


def test_paper_validation_close_and_isolation(client):
    h, o = _login(client), _login(client, "other")
    bad = {"symbol": "AAPL", "side": "long", "qty": 1, "entry": 200, "stop": 205}
    assert client.post("/api/v1/paper-trades", headers=h, json=bad).status_code == 400
    assert client.post("/api/v1/paper-trades", headers=h, json=bad | {"side": "short", "target": 210}).status_code == 400
    t = client.post("/api/v1/paper-trades", headers=h, json={"symbol": "AAPL", "side": "long", "qty": 1,
                                                              "entry": 200, "status": "open"}).json()
    assert t["status"] == "open" and t["opened_at"] and t["created_price"] is None
    assert client.patch(f"/api/v1/paper-trades/{t['id']}", headers=h, json={"entry": 199}).status_code == 400
    assert client.patch(f"/api/v1/paper-trades/{t['id']}", headers=o, json={"status": "closed"}).status_code == 404
    PRICES["AAPL"] = 203.0
    c = client.patch(f"/api/v1/paper-trades/{t['id']}", headers=h, json={"status": "closed"}).json()
    assert c["status"] == "closed" and c["exit_price"] == 203.0
    assert client.get("/api/v1/paper-trades", headers=o).json() == []
    assert client.delete(f"/api/v1/paper-trades/{t['id']}", headers=h).status_code == 204


def test_planned_without_a_price_takes_the_first_check_as_reference(client):
    h = _login(client)
    PRICES.pop("AAPL")
    t = client.post("/api/v1/paper-trades", headers=h, json={"symbol": "AAPL", "side": "long", "qty": 1,
                                                              "entry": 195}).json()
    assert t["created_price"] is None
    PRICES["AAPL"] = 190.0
    assert _check()[0] == []                                          # sets the reference, doesn't open
    PRICES["AAPL"] = 195.0
    assert [e["kind"] for e in _check()[0]] == ["paper_open"]         # reached from below


def test_worker_hours():
    assert worker.session_open(datetime(2026, 11, 11, 4, 0, tzinfo=ET))
    assert worker.session_open(datetime(2026, 11, 11, 19, 59, tzinfo=ET))
    assert not worker.session_open(datetime(2026, 11, 11, 20, 0, tzinfo=ET))
    assert not worker.session_open(datetime(2026, 11, 14, 12, 0, tzinfo=ET))   # Saturday
