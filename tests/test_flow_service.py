"""Tests for optionflow/modules/flow (service + ORM repo), the backfill worker and bars_from_history."""
from datetime import datetime, timedelta, timezone

import pandas as pd

from optionflow.modules.flow import repo, service
from optionflow.modules.flow.gamma import GEXResult
from optionflow.providers.market_data import bars_from_history
from optionflow.workers import backfill


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _snap(symbol: str, ts: str, price: float = 100.0, volume: int = 10) -> dict:
    return dict(symbol=symbol, ts=ts, price=price, call_prem=60.0, put_prem=40.0,
                net_flow=20.0, total_prem=100.0, volume=volume)


def _result(symbol="SPY", spot=500.0, call=600.0, put=400.0, volume=100) -> GEXResult:
    return GEXResult(symbol=symbol, spot=spot, expiries=[], call_premium=call,
                     put_premium=put, net_flow=call - put, total_volume=volume)


def test_snapshots_round_trip_through_orm(db_engine_and_session):
    now = datetime.now(timezone.utc)
    repo.add_snapshots([
        _snap("SPY", _iso(now - timedelta(minutes=2))),
        _snap("SPY", _iso(now - timedelta(minutes=1))),
        _snap("QQQ", _iso(now - timedelta(minutes=1))),
        _snap("SPY", _iso(now - timedelta(days=3))),       # outside a 1-day window
    ])
    rows = service.net_flow_history("spy", days=1)
    assert [r["ts"] for r in rows] == sorted(r["ts"] for r in rows)
    assert len(rows) == 2 and all(r["call_prem"] == 60.0 for r in rows)
    assert repo.existing_timestamps("SPY", _iso(now - timedelta(days=1))) == {r["ts"] for r in rows}


def test_history_matches_legacy_offset_timestamps(db_engine_and_session):
    ts = (datetime.now(timezone.utc) - timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    repo.add_snapshot(**_snap("SPY", ts))
    assert len(service.net_flow_history("SPY", days=1)) == 1


def test_history_buckets_keep_last_value_and_sum_volume(db_engine_and_session):
    base = datetime.now(timezone.utc).replace(second=0, microsecond=0) - timedelta(hours=1)
    base = base - timedelta(minutes=base.minute % 5)       # align to a 5-minute bucket
    repo.add_snapshots([
        _snap("SPY", _iso(base + timedelta(minutes=1)), price=1.0, volume=3),
        _snap("SPY", _iso(base + timedelta(minutes=2)), price=2.0, volume=4),
        _snap("SPY", _iso(base + timedelta(minutes=6)), price=3.0, volume=5),
    ])
    rows = service.net_flow_history("SPY", days=1, bucket_minutes=5)
    assert [(r["price"], r["volume"]) for r in rows] == [(2.0, 7), (3.0, 5)]


def test_get_gex_caches_and_records_one_snapshot(db_engine_and_session, monkeypatch):
    calls = []

    def _compute(symbol):
        calls.append(symbol)
        return _result(symbol)

    monkeypatch.setattr(service, "compute_gamma_exposure", _compute)
    service.clear_cache()
    try:
        first = service.get_gex("SPY")
        second = service.get_gex("SPY")             # within the TTL: served from cache
        assert first is second and calls == ["SPY"]
        rows = service.net_flow_history("SPY", days=1)
        assert len(rows) == 1
        assert rows[0]["total_prem"] == 1000.0 and rows[0]["net_flow"] == 200.0
    finally:
        service.clear_cache()


def test_watch_returns_only_new_symbols_and_expires(monkeypatch):
    service._watched_ttl.clear()
    assert service.watch(["spy", " qqq ", ""]) == ["SPY", "QQQ"]
    assert service.watch(["SPY", "IWM"]) == ["IWM"]
    assert sorted(service.active_symbols()) == ["IWM", "QQQ", "SPY"]
    monkeypatch.setattr(service, "WATCH_TTL", -1)    # everything is now stale
    assert service.active_symbols() == []


def test_backfill_estimates_snapshots_from_bars(db_engine_and_session, fake_market_data, monkeypatch):
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    idx = pd.DatetimeIndex([now - timedelta(minutes=m) for m in (3, 2, 1)], tz="UTC")
    fake_market_data.price_history = lambda s, period, interval: pd.DataFrame(
        {"open": 1.0, "high": 1.0, "low": 1.0, "close": [10.0, 0.0, 12.0], "volume": [100, 50, 200]}, index=idx)
    # Today's GEX: 60/40 call/put split, $10 of premium per contract traded
    monkeypatch.setattr(service, "compute_gamma_exposure", lambda s: _result(s, call=600.0, put=400.0, volume=100))
    backfill.reset_daily()

    backfill.backfill_history("SPY", 1)
    rows = service.net_flow_history("SPY", days=1)
    assert len(rows) == 2                            # the zero-price bar is skipped
    assert (rows[0]["call_prem"], rows[0]["put_prem"], rows[0]["total_prem"]) == (600.0, 400.0, 1000.0)
    assert rows[1]["net_flow"] == 2000.0 * 0.6 - 2000.0 * 0.4

    backfill.backfill_history("SPY", 1)              # same range again today: no-op
    assert len(service.net_flow_history("SPY", days=1)) == 2


def test_bars_from_history_formats_daily_and_intraday():
    idx = pd.DatetimeIndex(["2026-11-06 14:30", "2026-11-06 14:31"], tz="UTC")
    df = pd.DataFrame({"open": [1.0, None], "high": [2.0, 2.5], "low": [0.5, 1.0],
                       "close": [1.5, 2.0], "volume": [10, None]}, index=idx)
    intraday = bars_from_history(df, intraday=True)
    assert intraday[0] == {"date": "2026-11-06T14:30:00Z", "open": 1.0, "high": 2.0,
                           "low": 0.5, "close": 1.5, "volume": 10}
    assert intraday[1]["open"] is None and intraday[1]["volume"] is None
    assert bars_from_history(df, intraday=False)[0]["date"] == "2026-11-06"
