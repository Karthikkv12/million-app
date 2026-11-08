"""optionflow/providers/yahoo.py — Yahoo Finance (yfinance) market data.

The only module that imports yfinance. Free, ~15-minute delayed, no API key.
"""
from __future__ import annotations

import functools
import math
import threading
import warnings
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any, Dict, List, Optional

import pandas as pd
import yfinance as yf
from cachetools import TTLCache

from optionflow.providers.market_data import CHAIN_COLUMNS, MarketDataRateLimited, OptionChain, RateLimitGate

try:
    from yfinance.exceptions import YFRateLimitError
except Exception:  # older yfinance
    class YFRateLimitError(Exception):
        pass

# ── Rate limits ────────────────────────────────────────────────────────────────
GATE = RateLimitGate(first=120.0, maximum=1800.0)   # one gate for every Yahoo call
_tl = threading.local()

MAX_CHAIN_DTE = 60          # option chains: expiries within 60 days…
MAX_CHAIN_EXPIRIES = 12     # …and at most 12 of them (the board shows 8)
_chain_cache: TTLCache = TTLCache(maxsize=512, ttl=300)   # (symbol, expiry) -> parsed rows, 5 min


def _is_rate_limit(exc: BaseException) -> bool:
    if isinstance(exc, (YFRateLimitError, MarketDataRateLimited)):
        return True
    msg = str(exc).lower()
    return "too many requests" in msg or "rate limit" in msg or "429" in msg


def _note(exc: BaseException) -> None:
    """Remember a rate limit seen inside a method that otherwise handles its own errors."""
    if _is_rate_limit(exc):
        _tl.limited = True


def _guarded(fn):
    """Refuse while backing off; trip the gate on any rate limit; reset it on success."""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        GATE.check()
        _tl.limited = False
        try:
            out = fn(*args, **kwargs)
        except Exception as exc:
            if _is_rate_limit(exc):
                GATE.trip()
                raise MarketDataRateLimited(GATE.remaining()) from exc
            raise
        if getattr(_tl, "limited", False):
            GATE.trip()
            raise MarketDataRateLimited(GATE.remaining())
        GATE.ok()
        return out
    return wrapper


class _GuardedTicker:
    """yfinance Ticker whose attribute reads and method calls all go through the gate."""

    def __init__(self, ticker: Any):
        self._ticker = ticker

    def __getattr__(self, name: str) -> Any:
        value = _guarded(lambda: getattr(self._ticker, name))()
        if callable(value):
            return _guarded(value)
        return value

_REC_LABELS = {
    "strong_buy": "Strong Buy", "buy": "Buy", "hold": "Hold",
    "underperform": "Underperform", "sell": "Sell",
}


def _sf(v: Any) -> Optional[float]:
    try:
        return float(v) if v is not None else None
    except Exception:
        return None


def _si(v: Any) -> Optional[int]:
    try:
        return int(v) if v is not None else None
    except Exception:
        return None


def _num(v: Any, default: float = 0.0) -> float:
    """float(v), treating None and NaN as `default`."""
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return default
    return float(v)


def _fmt_mktcap(v: Optional[float]) -> Optional[str]:
    if v is None:
        return None
    if v >= 1e12:
        return f"{v/1e12:.2f}T"
    if v >= 1e9:
        return f"{v/1e9:.2f}B"
    if v >= 1e6:
        return f"{v/1e6:.2f}M"
    return str(int(v))


def _info_and_fast(sym: str):
    """(info dict, fast_info getter) for a ticker; missing pieces are empty."""
    ticker = yf.Ticker(sym)
    info: Dict[str, Any] = {}
    try:
        info = ticker.info or {}
    except Exception as exc:
        _note(exc)
    fast = None
    try:
        fast = ticker.fast_info
    except Exception as exc:
        _note(exc)

    def _fi(attr: str) -> Optional[float]:
        try:
            v = getattr(fast, attr, None)
            return float(v) if v is not None else None
        except Exception:
            return None

    return info, _fi


