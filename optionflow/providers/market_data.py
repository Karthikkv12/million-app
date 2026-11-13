"""optionflow/providers/market_data.py — the market-data interface.

Every quote, search result, price bar and option chain the app uses comes
through `get_market_data()`. With PUBLIC_API_SECRET set (the normal setup),
Public.com is the default for option chains (GEX/VEX heatmaps), option contracts
(unusual scanner, catalyst expected move), prices (quote, last_price, last_prices,
quotes_batch) and price history (daily and intraday bars), falling back to Yahoo
per call or per symbol (`PublicFirstMarketData`). Search, company data and the
catalyst fields (earnings, analysts, dividends, news) are Yahoo's: Public has no
equivalent. Without the secret, Yahoo serves everything.

Tests install a fake with `use_market_data(fake)`.
"""
from __future__ import annotations

from typing import Any, Dict, List, NamedTuple, Optional, Protocol

import pandas as pd

# Columns of OptionChain.rows (one row per contract with open interest):
#   strike, expiry (YYYY-MM-DD), otype ("call"/"put"), oi, volume, iv, mid,
#   gamma (from the feed; NaN when the feed has none), T (years to expiry),
#   bid / ask / last (quote and last trade price; None when the feed has none; flow.traded.side needs them)
CHAIN_COLUMNS = ["strike", "expiry", "otype", "oi", "volume", "iv", "mid", "gamma", "T", "bid", "ask", "last"]


# Columns of ContractChain.rows (every quoted contract, open interest or not):
#   strike, expiry (YYYY-MM-DD), otype ("call"/"put"), oi, volume, bid, ask, last, iv (None when unquoted)
# Extended-hours fields on a Public quote (see public.normalize_quote); None from Yahoo.
SESSION_FIELDS = ("session", "regular_close", "regular_close_date", "ext_change", "ext_change_pct")
QUOTE_FIELDS = ("price", "prev_close", "change", "change_pct") + SESSION_FIELDS

CONTRACT_COLUMNS = ["strike", "expiry", "otype", "oi", "volume", "bid", "ask", "last", "iv"]


class ContractChain(NamedTuple):
    spot: Optional[float]
    rows: pd.DataFrame
    source: str = ""


class OptionChain(NamedTuple):
    spot: float
    rows: pd.DataFrame
    source: str = ""          # provider that actually served it ("" → the provider's name)


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

    def price_history(self, symbol: str, period: str, interval: str, prepost: bool = False) -> pd.DataFrame:
        """OHLCV bars: UTC DatetimeIndex; columns open, high, low, close, volume. `prepost` adds
        pre/after-market bars to intraday intervals (ignored for daily and longer)."""

    def option_chain(self, symbol: str) -> OptionChain:
        """Spot price and every unexpired contract (see CHAIN_COLUMNS)."""

    def option_expiries(self, symbol: str) -> List[str]:
        """Listed expiries, YYYY-MM-DD, nearest first."""

    def option_contracts(self, symbol: str, expiries: Optional[List[str]] = None,
                         max_dte: int = 60, max_expiries: int = 4) -> ContractChain:
        """Spot and every quoted contract (see CONTRACT_COLUMNS) for `expiries`, or the nearest
        `max_expiries` within `max_dte` days."""


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
        from optionflow.core.settings import get_settings
        s = get_settings()
        if s.public_api_secret:
            from optionflow.providers.public import (
                PublicClient, PublicHistory, PublicOptionChains, PublicQuotes,
            )
            client = PublicClient(s.public_api_secret, s.public_account_id)
            _default = PublicFirstMarketData(PublicOptionChains(client), _default, PublicQuotes(client),
                                             PublicHistory(client))
    return _default


