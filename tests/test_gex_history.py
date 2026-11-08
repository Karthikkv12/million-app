"""Tests for logic/gex_history.py (temp DB, no network)."""
from datetime import date
from types import SimpleNamespace

from logic import gex_history


def test_profile_keeps_nearest_strikes_sorted():
    prof = gex_history.profile_near_spot([90, 95, 100, 105, 110, 200], [1, 2, 3, 4, 5, 6], 101, n=3)
    assert prof == [[95.0, 2.0], [100.0, 3.0], [105.0, 4.0]]


def test_throttle():
    gex_history._last.clear()
    assert gex_history.should_record("X", now=1000)
    assert not gex_history.should_record("X", now=1000 + gex_history.SNAPSHOT_EVERY - 1)
    assert gex_history.should_record("X", now=1000 + gex_history.SNAPSHOT_EVERY)


def test_record_and_read_day(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_DIR", str(tmp_path))
    monkeypatch.setattr(gex_history, "_ready", False)
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
