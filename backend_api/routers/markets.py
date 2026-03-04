"""backend_api/routers/markets.py — Market data, GEX, options flow & stock info routes."""
from __future__ import annotations

import asyncio
import time
from collections import defaultdict
from datetime import datetime, timedelta as _td
from datetime import timezone as _tz
from functools import partial
from typing import Any, Dict, List, Optional

import pandas as pd
import yfinance as yf
from cachetools import TTLCache
from fastapi import APIRouter, Depends, HTTPException, Query

from ..deps import get_current_user
from ..state import (
    _RANGE_INTERVAL,
    backfill_history,
    _flow_db,
    _gex_cache,
    _GEX_CACHE_TTL,
    _record_flow_snapshot,
    _watched,
    _watched_lock,
    _watched_ttl,
)

router = APIRouter(tags=["markets"])

# ── Bounded TTL caches ─────────────────────────────────────────────────────────────
# maxsize caps memory; ttl in seconds controls freshness
_search_cache: TTLCache = TTLCache(maxsize=256, ttl=60)
_STOCK_INFO_CACHE: TTLCache = TTLCache(maxsize=512, ttl=300)
_QUOTE_CACHE: TTLCache = TTLCache(maxsize=512, ttl=60)


# ── Ticker search (no auth required) ─────────────────────────────────────────

@router.get("/search/tickers")
async def search_tickers(q: str = "", limit: int = 8) -> List[Dict[str, Any]]:
    """Fuzzy ticker + company name search backed by yfinance. No auth required."""
    q = q.strip()
    if not q:
        return []
    key = q.lower()
    cached = _search_cache.get(key)
    if cached is not None:
        return cached[:limit]

    def _fetch() -> List[Dict[str, Any]]:
        try:
            res = yf.Search(q, max_results=min(limit, 20), enable_fuzzy_query=True)
            quotes = res.quotes or []
            results = []
            seen: set[str] = set()

            def _sort_key(r: dict) -> int:
                ex = r.get("exchDisp", "") or ""
                if ex in {"NASDAQ", "NYSE", "NYSE ARCA", "NYSE MKT"}:
                    return 0
                if ex in {"NSE", "BSE", "Bombay"}:
                    return 1
                return 2

            for q_item in sorted(quotes, key=_sort_key):
                sym = (q_item.get("symbol") or "").strip()
                if not sym or sym in seen:
                    continue
                seen.add(sym)
                results.append({
                    "symbol":   sym,
                    "name":     (q_item.get("shortname") or q_item.get("longname") or "").strip(),
                    "type":     (q_item.get("typeDisp") or q_item.get("quoteType") or "").strip(),
                    "exchange": (q_item.get("exchDisp") or q_item.get("exchange") or "").strip(),
                })
            return results
        except Exception:
            return []

    loop = asyncio.get_event_loop()
    results = await loop.run_in_executor(None, _fetch)
    _search_cache[key] = results
    return results[:limit]


# ── Options watch / net-flow ──────────────────────────────────────────────────

@router.post("/options/watch", status_code=204)
def watch_symbols(body: Dict[str, Any], _user=Depends(get_current_user)) -> None:
    """Register symbols being watched by frontend (heartbeat to keep GEX poller alive)."""
    import threading
    symbols: list[str] = [s.strip().upper() for s in body.get("symbols", []) if s]
    now = time.monotonic()
    new_symbols: list[str] = []
    with _watched_lock:
        for s in symbols:
            if s not in _watched:
                new_symbols.append(s)
            _watched.add(s)
            _watched_ttl[s] = now
    for s in new_symbols:
        for d in _RANGE_INTERVAL:
            threading.Thread(
                target=backfill_history, args=(s, d), daemon=True,
                name=f"backfill-{s}-{d}d"
            ).start()


