"""Tests for optionflow/modules/flow/tide.py (net premium leaders, market tide; in-memory DB, no network)."""
from datetime import datetime, time, timedelta, timezone

import pytest

from optionflow.modules.flow import repo, tide
from optionflow.providers import market_data
from optionflow.workers.backfill import ET


def _session_day():
    """The most recent weekday before today (US-Eastern)."""
    d = datetime.now(ET).date() - timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def _ts(day, hh, mm, ss=17):
    """UTC timestamp for an ET wall-clock time; ss != 0 marks a live snapshot (0 = backfill estimate)."""
    return datetime.combine(day, time(hh, mm, ss), ET).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _snap(sym, day, hh, mm, call, put, price=100.0, ss=17):
    return dict(symbol=sym, ts=_ts(day, hh, mm, ss), price=price, call_prem=call, put_prem=put,
                net_flow=call - put, total_prem=call + put, volume=1)


class _Quotes:
    name = "fake"

    def quotes_batch(self, symbols):
        return {s: {"change_pct": 1.5} for s in symbols if s == "AAA"}


@pytest.fixture
def day(db_engine_and_session):
    d = _session_day()
    market_data.use_market_data(_Quotes())
    yield d
    market_data.use_market_data(None)


def test_leaders_count_premium_since_the_open(day):
    repo.add_snapshots([
        _snap("AAA", day, 9, 15, 50e6, 50e6),             # before the open: previous session's chain, ignored
        _snap("AAA", day, 9, 31, 20e6, 5e6),              # baseline
        _snap("AAA", day, 12, 0, 50e6, 8e6, price=101.0),
        _snap("BBB", day, 9, 45, 10e6, 10e6),
        _snap("BBB", day, 15, 59, 11e6, 30e6),
        _snap("BBB", day, 20, 0, 90e6, 10e6),             # after the close: chain changed, ignored
        _snap("CCC", day, 10, 0, 5e6, 5e6),
    ])
    out = tide.leaders()
    assert out["session"] == day.isoformat() and out["symbols"] == 3
    assert out["bullish"] == [{"symbol": "AAA", "net": 27e6, "call_prem": 30e6, "put_prem": 3e6,
                               "spot": 101.0, "change_pct": 1.5}]
    assert [(x["symbol"], x["net"]) for x in out["bearish"]] == [("BBB", -19e6)]   # CCC: one row, net 0


def test_leaders_drop_estimates_and_a_mixed_chain_source(day):
    repo.add_snapshots([
        _snap("MU", day, 9, 30, 46_000e6, 18_000e6, ss=0),   # backfill estimate on a day with live rows: dropped
        _snap("MU", day, 9, 40, 77_000e6, 30_000e6),          # Yahoo chain (every expiry): ~15× Public's, dropped
        _snap("MU", day, 9, 41, 4_800e6, 1_900e6),
        _snap("MU", day, 11, 0, 4_900e6, 1_850e6),
        _snap("MU", day, 15, 0, 4_700e6, 2_000e6),
    ])
    (row,) = tide.leaders()["bearish"]
    assert row["symbol"] == "MU" and row["call_prem"] == -100e6 and row["put_prem"] == 100e6   # signed, not clamped


def test_leaders_limit_and_empty(day):
    assert tide.leaders()["bullish"] == [] and tide.leaders()["session"] is None
    repo.add_snapshots([_snap(f"S{i}", day, h, 0, c, 0) for i in range(5) for h, c in ((10, 0), (11, (i + 1) * 1e6))])
    assert [x["symbol"] for x in tide.leaders(limit=2)["bullish"]] == ["S4", "S3"]


def test_tide_sums_across_symbols_with_carry_forward_and_spy(day):
    repo.add_snapshots([
        _snap("SPY", day, 9, 30, 100e6, 100e6, price=600.0),
        _snap("SPY", day, 9, 40, 130e6, 110e6, price=601.0),
        _snap("AAA", day, 9, 36, 10e6, 10e6),
        _snap("AAA", day, 9, 52, 10e6, 25e6),
    ])
    pts = tide.tide(days=1, bucket_minutes=5)
    assert [p["ts"][11:16] for p in pts] == [_ts(day, h, m)[11:16] for h, m in ((9, 30), (9, 35), (9, 40), (9, 50))]
    assert [p["net"] for p in pts] == [0, 0, 20e6, 5e6]           # SPY +30/+10 carried into 09:50; AAA 0/+15
    assert [p["spy"] for p in pts] == [600.0, 600.0, 601.0, 601.0]
    assert [p["symbols"] for p in pts] == [1, 2, 2, 2]


def test_tide_resets_each_session(day):
    prev = day - timedelta(days=1)
    while prev.weekday() >= 5:
        prev -= timedelta(days=1)
    repo.add_snapshots([
        _snap("AAA", prev, 10, 0, 0, 0), _snap("AAA", prev, 15, 0, 50e6, 0),
        _snap("AAA", day, 10, 0, 7e6, 0), _snap("AAA", day, 11, 0, 9e6, 0),
    ])
    nets = [p["net"] for p in tide.tide(days=2, bucket_minutes=60)]
    assert nets == [0, 50e6, 0, 2e6]
    assert [p["net"] for p in tide.tide(days=1, bucket_minutes=60)] == [0, 2e6]