def parse_chain_rows(exp: str, chain: Any, T: float) -> List[Dict[str, Any]]:
    """One expiry of a yfinance option_chain → normalized rows (see CHAIN_COLUMNS).

    Drops rows with no strike or no open interest, and Yahoo's phantom rows:
    for contracts with no market Yahoo reports IV=1e-5 with zero bid/ask.
    Those rows have real OI but no price signal, and near-zero sigma makes
    Black-Scholes gamma explode (~50 vs ~0.025 ATM), so they are discarded.
    `gamma` is the feed's own value, or NaN when the feed has none.
    """
    rows: List[Dict[str, Any]] = []
    for otype, df in [("call", chain.calls), ("put", chain.puts)]:
        if df is None or df.empty:
            continue
        for _, opt in df.iterrows():
            try:
                strike = _num(opt.get("strike", 0))
                if strike <= 0:
                    continue
                oi = int(_num(opt.get("openInterest", 0)))
                if oi <= 0:
                    continue
                iv = _num(opt.get("impliedVolatility", 0))
                mid = (_num(opt.get("bid", 0)) + _num(opt.get("ask", 0))) / 2.0
                if iv < 0.005 and mid == 0.0:
                    continue
                feed_gamma = _num(opt.get("gamma", None), default=float("nan"))
                rows.append({
                    "strike": strike,
                    "expiry": exp,
                    "otype": otype,
                    "oi": oi,
                    "volume": int(_num(opt.get("volume", 0))),
                    "iv": iv,
                    "mid": mid,
                    "gamma": feed_gamma if feed_gamma > 0 else float("nan"),
                    "T": T,
                })
            except Exception:
                continue
    return rows


