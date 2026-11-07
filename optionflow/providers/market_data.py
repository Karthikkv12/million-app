"""optionflow/providers/market_data.py — the market-data interface.

Every quote, search result, price bar and option chain the app uses comes
through `get_market_data()`. Yahoo Finance is the only implementation today;
another provider (e.g. Tradier) is one new class that implements the same
methods, chosen here.

Tests install a fake with `use_market_data(fake)`.
"""
from __future__ import annotations

from typing import Any, Dict, List, NamedTuple, Optional, Protocol

import pandas as pd

# Columns of OptionChain.rows (one row per contract with open interest):
#   strike, expiry (YYYY-MM-DD), otype ("call"/"put"), oi, volume, iv, mid,
#   gamma (from the feed; NaN when the feed has none), T (years to expiry)
CHAIN_COLUMNS = ["strike", "expiry", "otype", "oi", "volume", "iv", "mid", "gamma", "T"]


class OptionChain(NamedTuple):
    spot: float
    rows: pd.DataFrame


class MarketDataProvider(Protocol):
    name: str

    def search(self, query: str, limit: int) -> List[Dict[str, Any]]:
        """Ticker/company search: [{symbol, name, type, exchange}]."""

    def quote(self, symbol: str) -> Dict[str, Any]:
        """{symbol, price, prev_close, change, change_pct} (None values when unavailable)."""

    def last_price(self, symbol: str) -> Optional[float]:
        """Latest trade price, or None."""

    def watchlist_row(self, symbol: str) -> Dict[str, Any]:
        """Price, change, volume, valuation and range fields for a watchlist table."""

    def stock_info(self, symbol: str) -> Dict[str, Any]:
        """Company profile, valuation, margins and dividend fields."""

    def price_history(self, symbol: str, period: str, interval: str) -> pd.DataFrame:
        """OHLCV bars: UTC DatetimeIndex; columns open, high, low, close, volume."""

    def option_chain(self, symbol: str) -> OptionChain:
        """Spot price and every unexpired contract (see CHAIN_COLUMNS)."""


_override: Optional[MarketDataProvider] = None
_default: Optional[MarketDataProvider] = None


def get_market_data() -> MarketDataProvider:
    """The active market-data provider."""
    global _default
    if _override is not None:
        return _override
    if _default is None:
        from optionflow.providers.yahoo import YahooMarketData
        _default = YahooMarketData()
    return _default


def use_market_data(provider: Optional[MarketDataProvider]) -> None:
    """Replace the provider (tests); pass None to restore the default."""
    global _override
    _override = provider


def bars_from_history(df: pd.DataFrame, intraday: bool) -> List[Dict[str, Any]]:
    """Normalized history frame → JSON bars [{date, open, high, low, close, volume}]."""
    bars: List[Dict[str, Any]] = []
    for ts, row in df.iterrows():
        close = row.get("close")
        if close is None or pd.isna(close):
            continue
        ts = pd.Timestamp(ts)
        ts = ts.tz_localize("UTC") if ts.tzinfo is None else ts.tz_convert("UTC")

        def _f(col: str) -> Optional[float]:
            v = row.get(col)
            return float(v) if v is not None and pd.notna(v) else None

        vol = row.get("volume")
        bars.append({
            "date": ts.strftime("%Y-%m-%dT%H:%M:%SZ") if intraday else ts.strftime("%Y-%m-%d"),
            "open": _f("open"),
            "high": _f("high"),
            "low": _f("low"),
            "close": float(close),
            "volume": int(vol) if vol is not None and pd.notna(vol) else None,
        })
    return bars
