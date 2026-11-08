"""optionflow/modules/flow/replay.py — GEX snapshots through the session, for replay.

`record(result)` runs after every GEX refresh (see service.refresh_gex) and stores
at most one snapshot per symbol every SNAPSHOT_EVERY seconds: spot, net GEX, flip,
walls, king node and the net-GEX profile for the strikes nearest spot.
`day(symbol, on)` returns a session's snapshots in order.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func

from database.models import GexSnapshot
from optionflow.core.db import get_session

logger = logging.getLogger("optionflow.flow.replay")

SNAPSHOT_EVERY = 300   # seconds between stored snapshots per symbol
PROFILE_STRIKES = 30   # strikes kept around spot

_last: Dict[str, float] = {}
_lock = threading.Lock()


def profile_near_spot(strikes: List[float], net: List[float], spot: float, n: int = PROFILE_STRIKES) -> List[List[float]]:
    """[[strike, net_gex], ...] for the n strikes closest to spot, ascending."""
    pairs = sorted(zip(strikes, net), key=lambda p: abs(p[0] - spot))[:n]
    return [[float(k), round(float(v), 0)] for k, v in sorted(pairs)]


def should_record(symbol: str, now: Optional[float] = None) -> bool:
    now = now if now is not None else time.monotonic()
    with _lock:
        last = _last.get(symbol)
        if last is not None and now - last < SNAPSHOT_EVERY:
            return False
        _last[symbol] = now
        return True


def record(result: Any) -> None:
    """Store a snapshot from a GEXResult (throttled). Never raises."""
    try:
        sym = result.symbol
        if not result.spot or not should_record(sym):
            return
        prof = profile_near_spot(list(result.strikes or []), list(result.gex_by_strike or []), float(result.spot))
        session = get_session()
        try:
            session.add(GexSnapshot(
                symbol=sym, ts=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), spot=float(result.spot),
                net_gex=result.net_gex, zero_gamma=result.zero_gamma, call_wall=result.max_call_wall,
                put_wall=result.max_put_wall, king=result.max_gex_strike, profile=json.dumps(prof)))
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()
    except Exception as exc:
        logger.warning("gex snapshot failed for %s: %s", getattr(result, "symbol", "?"), exc)


def day(symbol: str, on: Optional[date] = None) -> Dict[str, Any]:
    """Snapshots for one UTC day (default: the latest day with data) and the days available."""
    sym = symbol.strip().upper()
    session = get_session()
    try:
        days = [r[0] for r in session.query(func.substr(GexSnapshot.ts, 1, 10)).filter(GexSnapshot.symbol == sym)
                .distinct().order_by(func.substr(GexSnapshot.ts, 1, 10).desc()).limit(10).all()]
        if on is None:
            if not days:
                return {"symbol": sym, "date": None, "snapshots": [], "days": []}
            on = date.fromisoformat(days[0])
        rows = (session.query(GexSnapshot).filter(GexSnapshot.symbol == sym, GexSnapshot.ts.like(f"{on.isoformat()}%"))
                .order_by(GexSnapshot.ts).all())
        snaps = [{"ts": r.ts, "spot": r.spot, "net_gex": r.net_gex, "zero_gamma": r.zero_gamma, "call_wall": r.call_wall,
                  "put_wall": r.put_wall, "king": r.king, "profile": json.loads(r.profile or "[]")} for r in rows]
    finally:
        session.close()
    return {"symbol": sym, "date": on.isoformat(), "snapshots": snaps, "days": days}
