"""optionflow/modules/insight/service.py — daily bars in, swings and the LEAPS score out.

Live: the daily bars are cached (TTL), but every request puts the LIVE price in as today's close, so the score,
its entry price and the swings' current reading move with the stock. The live price is reused for LIVE_TTL
seconds while a real-time source (Public) serves it, SLOW_TTL otherwise (Yahoo is delayed and rate-limited).
A score costs ~2 ms on cached bars, so the page can ask every second.

Dealer levels and ATM IV for the score are taken from the flow module's cached GEX result when there is one
(the GEX poller keeps it fresh); the score never triggers a chain fetch of its own.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from optionflow.modules.insight import score as scoring
from optionflow.modules.insight import swings as sw
from optionflow.providers.market_data import bars_from_history, get_market_data

logger = logging.getLogger("optionflow.insight")

TTL = 900.0                 # daily bars: 15 minutes is plenty (today's close is the live price, below)
LIVE_TTL = 1.0              # live price from a real-time source: reuse for 1 s (the provider's own quote TTL)
SLOW_TTL = 30.0             # … from a delayed / rate-limited source
ET = ZoneInfo("America/New_York")
SCORE_PERIOD = "5y"
BENCHMARK = "SPY"

_cache: Dict[Tuple[str, str], Tuple[float, Any]] = {}
_lock = threading.Lock()


_live: Dict[str, Tuple[float, float, Optional[float], bool]] = {}   # sym -> (fetched, ttl, price, realtime)


def clear_cache() -> None:
    with _lock:
        _cache.clear()
        _live.clear()


def live_price(sym: str) -> Tuple[Optional[float], bool]:
    """(price, realtime). Real-time Public quote when there is one (cached LIVE_TTL), else the provider's
    last price (cached SLOW_TTL). (None, False) when nothing answers."""
    with _lock:
        hit = _live.get(sym)
    if hit and time.monotonic() - hit[0] < hit[1]:
        return hit[2], hit[3]
    price, realtime = None, False
    md = get_market_data()
    try:
        batch = getattr(md, "quotes_batch", None)
        q = (batch([sym]) or {}).get(sym) if batch else None
        if q and q.get("price"):
            price, realtime = float(q["price"]), True
        else:
            price = md.last_price(sym)
    except Exception as exc:
        logger.debug("insight: no live price for %s: %s", sym, exc)
    with _lock:
        _live[sym] = (time.monotonic(), LIVE_TTL if realtime else SLOW_TTL, price, realtime)
    return price, realtime


def with_live(bars: List[Dict[str, Any]], price: Optional[float], now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    """The bars with the live price as today's close: replaces the last close when the last bar is today (or
    there has been no session since, e.g. a weekend: an after-hours move still shows), else appends a bar for today."""
    if not bars or not price or price <= 0:
        return bars
    today = (now or datetime.now(timezone.utc)).astimezone(ET).date()
    last = bars[-1]
    if last["date"][:10] >= today.isoformat() or today.weekday() >= 5:
        return bars[:-1] + [{**last, "close": float(price)}]
    return bars + [{"date": today.isoformat(), "open": None, "high": None, "low": None,
                    "close": float(price), "volume": None}]


def _cached(kind: str, key: str, load: Callable[[], Any]) -> Any:
    with _lock:
        hit = _cache.get((kind, key))
    if hit and time.monotonic() - hit[0] < TTL:
        return hit[1]
    val = load()
    with _lock:
        _cache[(kind, key)] = (time.monotonic(), val)
    return val


def _bars(sym: str, period: str) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    def load():
        df = get_market_data().price_history(sym, period, "1d")
        if df is None or df.empty:
            return [], None
        return bars_from_history(df, intraday=False), df.attrs.get("source")
    return _cached("bars", f"{sym}|{period}", load)


def swings(symbol: str, period: str = "1y") -> Dict[str, Any]:
    sym = symbol.strip().upper()
    p = period if period in sw.PERIODS else "1y"
    try:
        bars, source = _bars(sym, p)
    except Exception as exc:
        return {"symbol": sym, "period": p, "lookback": sw.LOOKBACK[p], "points": [], "stats": None, "error": str(exc)}
    if not bars:
        return {"symbol": sym, "period": p, "lookback": sw.LOOKBACK[p], "points": [], "stats": None,
                "error": f"No price history for {sym}."}
    price, realtime = live_price(sym)
    bars = with_live(bars, price)
    out = sw.swings([b["date"] for b in bars], [b["close"] for b in bars], p)
    return {"symbol": sym, "period": p, **out, "source": source, "price": round(bars[-1]["close"], 4),
            "realtime": realtime, "error": None}


def _dealer_inputs(sym: str) -> Dict[str, Optional[float]]:
    """net GEX, flip and ATM IV from the flow board's cached result ({} when it has none or it errored)."""
    try:
        from optionflow.modules.flow import service as flow
        r = flow.cached_gex(sym)
    except Exception:
        return {}
    if r is None or r.error:
        return {}
    return {"net_gex": r.net_gex, "zero_gamma": r.zero_gamma, "atm_iv": (getattr(r, "outlook", None) or {}).get("atm_iv")}


def leaps_score(symbol: str) -> Dict[str, Any]:
    sym = symbol.strip().upper()
    try:
        bars, _ = _bars(sym, SCORE_PERIOD)
    except Exception as exc:
        return {"symbol": sym, "score": None, "band": None, "error": str(exc)}
    if not bars:
        return {"symbol": sym, "score": None, "band": None, "error": f"No price history for {sym}."}
    price, realtime = live_price(sym)
    bars = with_live(bars, price)
    spy: List[float] = []
    if sym != BENCHMARK:
        try:
            spy = [b["close"] for b in with_live(_bars(BENCHMARK, SCORE_PERIOD)[0], live_price(BENCHMARK)[0])]
        except Exception as exc:                       # the score works without the benchmark
            logger.info("insight: no %s bars for relative strength: %s", BENCHMARK, exc)
    d = _dealer_inputs(sym)
    out = scoring.leaps_score([b["close"] for b in bars], [b.get("volume") for b in bars], spy_closes=spy,
                              atm_iv=d.get("atm_iv"), net_gex=d.get("net_gex"), zero_gamma=d.get("zero_gamma"))
    return {"symbol": sym, **out, "price": round(bars[-1]["close"], 4), "realtime": realtime,
            "as_of": datetime.now(timezone.utc).isoformat(timespec="seconds")}
