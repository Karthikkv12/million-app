"""/reports: token-only publish, replace per slug, per-user read."""
from tests.hedge.test_api import TOKEN, _login, client  # noqa: F401  (fixture)

H = {"X-Hedge-Ingest-Token": TOKEN}
BODY = {"username": "owner", "slug": "morning", "title": "Morning Stock Analysis Report",
        "html": "<title>x</title><p>hello</p>", "source_url": "https://claude.ai/artifact/abc"}


def test_publish_needs_token_and_bound_user(client):
    c, _ = client
    assert c.post("/api/v1/reports/ingest", json=BODY).status_code == 401
    assert c.post("/api/v1/reports/ingest", json={**BODY, "username": "other"}, headers=H).status_code == 403
    assert c.post("/api/v1/reports/ingest", json={**BODY, "slug": "Bad Slug"}, headers=H).status_code == 422
    assert c.post("/api/v1/reports/ingest", json={**BODY, "source_url": "javascript:alert(1)"}, headers=H).status_code == 422
    assert c.get("/api/v1/reports").status_code == 401


def test_publish_replaces_and_is_per_user(client):
    c, _ = client
    assert c.post("/api/v1/reports/ingest", json=BODY, headers=H).status_code == 200
    r = c.post("/api/v1/reports/ingest", json={**BODY, "html": "<p>second</p>"}, headers=H)
    assert r.status_code == 200 and r.json()["size"] == len("<p>second</p>") and "html" not in r.json()
    c.post("/api/v1/reports/ingest", json={**BODY, "slug": "evening", "title": "Daily"}, headers=H)
    mine = _login(c, "owner")
    listed = c.get("/api/v1/reports", headers=mine).json()
    assert sorted(x["slug"] for x in listed) == ["evening", "morning"] and all("html" not in x for x in listed)
    assert c.get("/api/v1/reports/morning", headers=mine).json()["html"] == "<p>second</p>"
    assert c.get("/api/v1/reports/weekend", headers=mine).status_code == 404
    other = _login(c, "other")
    assert c.get("/api/v1/reports", headers=other).json() == []
    assert c.get("/api/v1/reports/morning", headers=other).status_code == 404
