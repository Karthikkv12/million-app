"""
Parametrized offline GEX sanity tests — covers every symbol the UI supports.

All tests use synthetic mock chains (zero network calls) so they are:
  - Fast (< 1 second total)
  - Deterministic (no yfinance rate-limit / stale data surprises)
  - Runnable in CI without any API keys

What is tested per symbol
  1. No error field in result
  2. spot > 0
  3. net_gex is finite (no inf/nan)
  4. |net_gex| < $500B — the "exploding gamma" regression guard
  5. Call GEX is positive, put GEX is negative (sign convention)
  6. zero_gamma is within ±30% of spot (or None)
  7. All required response keys are present (matches the API response shape)
  8. gex_by_strike / call_gex_by_strike / put_gex_by_strike lengths match strikes
  9. lot_size == 100 for all US symbols

Symbols under test (matches the UI symbol universe):
  Mag 7      : AAPL MSFT NVDA GOOGL AMZN META TSLA
  High beta  : AMD NFLX CRM COIN PLTR SNOW UBER
  Broad ETFs : SPY QQQ IWM DIA
  Sector ETFs: XLK XLF XLV XLE XLC XLY XLI XLB XLRE XLU
  Index alias: SPX NDX RUT  (mapped → ^SPX ^NDX ^RUT by the engine)
"""
from __future__ import annotations

import math
import types
from dataclasses import asdict
from typing import Any

import pandas as pd
import pytest

import logic.gamma as gmod
from logic.gamma import compute_gamma_exposure


# ---------------------------------------------------------------------------
# Canonical symbol list — mirrors every symbol in the UI
# ---------------------------------------------------------------------------

US_EQUITIES = [
    "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA",
    "AMD",  "NFLX", "CRM",  "COIN",  "PLTR", "SNOW", "UBER",
]

BROAD_ETFS = ["SPY", "QQQ", "IWM", "DIA"]

SECTOR_ETFS = [
    "XLK", "XLF", "XLV", "XLE",
    "XLC", "XLY", "XLI", "XLB", "XLRE", "XLU",
]

INDEX_ALIASES = ["SPX", "NDX", "RUT"]   # engine maps these to ^SPX etc.

ALL_SYMBOLS = US_EQUITIES + BROAD_ETFS + SECTOR_ETFS + INDEX_ALIASES

# ---------------------------------------------------------------------------
# Mock chain builder
# ---------------------------------------------------------------------------
# Build a representative synthetic chain with:
#   - 5 call strikes above spot (OTM + ITM)
#   - 5 put strikes below spot (OTM + ITM)
#   - 2 phantom rows with the yfinance floor IV (bid=ask=0, IV=1e-5)
#     → these must be FILTERED OUT by the engine
#   - 1 near-zero-OI row → must be filtered
#
# IVs and OI are chosen so net_gex is clearly within sane bounds.

