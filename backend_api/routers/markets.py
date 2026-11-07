"""backend_api/routers/markets.py — market data, GEX, options flow and stock info routes.

HTTP only: market data comes from optionflow.providers (get_market_data) and
GEX / flow history from optionflow.modules.flow.service. Plan step 4 moves
these routes into modules under /api/v1.
"""
from __future__ import annotations

import asyncio
from functools import partial
from typing import Any, Dict, List

from cachetools import TTLCache
from fastapi import APIRouter, Depends, HTTPException

from optionflow.core.deps import get_current_user
from optionflow.modules.flow import service as flow
from optionflow.providers.market_data import bars_from_history, get_market_data
from optionflow.workers.backfill import start_backfill

router = APIRouter(tags=["markets"])

# ── Bounded TTL caches (maxsize caps memory; ttl in seconds) ───────────────────
_search_cache: TTLCache = TTLCache(maxsize=256, ttl=60)
_STOCK_INFO_CACHE: TTLCache = TTLCache(maxsize=512, ttl=300)
_QUOTE_CACHE: TTLCache = TTLCache(maxsize=512, ttl=60)


async def _run(fn, *args):
    """Run a blocking provider call off the event loop."""
    return await asyncio.get_event_loop().run_in_executor(None, partial(fn, *args))


# ── Ticker search (no auth required) ─────────────────────────────────────────

@router.get("/search/tickers")
async def search_tickers(q: str = "", limit: int = 8) -> List[Dict[str, Any]]:
    """Fuzzy ticker + company name search. No auth required."""
    q = q.strip()
    if not q:
        return []
    key = q.lower()
    cached = _search_cache.get(key)
    if cached is not None:
        return cached[:limit]
    results = await _run(get_market_data().search, q, limit)
    _search_cache[key] = results
    return results[:limit]


# ── Options watch / net-flow ──────────────────────────────────────────────────

@router.post("/options/watch", status_code=204)
def watch_symbols(body: Dict[str, Any], _user=Depends(get_current_user)) -> None:
    """Heartbeat from open flow boards: keeps the GEX poller refreshing these symbols."""
    for sym in flow.watch(body.get("symbols", [])):
        start_backfill(sym)


@router.get("/options/net-flow-history/{symbol}", response_model=List[Dict[str, Any]])
def net_flow_history(
    symbol: str,
    days: int = 1,
    bucket: int = 0,
    _user=Depends(get_current_user),
) -> List[Dict[str, Any]]:
    return flow.net_flow_history(symbol, days=days, bucket_minutes=bucket)


@router.get("/market/watchlist-quotes", response_model=List[Dict[str, Any]])
async def watchlist_quotes(symbols: str, _user=Depends(get_current_user)) -> List[Dict[str, Any]]:
    """Per-symbol price, change, volume, valuation and range data for the watchlist (cached 5 min)."""
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not syms or len(syms) > 150:
        raise HTTPException(status_code=400, detail="Provide 1–150 comma-separated symbols")

    def _one(sym: str) -> Dict[str, Any]:
        key = f"wl:{sym}"
        cached = _STOCK_INFO_CACHE.get(key)
        if cached is not None:
            return cached
        row = get_market_data().watchlist_row(sym)
        if row.get("error") is None:
            _STOCK_INFO_CACHE[key] = row
        return row

    return list(await asyncio.gather(*(_run(_one, s) for s in syms)))


@router.get("/market/quotes")  # intentionally unauthenticated — used by Next.js server-side renders
async def market_quotes(symbols: str) -> List[Dict[str, Any]]:
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not syms or len(syms) > 25:
        raise HTTPException(status_code=400, detail="Provide 1–25 comma-separated symbols")
    md = get_market_data()
    return await _run(lambda: [md.quote(s) for s in syms])


# ── GEX ───────────────────────────────────────────────────────────────────────

@router.get("/options/gamma-exposure/{symbol}", response_model=Dict[str, Any])
async def gamma_exposure(symbol: str, _user=Depends(get_current_user)) -> Dict[str, Any]:
    result = await _run(flow.get_gex, symbol.upper())
    return flow.gex_payload(result)


# ── Stock info & quotes ───────────────────────────────────────────────────────

@router.get("/stocks/{symbol}/info", response_model=Dict[str, Any])
async def stock_info(symbol: str, _user=Depends(get_current_user)) -> Dict[str, Any]:
    sym = symbol.strip().upper()
    cached = _STOCK_INFO_CACHE.get(sym)
    if cached is not None:
        return cached
    result = await _run(get_market_data().stock_info, sym)
    if result.get("error") is None:
        _STOCK_INFO_CACHE[sym] = result
    return result


@router.get("/quote/{symbol}", response_model=Dict[str, Any])
async def get_live_quote(symbol: str, _user=Depends(get_current_user)) -> Dict[str, Any]:
    sym = symbol.strip().upper()
    cached = _QUOTE_CACHE.get(sym)
    if cached is not None:
        return {"symbol": sym, "price": cached, "from_cache": True}
    try:
        price = await _run(get_market_data().last_price, sym)
    except Exception as exc:
        return {"symbol": sym, "price": None, "error": str(exc)}
    if price is None:
        return {"symbol": sym, "price": None, "error": "Price unavailable"}
    _QUOTE_CACHE[sym] = round(price, 4)
    return {"symbol": sym, "price": round(price, 4), "from_cache": False}


_PERIODS = {"1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"}
_INTERVALS = {"1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d", "5d", "1wk", "1mo", "3mo"}


@router.get("/stocks/{symbol}/history", response_model=Dict[str, Any])
async def stock_history(
    symbol: str,
    period: str = "6mo",
    interval: str = "1d",
    _user=Depends(get_current_user),
) -> Dict[str, Any]:
    sym = symbol.strip().upper()
    p = period if period in _PERIODS else "6mo"
    iv = interval if interval in _INTERVALS else "1d"
    intraday = iv not in {"1d", "5d", "1wk", "1mo", "3mo"}
    try:
        df = await _run(get_market_data().price_history, sym, p, iv)
    except Exception as exc:
        return {"symbol": sym, "bars": [], "current_price": None, "error": str(exc)}
    if df.empty:
        return {"symbol": sym, "bars": [], "current_price": None, "error": f"No data for {sym}"}
    bars = bars_from_history(df, intraday)
    return {"symbol": sym, "bars": bars, "current_price": bars[-1]["close"] if bars else None, "error": None}
