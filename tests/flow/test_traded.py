"""flow.traded: premium traded today from per-contract volume changes (no network, no DB)."""
from datetime import datetime, time, timedelta, timezone

import pandas as pd
import pytest

from optionflow.modules.flow import traded
from optionflow.workers.backfill import ET

C = ("2026-12-18", 100.0, "call")
P = ("2026-12-18", 100.0, "put")


def _weekday():
    d = datetime.now(ET).date()
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def at(hh, mm, day=None):
    return datetime.combine(day or _weekday(), time(hh, mm, 7), ET).astimezone(timezone.utc)


@pytest.fixture(autouse=True)
def _clean():
    traded.clear()
    yield
    traded.clear()


def test_counts_only_new_volume_at_the_current_price():
    assert traded.update("X", [(C, 100, 200.0), (P, 50, 300.0)], now=at(9, 35)) == (0, 0)   # first refresh: baseline
    # price triples, volume unchanged: nothing traded (the old measure counted this as flow)
    assert traded.update("X", [(C, 100, 600.0), (P, 50, 100.0)], now=at(10, 0)) == (0, 0)
    assert traded.update("X", [(C, 110, 600.0), (P, 52, 100.0)], now=at(10, 5)) == (6000, 200)


def test_first_refresh_after_945_counts_volume_so_far():
    assert traded.update("X", [(C, 10, 200.0), (P, 5, 300.0)], now=at(13, 0)) == (2000, 1500)


def test_source_lag_is_ignored_and_a_reset_restarts():
    traded.update("X", [(C, 1000, 1.0)], now=at(9, 35))
    assert traded.update("X", [(C, 900, 1.0)], now=at(9, 40)) == (0, 0)       # lagging source: ignored
    assert traded.update("X", [(C, 1010, 1.0)], now=at(9, 41)) == (10, 0)     # counted from the higher 1000
    assert traded.update("X", [(C, 20, 1.0)], now=at(9, 50)) == (30, 0)       # chain reset: restart from 20


def test_new_contract_later_counts_its_volume_and_missing_ones_keep_state():
    traded.update("X", [(C, 10, 1.0)], now=at(9, 35))
    assert traded.update("X", [(P, 7, 2.0)], now=at(9, 40)) == (0, 14)        # C missing (other source): kept
    assert traded.update("X", [(C, 12, 1.0), (P, 7, 2.0)], now=at(9, 45)) == (2, 14)


def test_outside_session_returns_totals_without_updating():
    assert traded.update("X", [(C, 10, 1.0)], now=at(9, 0)) is None
    traded.update("X", [(C, 10, 1.0)], now=at(9, 35))
    traded.update("X", [(C, 15, 1.0)], now=at(15, 0))
    assert traded.update("X", [(C, 99, 1.0)], now=at(17, 0)) == (5, 0)


def test_new_day_starts_over():
    prev = _weekday() - timedelta(days=1)
    while prev.weekday() >= 5:
        prev -= timedelta(days=1)
    traded.update("X", [(C, 10, 1.0)], now=at(10, 0, prev))
    assert traded.update("X", [(C, 3, 1.0)], now=at(10, 0)) == (3, 0)


def test_restart_restores_today_and_baselines_current_volume():
    calls = []

    def restore(sym, day):
        calls.append((sym, day))
        return (500.0, 200.0)

    assert traded.update("x", [(C, 1000, 1.0)], now=at(13, 0), restore=restore) == (500, 200)
    assert traded.update("X", [(C, 1004, 1.0)], now=at(13, 1), restore=restore) == (504, 200)
    assert calls == [("X", _weekday())]


def test_contracts_keeps_the_nearest_12_expiries():
    exps = [f"2026-12-{d:02d}" for d in range(1, 16)]
    df = pd.DataFrame({"expiry": exps, "strike": [100.0] * 15, "otype": ["call"] * 15,
                       "volume": [1] * 15, "mid": [2.0] * 15})
    df.loc[0, "mid"] = float("nan")
    rows = traded.contracts(df, 100)
    assert [k[0] for k, _, _ in rows] == exps[:12]
    assert rows[0][2] == 0.0 and rows[1][2] == 200.0
