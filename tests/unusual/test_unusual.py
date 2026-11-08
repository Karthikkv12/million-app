"""Tests for optionflow/modules/unusual/service.py pure helpers (no network)."""
from optionflow.modules.unusual.service import classify_side, is_unusual, score


def test_side_from_print_location():
    assert classify_side(1.00, 0.90, 1.00) == "ask"
    assert classify_side(0.90, 0.90, 1.00) == "bid"
    assert classify_side(0.95, 0.90, 1.00) == "mid"
    assert classify_side(None, 0.9, 1.0) == "unknown"
    assert classify_side(1.0, 1.2, 1.0) == "unknown"   # crossed quote


def test_unusual_thresholds():
    assert is_unusual(1000, 500, 200_000, min_premium=100_000)          # 2x OI, big premium
    assert not is_unusual(1000, 2000, 200_000, min_premium=100_000)     # below OI
    assert not is_unusual(1000, 100, 50_000, min_premium=100_000)       # premium too small
    assert not is_unusual(100, 10, 500_000, min_premium=100_000)        # volume too small
    assert is_unusual(600, 0, 500_000, min_premium=100_000)             # brand-new contract
    assert not is_unusual(300, 0, 500_000, min_premium=100_000)


def test_score_orders_sensibly():
    big_fresh = score(6.0, 5_000_000, 5, 3)
    small_stale = score(1.3, 120_000, 0, 45)
    assert 0 <= small_stale < big_fresh <= 1