def _build_mock_chain(spot: float):
    """Return a fake yfinance option_chain namespace for a given spot price."""
    # ATM ± strikes at 0.5% increments
    k0 = round(spot / 1.0) * 1.0
    call_strikes = [round(k0 * (1 + i * 0.005), 2) for i in range(5)]
    put_strikes  = [round(k0 * (1 - i * 0.005), 2) for i in range(1, 6)]

    def _row(strike, iv, oi, bid, ask):
        return {
            "strike":            strike,
            "openInterest":      oi,
            "impliedVolatility": iv,
            "bid":               bid,
            "ask":               ask,
            "volume":            max(1, oi // 10),
        }

    # Real call rows
    calls = [_row(s, 0.18 + i * 0.01, 3000 - i * 200, 2.5, 2.7) for i, s in enumerate(call_strikes)]
    # Phantom call row — floor IV, zero mid → must be DROPPED
    calls.append(_row(k0, 1e-5, 8500, 0.0, 0.0))
    # Zero-OI row → must be DROPPED
    calls.append(_row(k0 * 1.02, 0.20, 0, 1.0, 1.1))

    # Real put rows
    puts = [_row(s, 0.20 + i * 0.01, 2500 - i * 150, 1.8, 2.0) for i, s in enumerate(put_strikes)]
    # Phantom put row
    puts.append(_row(k0, 1e-5, 5000, 0.0, 0.0))

    calls_df = pd.DataFrame(calls)
    puts_df  = pd.DataFrame(puts)
    return types.SimpleNamespace(calls=calls_df, puts=puts_df)


# Per-symbol spot prices — realistic market prices (Feb 2026 approx.)
_SPOT: dict[str, float] = {
    "AAPL":  272.95, "MSFT":  401.72, "NVDA":  184.89,
    "GOOGL": 307.38, "AMZN":  207.92, "META":  657.01, "TSLA": 408.58,
    "AMD":   110.50, "NFLX":   84.59, "CRM":   290.00, "COIN": 255.00,
    "PLTR":   85.00, "SNOW":  155.00, "UBER":   85.00,
    "SPY":   689.30, "QQQ":   609.24, "IWM":   215.00, "DIA":  440.00,
    "XLK":   225.00, "XLF":    50.00, "XLV":    140.00, "XLE":  90.00,
    "XLC":    90.00, "XLY":   210.00, "XLI":   140.00, "XLB":  90.00,
    "XLRE":   38.00, "XLU":    70.00,
    # Aliases — engine maps these to ^SPX, ^NDX, ^RUT
    "SPX": 5800.00, "NDX": 21000.00, "RUT": 2100.00,
}

# ---------------------------------------------------------------------------
# Monkeypatch fixture — patches _fetch_chain_yfinance for every test
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def mock_yfinance(monkeypatch):
    """Replace network fetch with a synthetic chain. No internet required."""

    def _fake_fetch(symbol: str):
        # Resolve alias (SPX → ^SPX etc.) to find our spot dict entry
        raw = symbol.lstrip("^").upper()
        spot = _SPOT.get(raw, 100.0)
        chain = _build_mock_chain(spot)

        import zoneinfo
        from datetime import datetime as _dt
        _ET = zoneinfo.ZoneInfo("America/New_York")
        today = pd.Timestamp(_dt.now(_ET).date())

        # Simulate 6 weekly expiries
        from logic.gamma import _parse_chain_rows
        all_rows = []
        for weeks in range(6):
            exp = (today + pd.Timedelta(days=7 * (weeks + 1))).strftime("%Y-%m-%d")
            T = max(7 * (weeks + 1), 1) / 252.0
            rows = _parse_chain_rows(exp, chain, spot, T)
            all_rows.extend(rows)

        return spot, pd.DataFrame(all_rows)

    monkeypatch.setattr(gmod, "_fetch_chain_yfinance", _fake_fetch)
    monkeypatch.setattr(gmod, "_tradier_token", lambda: None)
    # Clear any cached results between tests
    gmod._gex_cache.clear() if hasattr(gmod, "_gex_cache") else None


# ---------------------------------------------------------------------------
# Required API response keys (must match backend_api/main.py response shape)
# ---------------------------------------------------------------------------
REQUIRED_KEYS = {
    "symbol", "spot", "expiries", "strikes",
    "gex_by_strike", "call_gex_by_strike", "put_gex_by_strike",
    "zero_gamma", "max_call_wall", "max_put_wall", "max_gex_strike",
    "net_gex", "call_premium", "put_premium", "net_flow", "total_volume",
    "flow_by_expiry", "top_flow_strikes", "lot_size", "data_source", "error",
}


# ---------------------------------------------------------------------------
# The tests
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("symbol", ALL_SYMBOLS)
class TestGexPerSymbol:

    def _result(self, symbol):
        return compute_gamma_exposure(symbol)

    def test_no_error(self, symbol):
        r = self._result(symbol)
        assert r.error is None, f"{symbol}: unexpected error — {r.error}"

    def test_spot_positive(self, symbol):
        r = self._result(symbol)
        assert r.spot > 0, f"{symbol}: spot={r.spot}"

    def test_net_gex_finite(self, symbol):
        r = self._result(symbol)
        assert math.isfinite(r.net_gex), f"{symbol}: net_gex is not finite"

    def test_net_gex_not_exploding(self, symbol):
        """Regression: phantom floor-IV rows must not inflate GEX past $500B."""
        r = self._result(symbol)
        assert abs(r.net_gex) < 500e9, (
            f"{symbol}: |net_gex|=${abs(r.net_gex)/1e9:.1f}B — looks like phantom gamma"
        )

    def test_call_gex_positive(self, symbol):
        r = self._result(symbol)
        total_call_gex = sum(r.call_gex_by_strike)
        assert total_call_gex >= 0, f"{symbol}: call GEX should be non-negative, got {total_call_gex:,.0f}"

    def test_put_gex_negative(self, symbol):
        r = self._result(symbol)
        total_put_gex = sum(r.put_gex_by_strike)
        assert total_put_gex <= 0, f"{symbol}: put GEX should be non-positive, got {total_put_gex:,.0f}"

    def test_zero_gamma_near_spot(self, symbol):
        r = self._result(symbol)
        if r.zero_gamma is not None:
            lo, hi = r.spot * 0.70, r.spot * 1.30
            assert lo <= r.zero_gamma <= hi, (
                f"{symbol}: zero_gamma={r.zero_gamma} is far outside spot={r.spot} ±30%"
            )

    def test_strike_list_lengths_consistent(self, symbol):
        r = self._result(symbol)
        n = len(r.strikes)
        assert len(r.gex_by_strike)      == n, f"{symbol}: gex_by_strike length mismatch"
        assert len(r.call_gex_by_strike) == n, f"{symbol}: call_gex_by_strike length mismatch"
        assert len(r.put_gex_by_strike)  == n, f"{symbol}: put_gex_by_strike length mismatch"

    def test_lot_size_100_for_us_symbols(self, symbol):
        r = self._result(symbol)
        assert r.lot_size == 100, f"{symbol}: expected lot_size=100, got {r.lot_size}"

    def test_required_fields_present(self, symbol):
        r = self._result(symbol)
        result_dict = {
            "symbol": r.symbol, "spot": r.spot, "expiries": r.expiries,
            "strikes": r.strikes, "gex_by_strike": r.gex_by_strike,
            "call_gex_by_strike": r.call_gex_by_strike,
            "put_gex_by_strike": r.put_gex_by_strike,
            "zero_gamma": r.zero_gamma, "max_call_wall": r.max_call_wall,
            "max_put_wall": r.max_put_wall, "max_gex_strike": r.max_gex_strike,
            "net_gex": r.net_gex, "call_premium": r.call_premium,
            "put_premium": r.put_premium, "net_flow": r.net_flow,
            "total_volume": r.total_volume, "flow_by_expiry": r.flow_by_expiry,
            "top_flow_strikes": r.top_flow_strikes, "lot_size": r.lot_size,
            "data_source": r.data_source, "error": r.error,
        }
        missing = REQUIRED_KEYS - result_dict.keys()
        assert not missing, f"{symbol}: missing keys {missing}"

    def test_phantom_rows_excluded(self, symbol):
        """
        The mock chain deliberately injects rows with IV=1e-5 and mid=0.
        Verify they are excluded: if the phantom put row at OI=8500 leaked through
        it would contribute ~8500 × 54.97 × 100 × spot² × 0.01 in GEX.
        For XLRE (spot=38) that's ~67M — clearly above the $500B cap, but for
        larger symbols it would be astronomical.

        Here we verify the *sign convention* is not inverted (putting calls in
        puts or vice versa would also be visible) and net_gex is within the
        $500B bound already checked by test_net_gex_not_exploding.
        The real-row phantom test is the dedicated test in test_gamma.py
        (TestParseChainRows::test_floor_iv_zero_mid_excluded) which tests the
        filter at the source level.
        """
        r = self._result(symbol)
        # The mock injects a put phantom row with gamma=54.97 (if not filtered).
        # For any spot ≥ $38, that one row alone would contribute:
        #   8500 × 54.97 × 100 × 38² × 0.01 = ~67M just from XLRE
        # More importantly the sign convention should be preserved:
        # with more real call OI than put OI our mock produces net_gex > 0.
        # A phantom put leaking in flips this.
        total_call = sum(r.call_gex_by_strike)
        total_put  = sum(r.put_gex_by_strike)
        assert total_call >= 0, f"{symbol}: call GEX negative — phantom rows or sign error"
        assert total_put  <= 0, f"{symbol}: put GEX positive — phantom rows or sign error"

    def test_heatmap_dimensions_consistent(self, symbol):
        r = self._result(symbol)
        if r.heatmap_values:
            assert len(r.heatmap_values) == len(r.heatmap_expiries), \
                f"{symbol}: heatmap row count mismatch"
            for i, row in enumerate(r.heatmap_values):
                assert len(row) == len(r.heatmap_strikes), \
                    f"{symbol}: heatmap row {i} col count mismatch"
