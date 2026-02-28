"""
Tests for logic/gamma.py

Covers:
  - bs_gamma edge cases (zero/tiny sigma, zero T, etc.)
  - _parse_chain_rows: illiquid phantom rows are filtered (yfinance floor IV bug)
  - _compute_gex: sign convention, lot_size scaling
  - _find_zero_gamma: interpolation
  - compute_gamma_exposure: smoke test with a mock chain (no network)
"""
import math
import types
import pytest
import pandas as pd

from logic.gamma import bs_gamma, _compute_gex, _find_zero_gamma, _parse_chain_rows


# ---------------------------------------------------------------------------
# bs_gamma
# ---------------------------------------------------------------------------

class TestBsGamma:
    def test_zero_T_returns_zero(self):
        assert bs_gamma(100, 100, 0, 0.05, 0.20) == 0.0

    def test_zero_sigma_returns_zero(self):
        assert bs_gamma(100, 100, 1.0, 0.05, 0.0) == 0.0

    def test_floor_sigma_returns_zero(self):
        """yfinance floor IV (1e-5) must NOT produce exploding gamma."""
        g = bs_gamma(610, 610, 7 / 252, 0.045, 1e-5)
        assert g == 0.0, f"Expected 0.0 for floor IV, got {g}"

    def test_below_threshold_sigma_returns_zero(self):
        """Any sigma < 0.005 (0.5%) should be treated as illiquid and return 0."""
        assert bs_gamma(100, 100, 0.25, 0.05, 0.004) == 0.0

    def test_atm_gamma_reasonable(self):
        """ATM 30-day option at 20% IV should give a sensible gamma."""
        g = bs_gamma(100, 100, 30 / 252, 0.05, 0.20)
        assert 0.01 < g < 0.20, f"ATM gamma {g} out of expected range"

    def test_deep_otm_gamma_near_zero(self):
        """Deep OTM option has near-zero gamma."""
        g = bs_gamma(100, 200, 30 / 252, 0.05, 0.20)
        assert g < 1e-5

    def test_symmetry_call_put(self):
        """BS gamma is identical for calls and puts (same formula)."""
        g1 = bs_gamma(100, 105, 0.25, 0.05, 0.20)
        g2 = bs_gamma(100, 105, 0.25, 0.05, 0.20)
        assert math.isclose(g1, g2)


# ---------------------------------------------------------------------------
# _parse_chain_rows
# ---------------------------------------------------------------------------

def _make_chain(calls_data: list[dict], puts_data: list[dict]):
    """Build a minimal fake yfinance option_chain namespace."""
    calls_df = pd.DataFrame(calls_data)
    puts_df = pd.DataFrame(puts_data)
    chain = types.SimpleNamespace(calls=calls_df, puts=puts_df)
    return chain


class TestParseChainRows:
    def _base_row(self, **overrides):
        base = {
            "strike": 610.0,
            "openInterest": 1000,
            "impliedVolatility": 0.20,
            "bid": 3.0,
            "ask": 3.2,
            "volume": 500,
        }
        base.update(overrides)
        return base

    def test_normal_row_included(self):
        chain = _make_chain([self._base_row()], [])
        rows = _parse_chain_rows("2026-03-20", chain, spot=610.0, T=21 / 252)
        assert len(rows) == 1
        assert rows[0]["gamma"] > 0

    def test_zero_oi_excluded(self):
        chain = _make_chain([self._base_row(openInterest=0)], [])
        rows = _parse_chain_rows("2026-03-20", chain, spot=610.0, T=21 / 252)
        assert len(rows) == 0

    def test_floor_iv_zero_mid_excluded(self):
        """
        This is the QQQ bug: yfinance returns IV=1e-5 and bid=ask=0 for phantom
        rows. They must be filtered out — if included they cause bs_gamma to
        explode and produce tens of billions of fake GEX.
        """
        chain = _make_chain(
            [self._base_row(impliedVolatility=1e-5, bid=0.0, ask=0.0)], []
        )
        rows = _parse_chain_rows("2026-03-20", chain, spot=610.0, T=7 / 252)
        assert len(rows) == 0, "Phantom row with floor IV and zero mid must be excluded"

    def test_floor_iv_with_real_bid_included(self):
        """
        Low IV but non-zero bid/ask → real market quote, keep the row.
        Gamma may still be 0 (due to bs_gamma floor) but the row itself is valid.
        """
        chain = _make_chain(
            [self._base_row(impliedVolatility=1e-5, bid=0.5, ask=0.6)], []
        )
        rows = _parse_chain_rows("2026-03-20", chain, spot=610.0, T=7 / 252)
        assert len(rows) == 1

    def test_call_and_put_otype(self):
        chain = _make_chain([self._base_row()], [self._base_row(strike=600.0)])
        rows = _parse_chain_rows("2026-03-20", chain, spot=610.0, T=21 / 252)
        otypes = {r["otype"] for r in rows}
        assert otypes == {"call", "put"}