class PublicFirstMarketData:
    """Public.com first, Yahoo (`fallback`) when Public fails or can't serve a symbol.

    - `option_chain`, `option_expiries`, `option_contracts` from `chains` (PublicOptionChains).
    - `quote`, `last_price`, `last_prices`, `quotes_batch` from `quotes` (PublicQuotes), when given.
    - `price_history` from `history` (PublicHistory), when given.
    Every other method (search, stock_info, watchlist_row fundamentals, raw_ticker for the
    catalyst-only fields) and `gate` (the Yahoo back-off) are the fallback's.
    """

    def __init__(self, chains: Any, fallback: Any, quotes: Any = None, history: Any = None):
        self.chains = chains
        self.fallback = fallback
        self.quotes = quotes
        self.history = history
        self.name = f"{chains.name}+{fallback.name}"
        self.gate = getattr(fallback, "gate", None)
        self._warned = False
        self._quotes_warned = False
        self._failing: set = set()               # which Public features are currently falling back

    def __getattr__(self, attr: str) -> Any:     # search, stock_info, raw_ticker, …
        return getattr(self.fallback, attr)

    def _primary(self, feature: str, source: Any, call, fallback_call, what: str):
        """Public first, the fallback on any failure; log the switch once each way per feature."""
        if source is not None:
            try:
                out = call()
                if feature in self._failing:
                    self._failing.discard(feature)
                    _log.info("%s %s working again", source.name, feature)
                return out
            except Exception as exc:              # auth, unsupported symbol/interval, 429, outage
                if feature not in self._failing:
                    self._failing.add(feature)
                    _log.warning("%s %s failed for %s (%s); using %s",
                                 source.name, feature, what, exc, self.fallback.name)
        return fallback_call()

    # ── history and contracts: Public first ──────────────────────────────────
    def price_history(self, symbol: str, period: str, interval: str, prepost: bool = False) -> pd.DataFrame:
        kw = {"prepost": True} if prepost else {}     # providers without the flag keep working

        def _yahoo() -> pd.DataFrame:
            df = self.fallback.price_history(symbol, period, interval, **kw)
            df.attrs.setdefault("source", self.fallback.name)
            return df
        supports = getattr(self.history, "supports", None)
        if self.history is None or (supports is not None and not supports(symbol, period, interval, **kw)):
            return _yahoo()
        return self._primary("price history", self.history,
                             lambda: self.history.price_history(symbol, period, interval, **kw),
                             _yahoo, f"{symbol} {period}/{interval}")

    def option_expiries(self, symbol: str) -> List[str]:
        return self._primary("expiries", self.chains, lambda: self.chains.option_expiries(symbol),
                             lambda: self.fallback.option_expiries(symbol), symbol)

    def option_contracts(self, symbol: str, expiries: Optional[List[str]] = None,
                         max_dte: int = 60, max_expiries: int = 4) -> ContractChain:
        def _yahoo() -> ContractChain:
            c = self.fallback.option_contracts(symbol, expiries, max_dte, max_expiries)
            return c if c.source else c._replace(source=self.fallback.name)
        return self._primary("option contracts", self.chains,
                             lambda: self.chains.option_contracts(symbol, expiries, max_dte, max_expiries),
                             _yahoo, symbol)

    # ── prices: Public first ──────────────────────────────────────────────────
    def _public_quotes(self, symbols: List[str]) -> Dict[str, Dict[str, Any]]:
        if self.quotes is None or not symbols:
            return {}
        try:
            got = self.quotes.quotes(symbols)
        except Exception as exc:                  # auth, 429, outage: Yahoo for this call
            if not self._quotes_warned:
                _log.warning("%s quotes failed (%s); using %s", self.quotes.name, exc, self.fallback.name)
                self._quotes_warned = True
            return {}
        if self._quotes_warned:
            _log.info("%s quotes working again", self.quotes.name)
            self._quotes_warned = False
        return got

    def quotes_batch(self, symbols: List[str]) -> Dict[str, Dict[str, Any]]:
        """{SYMBOL: {symbol, price, prev_close, change, change_pct, volume}} for the symbols Public
        priced, in one request. Missing symbols are left out: the caller decides on a fallback."""
        return self._public_quotes(symbols)

    def quote(self, symbol: str) -> Dict[str, Any]:
        q = self._public_quotes([symbol]).get(symbol.strip().upper())
        if q is not None:
            return {k: q.get(k) for k in QUOTE_FIELDS} | {"symbol": symbol}
        return self.fallback.quote(symbol)

    def last_price(self, symbol: str) -> Optional[float]:
        q = self._public_quotes([symbol]).get(symbol.strip().upper())
        return q["price"] if q is not None else self.fallback.last_price(symbol)

    def last_prices(self, symbols: List[str]) -> Dict[str, float]:
        """{symbol: price}: one Public request for all of them; Yahoo for any Public missed."""
        got = self._public_quotes(symbols)
        out: Dict[str, float] = {}
        for sym in symbols:
            q = got.get(sym.strip().upper())
            if q is not None:
                out[sym] = q["price"]
                continue
            try:
                p = self.fallback.last_price(sym)
            except Exception:
                p = None
            if p:
                out[sym] = p
        return out

    def chains_blocked(self) -> bool:
        """True only when neither source can serve a chain right now."""
        def _blocked(p: Any) -> bool:
            g = getattr(p, "gate", None)
            return bool(g and g.blocked())
        return _blocked(self.chains) and _blocked(self.fallback)

    def option_chain(self, symbol: str) -> OptionChain:
        try:
            chain = self.chains.option_chain(symbol)
            if self._warned:
                _log.info("%s option chains working again", self.chains.name)
                self._warned = False
            return chain
        except Exception as exc:                  # any failure: auth, bad symbol, 429, outage
            primary_error = exc
            if not self._warned:
                _log.warning("%s option chain failed for %s (%s); using %s",
                             self.chains.name, symbol, exc, self.fallback.name)
                self._warned = True
        try:
            chain = self.fallback.option_chain(symbol)
        except MarketDataRateLimited as exc:
            # Both sources failed: say so, instead of blaming only the fallback.
            minutes = max(1, round(exc.retry_after / 60))
            primary = getattr(self.chains, "label", self.chains.name)
            why = "is rate-limiting" if isinstance(primary_error, MarketDataRateLimited) else "is unavailable"
            raise MarketDataRateLimited(
                exc.retry_after, exc.source,
                f"Option data is unavailable: {primary} {why} and {exc.source} is rate-limiting; "
                f"try again in about {minutes} min",
            ) from exc
        return chain if chain.source else chain._replace(source=self.fallback.name)