class YahooMarketData:
    name = "yfinance"
    gate = GATE

    # ── Search ────────────────────────────────────────────────────────────────
    @_guarded
    def search(self, query: str, limit: int) -> List[Dict[str, Any]]:
        try:
            res = yf.Search(query, max_results=min(limit, 20), enable_fuzzy_query=True)
            quotes = res.quotes or []
        except Exception as exc:
            _note(exc)
            return []

        def _rank(r: dict) -> int:
            ex = r.get("exchDisp", "") or ""
            if ex in {"NASDAQ", "NYSE", "NYSE ARCA", "NYSE MKT"}:
                return 0
            if ex in {"NSE", "BSE", "Bombay"}:
                return 1
            return 2

        results: List[Dict[str, Any]] = []
        seen: set[str] = set()
        for q in sorted(quotes, key=_rank):
            sym = (q.get("symbol") or "").strip()
            if not sym or sym in seen:
                continue
            seen.add(sym)
            results.append({
                "symbol": sym,
                "name": (q.get("shortname") or q.get("longname") or "").strip(),
                "type": (q.get("typeDisp") or q.get("quoteType") or "").strip(),
                "exchange": (q.get("exchDisp") or q.get("exchange") or "").strip(),
            })
        return results

    # ── Prices ────────────────────────────────────────────────────────────────
    @_guarded
    def quote(self, symbol: str) -> Dict[str, Any]:
        try:
            info = yf.Ticker(symbol).fast_info
            price = float(info.last_price) if info.last_price is not None else None
            prev = float(info.previous_close) if info.previous_close is not None else None
            change = round(price - prev, 4) if price is not None and prev is not None else None
            change_pct = round((change / prev) * 100, 4) if change is not None and prev else None
            return {"symbol": symbol, "price": price, "prev_close": prev,
                    "change": change, "change_pct": change_pct}
        except Exception as exc:
            _note(exc)
            return {"symbol": symbol, "price": None, "prev_close": None,
                    "change": None, "change_pct": None}

    @_guarded
    def last_price(self, symbol: str) -> Optional[float]:
        ticker = yf.Ticker(symbol)
        fi = ticker.fast_info
        price = float(getattr(fi, "last_price", None) or getattr(fi, "regularMarketPrice", None) or 0.0)
        if price <= 0:
            hist = ticker.history(period="1d")
            if not hist.empty:
                price = float(hist["Close"].iloc[-1])
        return price if price > 0 else None

    @_guarded
    def price_history(self, symbol: str, period: str, interval: str) -> pd.DataFrame:
        hist = yf.Ticker(symbol).history(period=period, interval=interval)
        if hist is None or hist.empty:
            return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
        idx = pd.DatetimeIndex(hist.index)
        hist.index = idx.tz_localize("UTC") if idx.tz is None else idx.tz_convert("UTC")
        hist = hist.rename(columns=str.lower)
        return hist[[c for c in ["open", "high", "low", "close", "volume"] if c in hist.columns]]

    # ── Company data ──────────────────────────────────────────────────────────
    @_guarded
    def watchlist_row(self, symbol: str) -> Dict[str, Any]:
        sym = symbol
        try:
            info, _fi = _info_and_fast(sym)
            price = _sf(info.get("regularMarketPrice")) or _fi("last_price")
            prev = _sf(info.get("regularMarketPreviousClose")) or _sf(info.get("previousClose")) or _fi("previous_close")
            change = round(price - prev, 4) if price is not None and prev is not None else None
            change_pct = round((change / prev) * 100, 4) if change is not None and prev else None
            volume = _sf(info.get("regularMarketVolume")) or _fi("three_month_average_volume")
            avg_vol = _sf(info.get("averageVolume")) or _sf(info.get("averageDailyVolume10Day"))
            rel_vol = round(volume / avg_vol, 2) if volume and avg_vol else None
            mktcap = _sf(info.get("marketCap")) or _fi("market_cap")
            rec = info.get("recommendationKey") or info.get("recommendation")
            return {
                "symbol": sym,
                "name": info.get("longName") or info.get("shortName") or sym,
                "price": price,
                "prev_close": prev,
                "change": change,
                "change_pct": change_pct,
                "volume": int(volume) if volume else None,
                "avg_volume": int(avg_vol) if avg_vol else None,
                "rel_volume": rel_vol,
                "market_cap": mktcap,
                "market_cap_fmt": _fmt_mktcap(mktcap),
                "pe_ratio": _sf(info.get("trailingPE")),
                "forward_pe": _sf(info.get("forwardPE")),
                "eps_ttm": _sf(info.get("trailingEps")),
                "eps_growth": _sf(info.get("earningsGrowth")),
                "div_yield": _sf(info.get("dividendYield")),
                "sector": info.get("sector"),
                "industry": info.get("industry"),
                "analyst_rating": _REC_LABELS.get((rec or "").lower(), rec or None),
                "beta": _sf(info.get("beta")),
                "week_52_high": _sf(info.get("fiftyTwoWeekHigh")) or _fi("year_high"),
                "week_52_low": _sf(info.get("fiftyTwoWeekLow")) or _fi("year_low"),
                "day_high": _sf(info.get("dayHigh")) or _fi("day_high"),
                "day_low": _sf(info.get("dayLow")) or _fi("day_low"),
                "fifty_day_avg": _sf(info.get("fiftyDayAverage")) or _fi("fifty_day_average"),
                "two_hundred_day_avg": _sf(info.get("twoHundredDayAverage")) or _fi("two_hundred_day_average"),
                "error": None,
            }
        except Exception as exc:
            _note(exc)
            return {
                "symbol": sym, "name": sym, "price": None, "prev_close": None,
                "change": None, "change_pct": None, "volume": None, "avg_volume": None,
                "rel_volume": None, "market_cap": None, "market_cap_fmt": None,
                "pe_ratio": None, "forward_pe": None, "eps_ttm": None, "eps_growth": None,
                "div_yield": None, "sector": None, "industry": None,
                "analyst_rating": None, "beta": None,
                "week_52_high": None, "week_52_low": None,
                "day_high": None, "day_low": None,
                "fifty_day_avg": None, "two_hundred_day_avg": None,
                "error": str(exc),
            }

    @_guarded
    def stock_info(self, symbol: str) -> Dict[str, Any]:
        sym = symbol
        try:
            info, _fi = _info_and_fast(sym)
            return {
                "symbol": sym,
                "name": info.get("longName") or info.get("shortName") or sym,
                "sector": info.get("sector"), "industry": info.get("industry"),
                "description": info.get("longBusinessSummary"),
                "website": info.get("website"),
                "exchange": info.get("exchange") or info.get("exchangeName"),
                "currency": info.get("currency", "USD"),
                "quote_type": info.get("quoteType"),
                "country": info.get("country"),
                "employees": _si(info.get("fullTimeEmployees")),
                "market_cap": _sf(info.get("marketCap")) or _fi("market_cap"),
                "enterprise_value": _sf(info.get("enterpriseValue")),
                "shares_outstanding": _sf(info.get("sharesOutstanding")) or _fi("shares"),
                "float_shares": _sf(info.get("floatShares")),
                "avg_volume": _sf(info.get("averageVolume")),
                "avg_volume_10d": _sf(info.get("averageDailyVolume10Day")),
                "week_52_high": _sf(info.get("fiftyTwoWeekHigh")) or _fi("year_high"),
                "week_52_low": _sf(info.get("fiftyTwoWeekLow")) or _fi("year_low"),
                "day_high": _sf(info.get("dayHigh")) or _fi("day_high"),
                "day_low": _sf(info.get("dayLow")) or _fi("day_low"),
                "fifty_day_avg": _sf(info.get("fiftyDayAverage")) or _fi("fifty_day_average"),
                "two_hundred_day_avg": _sf(info.get("twoHundredDayAverage")) or _fi("two_hundred_day_average"),
                "pe_ratio": _sf(info.get("trailingPE")),
                "forward_pe": _sf(info.get("forwardPE")),
                "pb_ratio": _sf(info.get("priceToBook")),
                "ps_ratio": _sf(info.get("priceToSalesTrailing12Months")),
                "peg_ratio": _sf(info.get("pegRatio")),
                "ev_ebitda": _sf(info.get("enterpriseToEbitda")),
                "eps_ttm": _sf(info.get("trailingEps")),
                "eps_forward": _sf(info.get("forwardEps")),
                "revenue_ttm": _sf(info.get("totalRevenue")),
                "gross_margin": _sf(info.get("grossMargins")),
                "profit_margin": _sf(info.get("profitMargins")),
                "operating_margin": _sf(info.get("operatingMargins")),
                "return_on_equity": _sf(info.get("returnOnEquity")),
                "return_on_assets": _sf(info.get("returnOnAssets")),
                "debt_to_equity": _sf(info.get("debtToEquity")),
                "free_cash_flow": _sf(info.get("freeCashflow")),
                "dividend_yield": _sf(info.get("dividendYield")),
                "dividend_rate": _sf(info.get("dividendRate")),
                "payout_ratio": _sf(info.get("payoutRatio")),
                "ex_dividend_date": info.get("exDividendDate"),
                "beta": _sf(info.get("beta")),
                "short_ratio": _sf(info.get("shortRatio")),
                "short_pct_float": _sf(info.get("shortPercentOfFloat")),
                "earnings_date": info.get("earningsTimestamp"),
                "error": None,
            }
        except Exception as exc:
            _note(exc)
            return {"symbol": sym, "error": str(exc)}

    # ── Raw access (catalyst module) ──────────────────────────────────────────
    def raw_ticker(self, symbol: str):
        """yfinance Ticker for modules that read Yahoo-specific fields (catalyst, unusual).

        Every attribute read and call goes through the rate-limit gate."""
        GATE.check()
        return _GuardedTicker(yf.Ticker(symbol))

    # ── Options ───────────────────────────────────────────────────────────────
    @_guarded
    def option_chain(self, symbol: str) -> OptionChain:
        """Expiries within MAX_CHAIN_DTE days (at most MAX_CHAIN_EXPIRIES), each chain cached 5 min."""
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            ticker = yf.Ticker(symbol.upper())
            fast = ticker.fast_info
            spot = float(getattr(fast, "last_price", None) or getattr(fast, "regularMarketPrice", None) or 0.0)
            if spot <= 0:
                hist = ticker.history(period="1d")
                if not hist.empty:
                    spot = float(hist["Close"].iloc[-1])

            expiries = ticker.options
            empty = OptionChain(spot, pd.DataFrame(columns=CHAIN_COLUMNS))
            if not expiries:
                return empty

            # Options expire in US/Eastern; a UTC "today" would roll over at
            # 7pm ET and drop the 0-DTE expiry.
            import zoneinfo
            today = pd.Timestamp(datetime.now(zoneinfo.ZoneInfo("America/New_York")).date())
            valid: list[tuple[str, float]] = []
            for exp in sorted(set(expiries)):          # nearest first, no duplicates
                days = (pd.to_datetime(exp) - today).days
                if 0 <= days <= MAX_CHAIN_DTE:
                    # 0-DTE uses 1 trading day / 252 (standard for intraday gamma)
                    valid.append((exp, max(days, 1) / 252.0))
            valid = valid[:MAX_CHAIN_EXPIRIES]
            if not valid:
                return empty
            sym = symbol.upper()

            def _one(exp: str, T: float) -> List[Dict[str, Any]]:
                cached = _chain_cache.get((sym, exp))
                if cached is not None:
                    return cached
                try:
                    rows = parse_chain_rows(exp, ticker.option_chain(exp), T)
                except Exception as exc:
                    if _is_rate_limit(exc):
                        raise MarketDataRateLimited(0) from exc   # re-raised in the caller's thread
                    return []
                _chain_cache[(sym, exp)] = rows
                return rows

            rows: List[Dict[str, Any]] = []
            with ThreadPoolExecutor(max_workers=min(len(valid), 6)) as pool:
                for fut in as_completed([pool.submit(_one, e, T) for e, T in valid]):
                    rows.extend(fut.result())
        if not rows:
            return empty
        return OptionChain(spot, pd.DataFrame(rows, columns=CHAIN_COLUMNS))
