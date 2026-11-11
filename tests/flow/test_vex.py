"""VEX (vanna exposure): Black-Scholes vanna, sign convention, heatmap grid shape."""
import math

import pandas as pd
import pytest

from optionflow.modules.flow import gamma as gmod
from optionflow.modules.flow.gamma import bs_vanna
from optionflow.providers.market_data import OptionChain


def _bs_delta_call(S, K, T, r, sigma):
    d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
    return 0.5 * (1 + math.erf(d1 / math.sqrt(2)))


@pytest.mark.parametrize("K", [560.0, 580.0, 600.0])
def test_vanna_matches_finite_difference_of_delta(K):
    S, T, r, sigma, h = 580.0, 20 / 365, 0.045, 0.18, 1e-4
    fd = (_bs_delta_call(S, K, T, r, sigma + h) - _bs_delta_call(S, K, T, r, sigma - h)) / (2 * h)
    assert bs_vanna(S, K, T, r, sigma) == pytest.approx(fd, rel=1e-4)


def test_vanna_reference_values():
    """Values the cloud session checked (C-12): 560/580/600 @ S=580, T=20d, σ=.18."""
    got = [round(bs_vanna(580, k, 20 / 365, 0.045, 0.18), 4) for k in (560, 580, 600)]
    assert got == pytest.approx([-1.2721, -0.0827, 1.3073], abs=2e-3)


@pytest.mark.parametrize("args", [(580, 580, 0, 0.045, 0.2), (580, 580, 0.1, 0.045, 0.004),
                                  (0, 580, 0.1, 0.045, 0.2), (580, 0, 0.1, 0.045, 0.2)])
def test_vanna_guards(args):
    assert bs_vanna(*args) == 0.0


def test_vex_grid_and_sign(fake_market_data):
    rows = [
        {"strike": 600.0, "expiry": "2099-01-16", "otype": "call", "oi": 1000, "gamma": 0.01, "iv": 0.2,
         "mid": 3.0, "volume": 10, "T": 20 / 365},
        {"strike": 560.0, "expiry": "2099-01-16", "otype": "put", "oi": 500, "gamma": 0.01, "iv": 0.2,
         "mid": 3.0, "volume": 10, "T": 20 / 365},
        {"strike": 580.0, "expiry": "2099-01-23", "otype": "call", "oi": 200, "gamma": 0.01, "iv": 0.2,
         "mid": 3.0, "volume": 10, "T": 27 / 365},
    ]
    fake_market_data.chain_fn = lambda symbol: OptionChain(580.0, pd.DataFrame(rows))
    r = gmod.compute_gamma_exposure("SPY")
    assert r.error is None
    assert len(r.heatmap_vex_values) == len(r.heatmap_values) > 0
    assert all(len(a) == len(b) for a, b in zip(r.heatmap_vex_values, r.heatmap_values))
    i600 = r.heatmap_strikes.index(600.0)
    i560 = r.heatmap_strikes.index(560.0)
    exp = r.heatmap_expiries.index("2099-01-16")
    # OTM call (K>S) has positive vanna → +VEX; OTM put (K<S) has negative vanna, put sign − → +VEX
    call_vex = bs_vanna(580, 600, 20 / 365, 0.045, 0.2) * 1000 * 100 * 580 * 0.01
    put_vex = -bs_vanna(580, 560, 20 / 365, 0.045, 0.2) * 500 * 100 * 580 * 0.01
    assert r.heatmap_vex_values[exp][i600] == pytest.approx(call_vex)
    assert r.heatmap_vex_values[exp][i560] == pytest.approx(put_vex)
    assert call_vex > 0 and put_vex > 0
    assert r.net_vex == pytest.approx(sum(map(sum, r.heatmap_vex_values)))
