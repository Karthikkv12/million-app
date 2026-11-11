"""watchlists: seeding, the 20-list limit, symbols, isolation between users, the /watchlists API."""
import pytest
from fastapi.testclient import TestClient

from optionflow.core.settings import Settings
from optionflow.main import create_app
from optionflow.modules.watchlists import service
from optionflow.modules.watchlists.sectors import SECTOR_LISTS

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


def test_needs_login(client):
    assert client.get("/api/v1/watchlists").status_code == 401


def test_first_read_seeds_my_list_and_every_sector(client):
    h = _login(client)
    assert client.put("/api/v1/watchlist/pltr", json={"symbol": "pltr"}, headers=h).status_code == 200   # the old single list
    body = client.get("/api/v1/watchlists", headers=h).json()
    assert body["max_lists"] == 20
    names = [g["name"] for g in body["lists"]]
    assert names == ["My watchlist"] + [s for s, _ in SECTOR_LISTS]
    assert body["lists"][0]["symbols"] == ["PLTR"] and body["lists"][0]["kind"] == "custom"
    tech = body["lists"][1]
    assert tech["kind"] == "sector" and tech["sector"] == "Technology" and tech["symbols"][0] == "XLK"
    # A second read doesn't seed again.
    assert len(client.get("/api/v1/watchlists", headers=h).json()["lists"]) == len(names)


def test_twenty_list_limit_and_duplicate_names(client):
    h = _login(client)
    n = len(client.get("/api/v1/watchlists", headers=h).json()["lists"])
    for i in range(20 - n):
        assert client.post("/api/v1/watchlists", json={"name": f"List {i}"}, headers=h).status_code == 201
    r = client.post("/api/v1/watchlists", json={"name": "One too many"}, headers=h)
    assert r.status_code == 409 and "20" in r.text
    gid = client.get("/api/v1/watchlists", headers=h).json()["lists"][-1]["id"]
    assert client.delete(f"/api/v1/watchlists/{gid}", headers=h).status_code == 204
    assert client.post("/api/v1/watchlists", json={"name": "my WATCHLIST"}, headers=h).status_code == 409
    assert client.post("/api/v1/watchlists", json={"name": "Earnings plays", "symbols": ["nvda", "NVDA", "amd"]},
                       headers=h).json()["symbols"] == ["NVDA", "AMD"]


def test_symbols_add_remove_rename_and_bad_input(client):
    h = _login(client)
    gid = client.post("/api/v1/watchlists", json={"name": "Swing"}, headers=h).json()["id"]
    assert client.put(f"/api/v1/watchlists/{gid}/symbols/tsla", headers=h).json()["symbols"] == ["TSLA"]
    assert client.put(f"/api/v1/watchlists/{gid}/symbols/TSLA", headers=h).json()["symbols"] == ["TSLA"]  # idempotent
    assert client.put(f"/api/v1/watchlists/{gid}/symbols/BRK.B", headers=h).json()["symbols"] == ["TSLA", "BRK.B"]
    assert client.put(f"/api/v1/watchlists/{gid}/symbols/%3Cscript%3E", headers=h).status_code == 400
    assert client.delete(f"/api/v1/watchlists/{gid}/symbols/tsla", headers=h).json()["symbols"] == ["BRK.B"]
    r = client.patch(f"/api/v1/watchlists/{gid}", json={"name": "  Swing   trades ", "symbols": ["A", "B"]}, headers=h).json()
    assert r["name"] == "Swing trades" and r["symbols"] == ["A", "B"]
    assert client.patch("/api/v1/watchlists/99999", json={"name": "x"}, headers=h).status_code == 404


def test_lists_are_private(client):
    h, o = _login(client), _login(client, "other")
    gid = client.get("/api/v1/watchlists", headers=h).json()["lists"][0]["id"]
    assert client.put(f"/api/v1/watchlists/{gid}/symbols/AAPL", headers=o).status_code == 404
    assert client.delete(f"/api/v1/watchlists/{gid}", headers=o).status_code == 404
    assert gid not in [g["id"] for g in client.get("/api/v1/watchlists", headers=o).json()["lists"]]


def test_reorder_and_restore_sectors(client):
    h = _login(client)
    lists = client.get("/api/v1/watchlists", headers=h).json()["lists"]
    energy = next(g for g in lists if g["sector"] == "Energy")
    first = client.post("/api/v1/watchlists/order", json={"ids": [energy["id"]]}, headers=h).json()["lists"][0]
    assert first["id"] == energy["id"]
    client.delete(f"/api/v1/watchlists/{energy['id']}", headers=h)
    back = client.post("/api/v1/watchlists/restore-sectors", headers=h).json()["lists"]
    assert [g["sector"] for g in back].count("Energy") == 1 and len(back) == len(lists)


def test_service_rejects_too_many_symbols(db_engine_and_session):
    from optionflow.modules.auth import service as auth
    auth.create_user("solo", PASSWORD)
    uid = 1
    with pytest.raises(service.WatchlistError):
        service.create_group(uid, "Huge", [f"S{i}" for i in range(service.MAX_SYMBOLS + 1)])


def test_columns_saved_per_list_and_reset(client):
    h = _login(client)
    gid = client.get("/api/v1/watchlists", headers=h).json()["lists"][0]["id"]
    assert client.get("/api/v1/watchlists", headers=h).json()["lists"][0]["columns"] is None
    r = client.patch(f"/api/v1/watchlists/{gid}", json={"columns": ["last", "atm_iv", "atm_call_delta", "atm_iv"]}, headers=h)
    assert r.json()["columns"] == ["last", "atm_iv", "atm_call_delta"]
    assert client.patch(f"/api/v1/watchlists/{gid}", json={"columns": ["DROP TABLE"]}, headers=h).status_code == 400
    assert client.patch(f"/api/v1/watchlists/{gid}", json={"columns": []}, headers=h).json()["columns"] is None


def test_option_metrics_from_the_desk_caches(client, monkeypatch):
    from optionflow.modules.hedge import service as desk
    from optionflow.modules.watchlists import options
    rows = {("2026-11-14", 100.0, "call"): (0.40, 2.0, 3.0), ("2026-11-14", 100.0, "put"): (0.40, 2.0, 3.0),
            ("2026-11-14", 105.0, "call"): (0.38, 0.6, 3.0)}
    monkeypatch.setattr(desk, "_chain", lambda s: {"rows": rows, "weekly": "2026-11-14", "atm_iv": 0.40} if s == "AAPL" else None)
    monkeypatch.setattr(desk, "_spot", lambda s: 100.0 if s == "AAPL" else None)
    monkeypatch.setattr(desk, "_hv", lambda s: {"hv20": 0.25})
    h = _login(client)
    out = client.get("/api/v1/watchlists/option-metrics?symbols=aapl,NOPE,<bad>", headers=h).json()
    assert [m["symbol"] for m in out] == ["AAPL", "NOPE"]
    a = out[0]
    assert a["atm_iv"] == 0.4 and a["iv_hv"] == 1.6 and a["expiry"] == "2026-11-14" and a["dte"] == 3.0
    assert a["expected_move"] == round(100 * 0.4 * (3 / 365) ** 0.5, 2)
    assert 0.5 < a["atm_call_delta"] < 0.56 and -0.5 < a["atm_put_delta"] < -0.44
    assert out[1]["error"] == "No option chain" and out[1]["atm_iv"] is None
    assert len(options.batch([f"S{i}" for i in range(60)])) == options.MAX_SYMBOLS
