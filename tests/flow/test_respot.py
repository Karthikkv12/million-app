"""Levels re-priced at the live price every second (gamma.respot_gex, service.respot, workers.gex_respot)."""
from __future__ import annotations

import time

import numpy as np
import pandas as pd
import pytest

from optionflow.modules.flow import gamma, service
from optionflow.providers.market_data import CHAIN_COLUMNS, OptionChain
from optionflow.workers import gex_respot


def _chain(feed_gamma: bool = False) -> pd.DataFrame:
    rng = np.random.default_rng(7)
    rows = []
    for e, T in (("2026-11-20", 7 / 365), ("2026-12-18", 35 / 365), ("2027-01-15", 63 / 365)):
        for k in np.arange(80.0, 121.0, 2.5):
            for o in ("call", "put"):
                rows.append({"strike": float(k), "expiry": e, "otype": o, "oi": int(rng.integers(50, 4000)),
                             "volume": int(rng.integers(0, 900)), "iv": float(rng.uniform(0.2, 0.7)),
                             "mid": float(rng.uniform(0.2, 12)), "T": T, "bid": 1.0, "ask": 1.2, "last": 1.1,
                             "gamma": float(rng.uniform(0.001, 0.05)) if feed_gamma else float("nan")})
    return pd.DataFrame(rows, columns=CHAIN_COLUMNS)


class _Provider:
    name = "public"

    def __init__(self, df, spot=100.0):
        self.df, self.spot, self.calls = df, spot, 0
        self.prices = {}

    def option_chain(self, sym):
        self.calls += 1
        return OptionChain(self.spot, self.df, "public")

    def quotes_batch(self, symbols):
        return {s.upper(): {"price": self.prices[s]} for s in symbols if s in self.prices}


@pytest.fixture
def provider(monkeypatch):
    service.clear_cache()
    p = _Provider(_chain())
    monkeypatch.setattr(gamma, "get_market_data", lambda: p)
    monkeypatch.setattr(gex_respot, "get_market_data", lambda: p)
    monkeypatch.setattr(gex_respot, "chains_realtime", lambda: True)
    yield p
    service.clear_cache()


def test_vectorised_greeks_match_the_scalar_formulas():
    df = _chain()
    k, t, iv = df["strike"], df["T"], df["iv"]
    for S in (90.0, 100.0, 113.3):
        g = gamma._bs_gamma_vec(S, k, t, iv)
        v = gamma._bs_vanna_vec(S, k, t, iv)
        assert np.allclose(g, [gamma.bs_gamma(S, a, b, 0.045, c) for a, b, c in zip(k, t, iv)], rtol=1e-12, atol=0)
        assert np.allclose(v, [gamma.bs_vanna(S, a, b, 0.045, c) for a, b, c in zip(k, t, iv)], rtol=1e-12, atol=0)
    # the same guards: no IV, tiny IV, expired, bad strike → 0
    edge = pd.Series([0.0, 0.004, 0.3, 0.3]), pd.Series([0.1, 0.1, 0.0, 0.1]), pd.Series([100.0, 100.0, 100.0, 0.0])
    assert list(gamma._bs_gamma_vec(100.0, edge[2], edge[1], edge[0])) == [0.0, 0.0, 0.0, 0.0]


def test_respot_matches_a_full_refresh_at_that_price(provider):
    full = gamma.compute_gamma_exposure("XYZ")
    assert gamma.respot_gex("XYZ", 100.0).net_gex == pytest.approx(full.net_gex, rel=1e-12)
    moved = gamma.respot_gex("XYZ", 104.0)
    provider.spot = 104.0
    fresh = gamma.compute_gamma_exposure("XYZ")
    assert moved.spot == 104.0 and moved.net_gex == pytest.approx(fresh.net_gex, rel=1e-9)
    assert moved.zero_gamma == fresh.zero_gamma and moved.max_call_wall == fresh.max_call_wall
    assert np.allclose(moved.heatmap_values, fresh.heatmap_values, rtol=1e-9, atol=0)
    assert moved.contracts == [] and fresh.contracts           # respot never feeds traded premium
    assert gamma.respot_gex("NOPE", 100.0) is None


def test_feed_gamma_is_scaled_not_replaced(monkeypatch):
    df = _chain(feed_gamma=True)
    gamma.clear_chains()
    p = _Provider(df)
    monkeypatch.setattr(gamma, "get_market_data", lambda: p)
    base = gamma.compute_gamma_exposure("FEED")
    same = gamma.respot_gex("FEED", 100.0)
    assert same.net_gex == pytest.approx(base.net_gex, rel=1e-12)
    up = gamma.respot_gex("FEED", 101.0)
    assert up.net_gex != pytest.approx(base.net_gex, rel=1e-6)   # moved with the price
    gamma.clear_chains()


def test_service_respot_caches_without_snapshots_or_refetching(provider, monkeypatch):
    stored = []
    monkeypatch.setattr(service.repo, "add_snapshot", lambda **row: stored.append(row))
    service.refresh_gex("XYZ")
    t0 = service._gex_cache["XYZ"][0]
    stored.clear()
    r = service.respot("XYZ", 101.5)
    assert r is not None and service.cached_gex("XYZ").spot == 101.5
    assert service._gex_cache["XYZ"][0] == t0                    # keeps the full refresh's time
    assert provider.calls == 1 and stored == []
    assert service.respot("XYZ", 101.5) is None                  # price unchanged: nothing to do
    monkeypatch.setattr(service.gamma, "chain_age", lambda s: service.RESPOT_MAX_CHAIN_AGE + 1)
    assert service.respot("XYZ", 102.0) is None                  # chain too old: wait for the poller


def test_worker_tick_reprices_watched_symbols_from_one_quotes_call(provider, monkeypatch):
    service.refresh_gex("XYZ")
    service.watch(["XYZ", "ABC"])                                # ABC has no chain yet: skipped
    asked = []
    real = provider.quotes_batch
    provider.quotes_batch = lambda syms: asked.append(list(syms)) or real(syms)
    provider.prices = {"XYZ": 99.25}
    assert gex_respot.tick() == 1 and asked == [["XYZ"]]
    assert service.cached_gex("XYZ").spot == 99.25
    assert gex_respot.tick() == 0                                # same price: no work
    monkeypatch.setattr(gex_respot, "chains_realtime", lambda: False)
    provider.prices = {"XYZ": 98.0}
    assert gex_respot.tick() == 0 and len(asked) == 2            # Yahoo / backing off: no quotes request
