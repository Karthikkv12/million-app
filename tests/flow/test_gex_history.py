"""Tests for optionflow/modules/flow/history.py (GEX replay; in-memory DB, no network)."""
from datetime import date
from types import SimpleNamespace

from optionflow.modules.flow import history as gex_history


def test_profile_keeps_nearest_strikes_sorted():
    prof = gex_history.profile_near_spot([90, 95, 100, 105, 110, 200], [1, 2, 3, 4, 5, 6], 101, n=3)
    assert prof == [[95.0, 2.0], [100.0, 3.0], [105.0, 4.0]]


def test_throttle():
    gex_history._last.clear()
    assert gex_history.should_record("X", now=1000)
    assert not gex_history.should_record("X", now=1000 + gex_history.SNAPSHOT_EVERY - 1)
    assert gex_history.should_record("X", now=1000 + gex_history.SNAPSHOT_EVERY)


def test_record_and_read_day(db_engine_and_session):
    gex_history._last.clear()
    r = SimpleNamespace(symbol="SPY", spot=500.0, strikes=[495, 500, 505], gex_by_strike=[-1e6, 2e6, 3e6],
                        net_gex=4e6, zero_gamma=498.0, max_call_wall=505.0, max_put_wall=495.0, max_gex_strike=505.0)
    gex_history.record(r)
    out = gex_history.day("spy")
    assert out["symbol"] == "SPY" and len(out["snapshots"]) == 1
    s = out["snapshots"][0]
    assert s["spot"] == 500.0 and s["king"] == 505.0 and s["profile"][1] == [500.0, 2000000.0]
    assert out["days"] == [out["date"]]
    assert gex_history.day("SPY", date(2000, 1, 1))["snapshots"] == []


def test_record_never_raises():
    gex_history.record(object())  # missing attributes → logged, not raised


def test_poller_records_replay_snapshot(db_engine_and_session, monkeypatch):
    """The poller keeps the cloud session's gex_history.record(result) call."""
    from optionflow.modules.flow import service
    from optionflow.modules.flow.gamma import GEXResult
    from optionflow.workers import gex_poller
    gex_history._last.clear()
    monkeypatch.setattr(service, "compute_gamma_exposure", lambda s: GEXResult(
        symbol=s, spot=600.0, expiries=[], strikes=[595.0, 600.0], gex_by_strike=[1.0, 2.0], max_gex_strike=600.0))
    monkeypatch.setattr(service, "active_symbols", lambda: ["QQQ"])
    gex_poller.poll_once()
    out = gex_history.day("QQQ")
    assert len(out["snapshots"]) == 1 and out["snapshots"][0]["king"] == 600.0
    service.clear_cache()


def test_gex_history_route(db_engine_and_session):
    from fastapi.testclient import TestClient
    from optionflow.main import app
    from optionflow.modules.auth import service as auth
    auth.create_user("rita", "RitaPassword123")
    c = TestClient(app)
    h = {"Authorization": "Bearer " + c.post("/api/v1/auth/login", json={"username": "rita", "password": "RitaPassword123"}).json()["access_token"]}
    assert c.get("/api/v1/gex-history/SPY", headers=h).json() == {"symbol": "SPY", "date": None, "snapshots": [], "days": []}
    assert c.get("/gex-history/SPY", headers=h).status_code == 200                     # legacy path
    assert c.get("/api/v1/flow/SPY/replay", headers=h).json()["symbol"] == "SPY"         # path GexReplay.tsx calls
    bad = c.get("/api/v1/gex-history/SPY", params={"on": "11/08"}, headers=h)
    assert bad.status_code == 400 and "YYYY-MM-DD" in bad.json()["error"]["message"]


def _snap(ts, spot):
    from database.models import GexSnapshot
    from optionflow.core.db import get_session
    s = get_session()
    s.add(GexSnapshot(symbol="MP", ts=ts, spot=spot, net_gex=1.0, zero_gamma=None, call_wall=None,
                      put_wall=None, king=None, profile="[]"))
    s.commit()
    s.close()


def test_day_groups_by_et_session_not_utc(db_engine_and_session, monkeypatch):
    """C-91: after 7 pm ET (00:00 UTC) after-hours snapshots must not open a new default 'day'."""
    monkeypatch.setattr(gex_history, "DAYS_LOOKBACK", 100000)
    _snap("2026-11-11T14:35:00Z", 10.0)     # 09:35 ET, Wed (session)
    _snap("2026-11-11T20:55:00Z", 11.0)     # 15:55 ET (session)
    _snap("2026-11-11T22:00:00Z", 12.0)     # 17:00 ET (after hours, same ET day)
    _snap("2026-11-12T00:30:00Z", 13.0)     # 19:30 ET Wed, UTC Thursday (after hours)
    out = gex_history.day("MP")
    assert out["date"] == "2026-11-11"
    assert [s["spot"] for s in out["snapshots"]] == [10.0, 11.0]          # regular session only
    assert out["days"] == ["2026-11-11"]                                   # no UTC 11-12 day
    _snap("2026-11-12T14:31:00Z", 14.0)     # Thursday open: now the default
    assert gex_history.day("MP")["date"] == "2026-11-12"
    assert [s["spot"] for s in gex_history.day("MP", date(2026, 11, 11))["snapshots"]] == [10.0, 11.0]


def test_day_without_session_snapshots_shows_all(db_engine_and_session, monkeypatch):
    monkeypatch.setattr(gex_history, "DAYS_LOOKBACK", 100000)
    _snap("2026-11-14T16:00:00Z", 20.0)     # Saturday
    out = gex_history.day("MP")
    assert out["date"] == "2026-11-14" and [s["spot"] for s in out["snapshots"]] == [20.0]


def test_day_bounds_follow_dst():
    assert gex_history._utc_bounds(date(2026, 7, 1)) == ("2026-07-01T04:00:00Z", "2026-07-02T04:00:00Z")
    assert gex_history._utc_bounds(date(2026, 12, 1)) == ("2026-12-01T05:00:00Z", "2026-12-02T05:00:00Z")
