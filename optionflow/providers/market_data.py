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


# ── Rate-limit back-off (shared by every provider call) ───────────────────────
import logging as _logging
import threading as _threading
import time as _time

_log = _logging.getLogger("optionflow.marketdata")


from optionflow.core.errors import Unavailable as _Unavailable


class MarketDataRateLimited(_Unavailable):
    """The data source is rate-limiting us; no call was made (or the call was refused). HTTP 503."""

    def __init__(self, retry_after: float):
        minutes = max(1, round(retry_after / 60))
        super().__init__(f"Yahoo Finance is rate-limiting requests; try again in about {minutes} min")
        self.retry_after = retry_after


class RateLimitGate:
    """Stop *all* calls to a source after a rate limit: 2 min, doubling up to 30 min.

    `check()` before a call raises MarketDataRateLimited while blocked.
    `trip()` on a rate-limit response; `ok()` after a success resets the delay.
    Logs once per trip, not per refused call.
    """

    def __init__(self, first: float = 120.0, maximum: float = 1800.0):
        self.first, self.maximum = first, maximum
        self._delay = 0.0
        self._until = 0.0
        self._lock = _threading.Lock()

    def remaining(self) -> float:
        return max(0.0, self._until - _time.monotonic())

    def blocked(self) -> bool:
        return self.remaining() > 0

    def check(self) -> None:
        left = self.remaining()
        if left > 0:
            raise MarketDataRateLimited(left)

    def trip(self) -> None:
        with self._lock:
            if self.blocked():                 # already backing off: don't extend or re-log
                return
            self._delay = min(self.maximum, self._delay * 2 if self._delay else self.first)
            self._until = _time.monotonic() + self._delay
            _log.warning("Market data rate-limited: pausing all calls for %ds", int(self._delay))

    def ok(self) -> None:
        if self._delay and not self.blocked():
            with self._lock:
                self._delay = 0.0
                _log.info("Market data calls succeeding again; back-off reset")

    def reset(self) -> None:                   # tests
        with self._lock:
            self._delay, self._until = 0.0, 0.0


def is_rate_limited() -> bool:
    """True while the active provider is backing off (callers can skip work or serve stale)."""
    gate = getattr(get_market_data(), "gate", None)
    return bool(gate and gate.blocked())


def raise_if_rate_limited() -> None:
    """Raise MarketDataRateLimited (HTTP 503) while the active provider is backing off."""
    gate = getattr(get_market_data(), "gate", None)
    if gate is not None:
        gate.check()