ChainFallbackMarketData = PublicFirstMarketData     # old name (tests, imports)


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

    def __init__(self, retry_after: float, source: str = "Yahoo Finance", message: Optional[str] = None):
        minutes = max(1, round(retry_after / 60))
        super().__init__(message or f"{source} is rate-limiting requests; try again in about {minutes} min")
        self.retry_after = retry_after
        self.source = source


class RateLimitGate:
    """Stop *all* calls to a source after a rate limit: 2 min, doubling up to 30 min.

    `check()` before a call raises MarketDataRateLimited while blocked.
    `trip()` on a rate-limit response; `ok()` after a success resets the delay.
    Logs once per trip, not per refused call.
    """

    def __init__(self, first: float = 120.0, maximum: float = 1800.0, source: str = "Yahoo Finance"):
        self.first, self.maximum = first, maximum
        self.source = source
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
            raise MarketDataRateLimited(left, self.source)

    def trip(self) -> None:
        with self._lock:
            if self.blocked():                 # already backing off: don't extend or re-log
                return
            self._delay = min(self.maximum, self._delay * 2 if self._delay else self.first)
            self._until = _time.monotonic() + self._delay
            _log.warning("%s rate-limited: pausing all calls for %ds", self.source, int(self._delay))

    def ok(self) -> None:
        if self._delay and not self.blocked():
            with self._lock:
                self._delay = 0.0
                _log.info("%s calls succeeding again; back-off reset", self.source)

    def reset(self) -> None:                   # tests
        with self._lock:
            self._delay, self._until = 0.0, 0.0


def is_rate_limited() -> bool:
    """True while the active provider is backing off (callers can skip work or serve stale)."""
    gate = getattr(get_market_data(), "gate", None)
    return bool(gate and gate.blocked())


def chains_rate_limited() -> bool:
    """True while no source can serve option chains (the GEX poller skips its cycle)."""
    md = get_market_data()
    blocked = getattr(md, "chains_blocked", None)
    return bool(blocked()) if blocked else is_rate_limited()


def chains_realtime() -> bool:
    """True while option chains come from a real-time source (Public.com, not backing off)."""
    chains = getattr(get_market_data(), "chains", None)
    gate = getattr(chains, "gate", None)
    return bool(getattr(chains, "realtime", False)) and not (gate and gate.blocked())


def raise_if_rate_limited() -> None:
    """Raise MarketDataRateLimited (HTTP 503) while the active provider is backing off."""
    gate = getattr(get_market_data(), "gate", None)
    if gate is not None:
        gate.check()