@router.get("/options/net-flow-history/{symbol}", response_model=List[Dict[str, Any]])
def net_flow_history(
    symbol: str,
    days: int = 1,
    bucket: int = 0,
    _user=Depends(get_current_user),
) -> List[Dict[str, Any]]:
    days = max(1, min(days, 30))
    sym = symbol.upper()
    cutoff_dt = datetime.now(_tz.utc) - _td(days=days)
    since_z   = cutoff_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    since_off = cutoff_dt.strftime("%Y-%m-%dT%H:%M:%S+00:00")
    with _flow_db() as con:
        rows = con.execute(
            "SELECT ts,price,call_prem,put_prem,net_flow,total_prem,volume "
            "FROM net_flow_snapshots WHERE symbol=? AND (ts>=? OR ts>=?) ORDER BY ts",
            (sym, since_z, since_off),
        ).fetchall()
    if not rows:
        return []
    if bucket and bucket > 0:
        bucket_secs = bucket * 60
        buckets: dict = defaultdict(list)
        for ts, price, cp, pp, nf, tp, vol in rows:
            try:
                dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                epoch = int(dt.timestamp())
                key = (epoch // bucket_secs) * bucket_secs
                buckets[key].append((ts, price, cp, pp, nf, tp, vol))
            except Exception:
                continue
        result = []
        for key in sorted(buckets):
            group = buckets[key]
            last = group[-1]
            bucket_ts = datetime.fromtimestamp(key, tz=_tz.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            result.append({
                "ts": bucket_ts, "price": last[1],
                "call_prem": last[2], "put_prem": last[3],
                "net_flow": last[4], "total_prem": last[5],
                "volume": sum(r[6] for r in group),
            })
        return result
    return [
        {"ts": ts, "price": price, "call_prem": cp, "put_prem": pp,
         "net_flow": nf, "total_prem": tp, "volume": vol}
        for ts, price, cp, pp, nf, tp, vol in rows
    ]


@router.get("/market/quotes")  # intentionally unauthenticated — used by Next.js server-side renders
async def market_quotes(symbols: str) -> List[Dict[str, Any]]:
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not syms or len(syms) > 25:
        raise HTTPException(status_code=400, detail="Provide 1–25 comma-separated symbols")

    def _fetch_quotes() -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        for sym in syms:
            try:
                t = yf.Ticker(sym)
                info = t.fast_info
                price      = float(info.last_price)     if info.last_price     is not None else None
                prev       = float(info.previous_close) if info.previous_close is not None else None
                change     = round(price - prev, 4)     if price is not None and prev is not None else None
                change_pct = round((change / prev) * 100, 4) if change is not None and prev else None
                results.append({"symbol": sym, "price": price, "prev_close": prev,
                                "change": change, "change_pct": change_pct})
            except Exception:
                results.append({"symbol": sym, "price": None, "prev_close": None,
                               "change": None, "change_pct": None})
        return results

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _fetch_quotes)


# ── GEX ───────────────────────────────────────────────────────────────────────

@router.get("/options/gamma-exposure/{symbol}", response_model=Dict[str, Any])
async def gamma_exposure(symbol: str, _user=Depends(get_current_user)) -> Dict[str, Any]:
    from logic.gamma import compute_gamma_exposure

    sym = symbol.upper()
    now = time.monotonic()
    cached = _gex_cache.get(sym)
    if cached and (now - cached[0]) < _GEX_CACHE_TTL:
        result = cached[1]
        fresh = False
    else:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, partial(compute_gamma_exposure, sym))
        _gex_cache[sym] = (time.monotonic(), result)
        fresh = True

    if fresh:
        _record_flow_snapshot(
            symbol=result.symbol, spot=result.spot,
            call_prem=result.call_premium, put_prem=result.put_premium,
            net_flow=result.net_flow,
            total_prem=result.call_premium + result.put_premium,
            volume=result.total_volume,
        )
    return {
        "symbol": result.symbol, "spot": result.spot,
        "expiries": result.expiries, "strikes": result.strikes,
        "gex_by_strike": result.gex_by_strike,
        "call_gex_by_strike": result.call_gex_by_strike,
        "put_gex_by_strike": result.put_gex_by_strike,
        "heatmap_expiries": result.heatmap_expiries,
        "heatmap_strikes": result.heatmap_strikes,
        "heatmap_values": result.heatmap_values,
        "zero_gamma": result.zero_gamma,
        "max_call_wall": result.max_call_wall,
        "max_put_wall": result.max_put_wall,
        "max_gex_strike": result.max_gex_strike,
        "net_gex": result.net_gex,
        "call_premium": result.call_premium,
        "put_premium": result.put_premium,
        "net_flow": result.net_flow,
        "total_volume": result.total_volume,
        "flow_by_expiry": result.flow_by_expiry,
        "top_flow_strikes": result.top_flow_strikes,
        "data_source": getattr(result, "data_source", "yfinance"),
        "error": result.error,
    }


# ── Stock info & quotes ───────────────────────────────────────────────────────

