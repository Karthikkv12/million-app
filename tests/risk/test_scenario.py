"""risk.scenario: payoff curves, move × IV matrix and breakevens (no network: spot passed in, no cached chain)."""
from datetime import date

import pytest

from optionflow.modules.flow import gamma
from optionflow.modules.risk import scenario as sc

TODAY = date(2026, 11, 13)


@pytest.fixture(autouse=True)
def _no_fetch(monkeypatch):
    from optionflow.modules.flow import service
    monkeypatch.setattr(service, "get_gex", lambda s: service.cached_gex(s))
    gamma.clear_chains()


def test_covered_call_shape():
    legs = [{"kind": "stock", "quantity": 100, "avg_price": 90.0},
            {"kind": "option", "quantity": -1, "otype": "call", "strike": 105, "expiry": "2026-11-20", "iv": 0.4, "avg_price": 1.5}]
    out = sc.scenario("XYZ", legs, days=2, spot=100.0, today=TODAY)
    assert out["error"] is None and [c["label"] for c in out["curves"]] == ["Now", "In 2d", "At expiry"]
    now = dict(zip(out["spots"], out["curves"][0]["pnl"]))
    assert now[min(now, key=lambda s: abs(s - 100))] == pytest.approx(0, abs=1)          # P&L from now is 0 at spot
    exp = out["curves"][-1]["pnl"]
    assert exp[-1] == pytest.approx(exp[-2], abs=1)                    # capped above the strike
    assert 0 < out["delta"] < 100 and out["theta"] > 0 and out["vega"] < 0   # short call: earns decay, hates vol
    # matrix: rows = moves, cols = IV shifts; the centre cell (no move, no IV change) is just 2 days of decay
    mid = out["matrix"][out["moves"].index(0.0)]
    assert mid[out["iv_shifts"].index(0.0)] > 0 and mid[0] > mid[-1]  # IV crush helps a short call
    # since entry: stock +$1,000 at 100, call sold at 1.50 → one breakeven below 90 − 1.5 + call value now
    assert len(out["breakevens"]) == 1 and 85 < out["breakevens"][0] < 90
    assert out["legs"][1]["iv_source"] == "leg"


def test_iv_falls_back_to_default_and_horizon_is_capped_at_expiry():
    legs = [{"kind": "option", "quantity": 1, "otype": "put", "strike": 95, "expiry": "2026-11-16"}]
    out = sc.scenario("XYZ", legs, days=30, spot=100.0, today=TODAY)
    assert out["legs"][0]["iv_source"] == "default" and out["legs"][0]["iv"] == sc.DEFAULT_IV
    assert out["days"] == out["expiry_days"] == 3.0
    assert [c["label"] for c in out["curves"]] == ["Now", "At expiry"]
    assert out["max_loss"] < 0 and out["curves"][-1]["pnl"][-1] == pytest.approx(out["max_loss"])  # premium lost above 95


def test_no_price_is_an_error():
    out = sc.scenario("NOPE", [{"kind": "stock", "quantity": 1}], today=TODAY)
    assert out["error"]


def test_implied_vol_round_trips_black_scholes():
    import numpy as np
    from optionflow.modules.risk.repricing import bs_price
    px = float(bs_price(np.array([100.0]), 105.0, np.array([0.1]), np.array([0.42]), True)[0])
    assert sc.implied_vol(px, 100.0, 105.0, 0.1, True) == pytest.approx(0.42, abs=1e-4)
    assert sc.implied_vol(0.001, 100.0, 50.0, 0.1, True) is None          # below intrinsic: no IV
