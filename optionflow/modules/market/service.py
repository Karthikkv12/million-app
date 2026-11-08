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


def _live(md: Any, syms: List[str]) -> Dict[str, Dict[str, Any]]:
    """Real-time quotes in one request when the provider has them (Public.com), else {}."""
    fn = getattr(md, "quotes_batch", None)
    if not callable(fn):
        return {}
    try:
        return fn(syms) or {}
    except Exception:
        return {}


def quotes(symbols: str) -> List[Dict[str, Any]]:
    md = get_market_data()
    syms = _symbols(symbols, 25)
    live = _live(md, syms)
    out = []
    for s in syms:
        q = live.get(s)
        out.append({k: q[k] for k in ("price", "prev_close", "change", "change_pct")} | {"symbol": s}
                   if q is not None else md.quote(s))
    return out


_PRICE_FIELDS = ("price", "prev_close", "change", "change_pct")


def _overlay(row: Dict[str, Any], q: Dict[str, Any]) -> Dict[str, Any]:
    """Cached fundamentals + live price fields (and volume / relative volume when Public has them)."""
    row = dict(row) | {k: q[k] for k in _PRICE_FIELDS} | {"error": None}   # a live price beats a Yahoo error
    if q.get("volume"):
        row["volume"] = q["volume"]
        if row.get("avg_volume"):
            row["rel_volume"] = round(q["volume"] / row["avg_volume"], 2)
    return row


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
        rows = list(pool.map(_one, syms))
    live = _live(get_market_data(), syms)        # fundamentals cache for 5 min; prices stay live
    return [_overlay(r, live[s]) if s in live else r for s, r in zip(syms, rows)]


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
    live = _live(get_market_data(), [sym]).get(sym)
    if live is not None:                          # real-time: skip the 60 s price cache
        return {"symbol": sym, "price": round(live["price"], 4), "from_cache": False}
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