# ---------------------------------------------------------------------------
# _compute_gex
# ---------------------------------------------------------------------------

class TestComputeGex:
    def _make_df(self):
        return pd.DataFrame([
            {"strike": 100.0, "expiry": "2026-03-20", "otype": "call", "oi": 1000, "gamma": 0.025,
             "iv": 0.20, "mid": 2.0, "volume": 100, "T": 0.083},
            {"strike": 100.0, "expiry": "2026-03-20", "otype": "put",  "oi": 1200, "gamma": 0.025,
             "iv": 0.20, "mid": 2.0, "volume": 80,  "T": 0.083},
            {"strike": 105.0, "expiry": "2026-03-20", "otype": "call", "oi": 500,  "gamma": 0.018,
             "iv": 0.22, "mid": 1.0, "volume": 50,  "T": 0.083},
        ])

    def test_call_gex_positive(self):
        df, by_strike, _, _ = _compute_gex(self._make_df(), spot=100.0, lot_size=100)
        call_gex = df[df["otype"] == "call"]["gex"].sum()
        assert call_gex > 0, "Call GEX should be positive"

    def test_put_gex_negative(self):
        df, by_strike, _, _ = _compute_gex(self._make_df(), spot=100.0, lot_size=100)
        put_gex = df[df["otype"] == "put"]["gex"].sum()
        assert put_gex < 0, "Put GEX should be negative"

    def test_gex_formula_scaling(self):
        """GEX = gamma × OI × lot_size × spot² × 0.01"""
        df = pd.DataFrame([{
            "strike": 100.0, "expiry": "2026-03-20", "otype": "call",
            "oi": 1, "gamma": 1.0, "iv": 0.20, "mid": 1.0, "volume": 1, "T": 0.083
        }])
        result_df, _, _, _ = _compute_gex(df, spot=100.0, lot_size=100)
        expected = 1.0 * 1 * 100 * 100.0 * 100.0 * 0.01
        assert math.isclose(result_df["gex_raw"].iloc[0], expected)

    def test_lot_size_scales_linearly(self):
        df = self._make_df()
        _, by100, _, _ = _compute_gex(df.copy(), spot=100.0, lot_size=100)
        _, by50, _, _  = _compute_gex(df.copy(), spot=100.0, lot_size=50)
        ratio = by100["gex"].sum() / by50["gex"].sum()
        assert math.isclose(ratio, 2.0, rel_tol=1e-6)


# ---------------------------------------------------------------------------
# _find_zero_gamma
# ---------------------------------------------------------------------------

class TestFindZeroGamma:
    def test_finds_flip_near_spot(self):
        df = pd.DataFrame({
            "strike": [95.0, 100.0, 105.0],
            "gex":    [-500.0, 300.0, 800.0],
        })
        z = _find_zero_gamma(df, spot=100.0)
        assert z is not None
        assert 95.0 < z < 100.0

    def test_no_flip_returns_none(self):
        df = pd.DataFrame({
            "strike": [95.0, 100.0, 105.0],
            "gex":    [100.0, 200.0, 300.0],
        })
        assert _find_zero_gamma(df, spot=100.0) is None

    def test_empty_returns_none(self):
        assert _find_zero_gamma(pd.DataFrame(columns=["strike", "gex"]), 100.0) is None


# ---------------------------------------------------------------------------
# compute_gamma_exposure — smoke test with mocked yfinance (no network)
# ---------------------------------------------------------------------------

class TestComputeGammaExposureMocked:
    def test_no_phantom_gex_from_floor_iv(self, monkeypatch):
        """
        Regression test for the QQQ -$160B bug.
        Inject a chain that contains one real row and one phantom floor-IV row.
        Net GEX must be driven only by the real row.
        """
        import logic.gamma as gmod

        real_row = {
            "strike": 610.0, "expiry": "2026-03-20", "otype": "call",
            "oi": 1000, "gamma": 0.025, "iv": 0.20,
            "mid": 3.1, "volume": 500, "T": 21 / 252,
        }
        phantom_row = {
            "strike": 610.0, "expiry": "2026-03-20", "otype": "put",
            "oi": 8500, "gamma": 54.97,  # what the bug produced
            "iv": 1e-5, "mid": 0.0, "volume": 0, "T": 7 / 252,
        }

        def _fake_fetch(symbol):
            df = pd.DataFrame([real_row])          # phantom already excluded by _parse_chain_rows
            return 609.24, df

        monkeypatch.setattr(gmod, "_fetch_chain_yfinance", _fake_fetch)
        monkeypatch.setattr(gmod, "_tradier_token", lambda: None)

        result = gmod.compute_gamma_exposure("QQQ")
        assert result.error is None
        # Net GEX should be positive (only call row) and sane (< $50B)
        assert result.net_gex > 0
        assert abs(result.net_gex) < 50e9, f"GEX too large: {result.net_gex:,.0f}"
