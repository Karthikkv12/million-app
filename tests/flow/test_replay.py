"""Tests for optionflow/modules/flow/replay.py (in-memory DB, no network)."""
from datetime import date
from types import SimpleNamespace

from optionflow.modules.flow import replay


def test_profile_keeps_nearest_strikes_sorted():
    prof = replay.profile_near_spot([90, 95, 100, 105, 110, 200], [1, 2, 3, 4, 5, 6], 101, n=3)
    assert prof == [[95.0, 2.0], [100.0, 3.0], [105.0, 4.0]]


def test_throttle():
    replay._last.clear()
    assert replay.should_record("X", now=1000)
    assert not replay.should_record("X", now=1000 + replay.SNAPSHOT_EVERY - 1)
    assert replay.should_record("X", now=1000 + replay.SNAPSHOT_EVERY)


def test_record_and_read_day(db_engine_and_session):
    replay._last.clear()
    r = SimpleNamespace(symbol="SPY", spot=500.0, strikes=[495, 500, 505], gex_by_strike=[-1e6, 2e6, 3e6],
                        net_gex=4e6, zero_gamma=498.0, max_call_wall=505.0, max_put_wall=495.0, max_gex_strike=505.0)
    replay.record(r)
    out = replay.day("spy")
    assert out["symbol"] == "SPY" and len(out["snapshots"]) == 1
    s = out["snapshots"][0]
    assert s["spot"] == 500.0 and s["king"] == 505.0 and s["profile"][1] == [500.0, 2000000.0]
    assert out["days"] == [out["date"]]
    assert replay.day("SPY", date(2000, 1, 1))["snapshots"] == []


def test_record_never_raises():
    replay.record(object())
