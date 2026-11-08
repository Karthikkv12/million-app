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
    bad = c.get("/api/v1/gex-history/SPY", params={"on": "11/08"}, headers=h)
    assert bad.status_code == 400 and "YYYY-MM-DD" in bad.json()["error"]["message"]
