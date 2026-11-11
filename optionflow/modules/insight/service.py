"""optionflow/modules/insight/service.py — daily bars in, swings and the LEAPS score out (cached).

Bars come from the market-data provider. Dealer levels and ATM IV for the score are taken from the flow
module's cached GEX result when there is one; the score never triggers a chain fetch of its own.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from optionflow.modules.insight import score as scoring
from optionflow.modules.insight import swings as sw
from optionflow.providers.market_data import bars_from_history, get_market_data

logger = logging.getLogger("optionflow.insight")

TTL = 900.0                 # daily bars: 15 minutes is plenty
SCORE_PERIOD = "5y"
BENCHMARK = "SPY"

_cache: Dict[Tuple[str, str], Tuple[float, Any]] = {}
_lock = threading.Lock()


def clear_cache() -> None:
    with _lock:
        _cache.clear()


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
    out = sw.swings([b["date"] for b in bars], [b["close"] for b in bars], p)
    return {"symbol": sym, "period": p, **out, "source": source, "error": None}


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
    spy: List[float] = []
    if sym != BENCHMARK:
        try:
            spy = [b["close"] for b in _bars(BENCHMARK, SCORE_PERIOD)[0]]
        except Exception as exc:                       # the score works without the benchmark
            logger.info("insight: no %s bars for relative strength: %s", BENCHMARK, exc)
    d = _dealer_inputs(sym)
    out = scoring.leaps_score([b["close"] for b in bars], [b.get("volume") for b in bars], spy_closes=spy,
                              atm_iv=d.get("atm_iv"), net_gex=d.get("net_gex"), zero_gamma=d.get("zero_gamma"))
    return {"symbol": sym, **out, "as_of": datetime.now(timezone.utc).isoformat(timespec="seconds")}
