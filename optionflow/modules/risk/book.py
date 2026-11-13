"""optionflow/modules/risk/book.py — the inputs every risk view shares, read from other modules (no writes).

- holdings: the hedge desk's books → one row per underlying with its delta-dollar exposure
  (net Δ in lots × 100 × spot), so shares and options count alike.
- closes:   the insight module's cached 5-year daily bars, today's close = the live price.
- capital:  the synced account value (sum of accounts), None when nothing has synced.

hedge.books_for prices every option leg from live chains (~17 s cold on a real book, T-68), so the holdings are
cached per user for HOLDINGS_TTL: switching between the Vol target and Factors tabs computes them once.
"""
from __future__ import annotations

import logging
import math
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("optionflow.risk")

HOLDINGS_TTL = 60.0
_held: Dict[int, Tuple[float, List[Dict[str, Any]]]] = {}
_locks: Dict[int, threading.Lock] = {}
_guard = threading.Lock()


def clear_cache() -> None:
    with _guard:
        _held.clear()


def holdings(user_id: int) -> List[Dict[str, Any]]:
    """Copies of the cached rows (callers add fields to them). One computation at a time per user: a second
    request that arrives while the first is pricing the book waits for it instead of starting its own."""
    with _guard:
        lock = _locks.setdefault(user_id, threading.Lock())
    with lock:
        hit = _held.get(user_id)
        if hit and time.monotonic() - hit[0] < HOLDINGS_TTL:
            return [dict(r) for r in hit[1]]
        rows = _load_holdings(user_id)
        _held[user_id] = (time.monotonic(), rows)
        return [dict(r) for r in rows]


def _load_holdings(user_id: int) -> List[Dict[str, Any]]:
    from optionflow.modules.hedge import service as hedge
    rows = []
    for b in hedge.books_for(user_id)["books"]:
        if b.get("error") or not b.get("spot"):
            continue
        spot = float(b["spot"])
        rows.append({
            "symbol": b["symbol"], "spot": spot, "net_delta": b.get("net_delta"),
            "exposure": float(b.get("net_delta") or 0.0) * 100.0 * spot,
            "shares": b.get("shares") or 0.0,
            "has_options": any(leg.get("kind") == "option" for leg in b.get("legs") or []),
        })
    return rows


def closes(sym: str) -> Dict[str, float]:
    """{date: close}; {} when there is no history."""
    from optionflow.modules.insight import service as insight
    bars, _ = insight._bars(sym, insight.SCORE_PERIOD)
    bars = insight.with_live(bars, insight.live_price(sym)[0])
    return {b["date"][:10]: float(b["close"]) for b in bars if b.get("close")}


def safe_closes(sym: str) -> Tuple[Dict[str, float], Optional[str]]:
    try:
        return closes(sym), None
    except Exception as exc:                      # one symbol's provider error must not sink the view
        logger.info("risk: no closes for %s: %s", sym, exc)
        return {}, str(exc)


def capital(user_id: int) -> Optional[float]:
    try:
        from optionflow.modules.hedge import portfolio as pf
        return pf.portfolio(user_id, live=False).get("total_value")
    except Exception as exc:
        logger.info("risk: no account value for user %s: %s", user_id, exc)
        return None


def align(series: Dict[str, Dict[str, float]], days: int) -> Tuple[List[str], Dict[str, List[float]]]:
    """Daily log returns on the dates every series has, the last `days` of them. series: {name: {date: close}}."""
    if not series:
        return [], {}
    common = sorted(set.intersection(*(set(s) for s in series.values())))
    common = common[-(days + 1):]
    rets = {k: [math.log(s[b] / s[a]) for a, b in zip(common, common[1:])] for k, s in series.items()}
    return common[1:], rets
