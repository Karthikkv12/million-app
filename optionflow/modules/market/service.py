"""optionflow/modules/market/service.py — quotes, search, company data and history, with caching."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List

from cachetools import TTLCache

from optionflow.core import errors
from optionflow.providers.market_data import bars_from_history, get_market_data

# Bounded TTL caches (maxsize caps memory; ttl in seconds)
_search_cache: TTLCache = TTLCache(maxsize=256, ttl=60)
_info_cache: TTLCache = TTLCache(maxsize=512, ttl=300)    # stock info and watchlist rows
_price_cache: TTLCache = TTLCache(maxsize=512, ttl=60)

PERIODS = {"1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"}
INTERVALS = {"1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d", "5d", "1wk", "1mo", "3mo"}
_DAILY_OR_LONGER = {"1d", "5d", "1wk", "1mo", "3mo"}


def clear_caches() -> None:
    for c in (_search_cache, _info_cache, _price_cache):
        c.clear()


def _symbols(raw: str, max_count: int) -> List[str]:
    syms = [s.strip().upper() for s in raw.split(",") if s.strip()]
    if not syms or len(syms) > max_count:
        raise errors.BadRequest(f"Provide 1–{max_count} comma-separated symbols")
    return syms


def search(query: str, limit: int = 8) -> List[Dict[str, Any]]:
    q = query.strip()
    if not q:
        return []
    key = q.lower()
    if key not in _search_cache:
        _search_cache[key] = get_market_data().search(q, limit)
    return _search_cache[key][:limit]


def quotes(symbols: str) -> List[Dict[str, Any]]:
    md = get_market_data()
    return [md.quote(s) for s in _symbols(symbols, 25)]


def watchlist_rows(symbols: str) -> List[Dict[str, Any]]:
    syms = _symbols(symbols, 150)

    def _one(sym: str) -> Dict[str, Any]:
        key = f"wl:{sym}"
        if key in _info_cache:
            return _info_cache[key]
        row = get_market_data().watchlist_row(sym)
        if row.get("error") is None:
            _info_cache[key] = row
        return row

    with ThreadPoolExecutor(max_workers=min(len(syms), 16)) as pool:
        return list(pool.map(_one, syms))


def stock_info(symbol: str) -> Dict[str, Any]:
    sym = symbol.strip().upper()
    if sym in _info_cache:
        return _info_cache[sym]
    info = get_market_data().stock_info(sym)
    if info.get("error") is None:
        _info_cache[sym] = info
    return info


def live_quote(symbol: str) -> Dict[str, Any]:
    sym = symbol.strip().upper()
    if sym in _price_cache:
        return {"symbol": sym, "price": _price_cache[sym], "from_cache": True}
    try:
        price = get_market_data().last_price(sym)
    except Exception as exc:
        return {"symbol": sym, "price": None, "error": str(exc)}
    if price is None:
        return {"symbol": sym, "price": None, "error": "Price unavailable"}
    _price_cache[sym] = round(price, 4)
    return {"symbol": sym, "price": round(price, 4), "from_cache": False}


def price_history(symbol: str, period: str = "6mo", interval: str = "1d") -> Dict[str, Any]:
    sym = symbol.strip().upper()
    p = period if period in PERIODS else "6mo"
    iv = interval if interval in INTERVALS else "1d"
    try:
        df = get_market_data().price_history(sym, p, iv)
    except Exception as exc:
        return {"symbol": sym, "bars": [], "current_price": None, "error": str(exc)}
    if df.empty:
        return {"symbol": sym, "bars": [], "current_price": None, "error": f"No data for {sym}"}
    bars = bars_from_history(df, intraday=iv not in _DAILY_OR_LONGER)
    return {"symbol": sym, "bars": bars, "current_price": bars[-1]["close"] if bars else None, "error": None}
