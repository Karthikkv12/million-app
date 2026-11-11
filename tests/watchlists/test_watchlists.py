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
