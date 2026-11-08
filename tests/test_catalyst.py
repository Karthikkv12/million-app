"""Tests for logic/catalyst.py pure helpers (no network)."""
from datetime import date

from logic.catalyst import build_signals, days_until, expected_move


def test_days_until():
    assert days_until(date(2026, 11, 12), today=date(2026, 11, 7)) == 5
    assert days_until(None) is None


def test_expected_move_from_straddle():
    m = expected_move(100.0, 3.0, 2.5)
    assert m == {"dollars": 5.5, "pct": 5.5, "low": 94.5, "high": 105.5}


def test_expected_move_rejects_bad_inputs():
    assert expected_move(None, 1, 1) is None
    assert expected_move(100, None, 1) is None
    assert expected_move(100, float("nan"), 1) is None
    assert expected_move(100, -1, 1) is None


def test_signals_cover_main_cases():
    payload = {
        "earnings": {"days_until": 3},
        "expected_move": {"pct": 9.2},
        "volume": {"relative": 2.4, "short_pct_float": 14.0},
        "range": {"position_pct": 98.5},
        "analysts": {"actions": [{"action": "up"}, {"action": "up"}, {"action": "down"}]},
        "dividend": {"ex_days_until": 1},
        "earnings_history": [{"surprise_pct": 5}, {"surprise_pct": 2}, {"surprise_pct": 1}, {"surprise_pct": 7}],
    }
    labels = [s["label"] for s in build_signals(payload)]
    assert "Earnings in 3 days" in labels
    assert "Options price a ±9.2% move" in labels
    assert "Volume 2.4× average" in labels
    assert "Short interest 14.0% of float" in labels
    assert "At a 52-week high" in labels
    assert "2 upgrades in 30 days" in labels
    assert "1 downgrade in 30 days" in labels
    assert "Ex-dividend in 1 day" in labels
    assert "Beat EPS the last 4 quarters" in labels


def test_signals_quiet_stock():
    assert build_signals({"earnings": {"days_until": 60}, "volume": {"relative": 1.0}, "range": {"position_pct": 50}}) == []
