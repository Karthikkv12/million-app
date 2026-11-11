"""/reports: token-only publish, one page per report per day, per-user read."""
from optionflow.modules.hedge import reports
from tests.hedge.test_api import TOKEN, _login, client  # noqa: F401  (fixture)

H = {"X-Hedge-Ingest-Token": TOKEN}
BODY = {"username": "owner", "slug": "morning", "title": "Morning Stock Analysis Report",
        "html": "<title>x</title><p>hello</p>", "source_url": "https://claude.ai/artifact/abc", "day": "2026-11-09"}


def test_publish_needs_token_and_bound_user(client, monkeypatch):
    c, _ = client
    monkeypatch.setattr(reports, "today_et", lambda: "2026-11-10")
    assert c.post("/api/v1/reports/ingest", json=BODY).status_code == 401
    assert c.post("/api/v1/reports/ingest", json={**BODY, "username": "other"}, headers=H).status_code == 403
    assert c.post("/api/v1/reports/ingest", json={**BODY, "slug": "Bad Slug"}, headers=H).status_code == 422
    assert c.post("/api/v1/reports/ingest", json={**BODY, "source_url": "javascript:alert(1)"}, headers=H).status_code == 422
    assert c.post("/api/v1/reports/ingest", json={**BODY, "day": "2026-13-40"}, headers=H).status_code == 422
    assert c.post("/api/v1/reports/ingest", json={**BODY, "day": "Nov 9"}, headers=H).status_code == 422
    assert c.get("/api/v1/reports").status_code == 401


def test_one_page_per_day_and_per_user(client, monkeypatch):
    c, _ = client
    monkeypatch.setattr(reports, "today_et", lambda: "2026-11-10")
    assert c.post("/api/v1/reports/ingest", json=BODY, headers=H).status_code == 200
    r = c.post("/api/v1/reports/ingest", json={**BODY, "html": "<p>second</p>"}, headers=H)      # same day: replaced
    assert r.status_code == 200 and r.json()["size"] == len("<p>second</p>") and "html" not in r.json()
    c.post("/api/v1/reports/ingest", json={**BODY, "day": "2026-11-10", "html": "<p>tue</p>"}, headers=H)
    monkeypatch.setattr(reports, "today_et", lambda: "2026-11-06")                                # no day → today (ET)
    c.post("/api/v1/reports/ingest", json={k: v for k, v in BODY.items() if k != "day"} | {"slug": "evening", "title": "Daily"}, headers=H)
    mine = _login(c, "owner")
    listed = {x["slug"]: x for x in c.get("/api/v1/reports", headers=mine).json()}
    assert sorted(listed) == ["evening", "morning"] and all("html" not in x for x in listed.values())
    assert listed["morning"]["day"] == "2026-11-10" and listed["morning"]["days"] == ["2026-11-10", "2026-11-09"]
    assert listed["evening"]["days"] == ["2026-11-06"]
    assert c.get("/api/v1/reports/morning", headers=mine).json()["html"] == "<p>tue</p>"          # latest
    assert c.get("/api/v1/reports/morning?day=2026-11-09", headers=mine).json()["html"] == "<p>second</p>"
    assert c.get("/api/v1/reports/morning?day=2026-11-08", headers=mine).status_code == 404
    assert c.get("/api/v1/reports/weekend", headers=mine).status_code == 404
    other = _login(c, "other")
    assert c.get("/api/v1/reports", headers=other).json() == []
    assert c.get("/api/v1/reports/morning", headers=other).status_code == 404


def test_pages_older_than_a_month_are_deleted(client, monkeypatch):
    c, _ = client
    monkeypatch.setattr(reports, "today_et", lambda: "2026-11-10")
    for d in ("2026-10-09", "2026-10-10", "2026-11-09"):                     # 32, 31 and 1 days old
        c.post("/api/v1/reports/ingest", json={**BODY, "day": d}, headers=H)
    c.post("/api/v1/reports/ingest", json={**BODY, "slug": "weekend", "day": "2026-10-10"}, headers=H)
    mine = _login(c, "owner")
    listed = {x["slug"]: x["days"] for x in c.get("/api/v1/reports", headers=mine).json()}
    assert listed == {"morning": ["2026-11-09", "2026-10-10"], "weekend": ["2026-10-10"]}
    monkeypatch.setattr(reports, "today_et", lambda: "2026-11-12")           # two days later: Oct 10 is now 33 days old
    assert c.get("/api/v1/reports/weekend", headers=mine).status_code == 404  # hidden at once …
    assert c.get("/api/v1/reports/morning?day=2026-10-10", headers=mine).status_code == 404
    c.post("/api/v1/reports/ingest", json={**BODY, "day": "2026-11-12"}, headers=H)
    from database.models import Report
    from optionflow.core.db import get_session
    s = get_session()
    try:
        assert sorted(r.day for r in s.query(Report).all()) == ["2026-11-09", "2026-11-12"]   # … and removed on the next publish
    finally:
        s.close()