@router.get("/stocks/{symbol}/info", response_model=Dict[str, Any])
async def stock_info(symbol: str, _user=Depends(get_current_user)) -> Dict[str, Any]:
    sym = symbol.strip().upper()
    cached = _STOCK_INFO_CACHE.get(sym)
    if cached is not None:
        return cached

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

    def _fetch_info() -> Dict[str, Any]:
        try:
            ticker = yf.Ticker(sym)
            info = {}
            try:
                info = ticker.info or {}
            except Exception:
                pass
            fast = None
            try:
                fast = ticker.fast_info
            except Exception:
                pass

            def _fi(attr: str) -> Optional[float]:
                try:
                    v = getattr(fast, attr, None)
                    return float(v) if v is not None else None
                except Exception:
                    return None

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
            return {"symbol": sym, "error": str(exc)}

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, _fetch_info)
    if result.get("error") is None:
        _STOCK_INFO_CACHE[sym] = result
    return result


@router.get("/quote/{symbol}", response_model=Dict[str, Any])
async def get_live_quote(symbol: str, _user=Depends(get_current_user)) -> Dict[str, Any]:
    sym = symbol.strip().upper()
    cached = _QUOTE_CACHE.get(sym)
    if cached is not None:
        return {"symbol": sym, "price": cached, "from_cache": True}

    def _fetch() -> Dict[str, Any]:
        try:
            ticker = yf.Ticker(sym)
            fi = ticker.fast_info
            price = float(
                getattr(fi, "last_price", None) or getattr(fi, "regularMarketPrice", None) or 0.0
            )
            if price <= 0:
                hist = ticker.history(period="1d", progress=False)
                if not hist.empty:
                    price = float(hist["Close"].iloc[-1])
            if price <= 0:
                return {"symbol": sym, "price": None, "error": "Price unavailable"}
            return {"symbol": sym, "price": round(price, 4), "from_cache": False}
        except Exception as exc:
            return {"symbol": sym, "price": None, "error": str(exc)}

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, _fetch)
    if result.get("price") is not None:
        _QUOTE_CACHE[sym] = result["price"]
    return result


@router.get("/stocks/{symbol}/history", response_model=Dict[str, Any])
async def stock_history(
    symbol: str,
    period: str = "6mo",
    interval: str = "1d",
    _user=Depends(get_current_user),
) -> Dict[str, Any]:
    sym = symbol.strip().upper()
    allowed_periods   = {"1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"}
    allowed_intervals = {"1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d", "5d", "1wk", "1mo", "3mo"}
    p  = period   if period   in allowed_periods   else "6mo"
    iv = interval if interval in allowed_intervals else "1d"
    intraday = iv not in {"1d", "5d", "1wk", "1mo", "3mo"}

    def _fetch() -> Dict[str, Any]:
        try:
            ticker = yf.Ticker(sym)
            hist = ticker.history(period=p, interval=iv)
            if hist is None or hist.empty:
                return {"symbol": sym, "bars": [], "current_price": None, "error": f"No data for {sym}"}
            hist = hist.reset_index()
            bars: List[Dict[str, Any]] = []
            for _, row in hist.iterrows():
                dt = row.get("Datetime") or row.get("Date")
                close = row.get("Close")
                if dt is None or close is None:
                    continue
                try:
                    ts = pd.to_datetime(dt)
                    ts = ts.tz_localize("UTC") if ts.tzinfo is None else ts.tz_convert("UTC")
                    date_str = ts.strftime("%Y-%m-%dT%H:%M:%SZ") if intraday else ts.strftime("%Y-%m-%d")
                    close_f  = float(close)
                except Exception:
                    continue
                bars.append({
                    "date":   date_str,
                    "open":   float(row["Open"])   if "Open"   in row and pd.notna(row["Open"])   else None,
                    "high":   float(row["High"])   if "High"   in row and pd.notna(row["High"])   else None,
                    "low":    float(row["Low"])    if "Low"    in row and pd.notna(row["Low"])    else None,
                    "close":  close_f,
                    "volume": int(row["Volume"])   if "Volume" in row and pd.notna(row["Volume"]) else None,
                })
            return {"symbol": sym, "bars": bars, "current_price": bars[-1]["close"] if bars else None, "error": None}
        except Exception as exc:
            return {"symbol": sym, "bars": [], "current_price": None, "error": str(exc)}

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _fetch)
