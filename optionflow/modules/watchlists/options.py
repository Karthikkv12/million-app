"""optionflow/modules/watchlists/options.py — option columns for watchlist rows.

Per symbol: ATM IV of the weekly expiry, its change since the first reading today, HV20, IV/HV,
the expected move to that expiry and the ATM call/put delta. It reuses the hedge desk's chain,
HV and spot caches (60 s / 6 h / seconds), so a symbol the desk already watches costs nothing
and the same numbers show on both pages. Read-only use of hedge.service (coordination C-72).
"""
from __future__ import annotations

import logging
import math
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional

from optionflow.modules.hedge import bs
from optionflow.modules.hedge import service as desk
from optionflow.modules.hedge.ivtrack import TRACKER

logger = logging.getLogger(__name__)

MAX_SYMBOLS = 40          # per request; the page asks in batches
_WORKERS = 6


def _r(x: Optional[float], d: int = 4) -> Optional[float]:
    return None if x is None or x != x else round(float(x), d)


def metrics(sym: str) -> Dict[str, Any]:
    out: Dict[str, Any] = {"symbol": sym}
    try:
        chain = desk._chain(sym) or {}
        spot = desk._spot(sym)
        out["spot"] = _r(spot, 4)
        iv, expiry, rows = chain.get("atm_iv"), chain.get("weekly"), chain.get("rows") or {}
        if not chain:
            out["error"] = "No option chain"
        dte = next((d for (e, _k, _t), (_iv, _m, d) in rows.items() if e == expiry), None) if expiry else None
        hv20 = (desk._hv(sym) or {}).get("hv20")
        state = TRACKER.state(sym, None)
        out.update({"atm_iv": _r(iv), "iv_change_day": _r(state.iv_roc_day), "hv20": _r(hv20),
                    "iv_hv": _r(iv / hv20, 3) if iv and hv20 else None, "expiry": expiry, "dte": _r(dte, 2)})
        if iv and spot and dte is not None:
            T = bs.year_fraction(max(dte, 0.5))           # same-day expiry: half a day, not zero
            move = spot * iv * math.sqrt(T)
            strikes = sorted({k for (e, k, _t) in rows if e == expiry})
            k = min(strikes, key=lambda s: abs(s - spot)) if strikes else spot
            out.update({"expected_move": _r(move, 2), "expected_move_pct": _r(move / spot),
                        "atm_call_delta": _r(bs.delta(spot, k, T, iv, "call"), 3),
                        "atm_put_delta": _r(bs.delta(spot, k, T, iv, "put"), 3)})
    except Exception as exc:                               # one bad symbol never fails the batch
        logger.info("watchlist option metrics %s failed: %s", sym, exc)
        out["error"] = "Unavailable"
    return out


def batch(symbols: List[str]) -> List[Dict[str, Any]]:
    syms = list(dict.fromkeys(s for s in symbols if s))[:MAX_SYMBOLS]
    if not syms:
        return []
    with ThreadPoolExecutor(max_workers=min(_WORKERS, len(syms))) as pool:
        return list(pool.map(metrics, syms))
