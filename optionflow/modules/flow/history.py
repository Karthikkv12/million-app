"""optionflow/modules/flow/history.py — GEX snapshots for replay (moved from logic/gex_history.py).

The GEX poller calls `record(result)` after each computation. At most one
snapshot per symbol every SNAPSHOT_EVERY seconds is stored: spot, net GEX,
flip, call/put walls, king node and the net-GEX profile for the strikes nearest
spot. `day(symbol, date)` returns them in order. Table: gex_snapshots (one
database, ORM).
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

logger = logging.getLogger("optionflow.gex_history")

SNAPSHOT_EVERY = 300          # seconds between stored snapshots per symbol
PROFILE_STRIKES = 30          # strikes kept around spot

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
        finally:
            session.close()
    except Exception as exc:
        logger.warning("gex snapshot failed for %s: %s", getattr(result, "symbol", "?"), exc)


def day(symbol: str, on: Optional[date] = None) -> Dict[str, Any]:
    """Snapshots for one UTC day (default: latest day with data)."""
    sym = symbol.strip().upper()
    day_of = func.substr(GexSnapshot.ts, 1, 10)
    session = get_session()
    try:
        if on is None:
            latest = session.query(func.max(GexSnapshot.ts)).filter(GexSnapshot.symbol == sym).scalar()
            if not latest:
                return {"symbol": sym, "date": None, "snapshots": [], "days": []}
            on = date.fromisoformat(latest[:10])
        rows = (session.query(GexSnapshot).filter(GexSnapshot.symbol == sym, day_of == on.isoformat())
                .order_by(GexSnapshot.ts).all())
        days = [d for (d,) in session.query(day_of).filter(GexSnapshot.symbol == sym).distinct()
                .order_by(day_of.desc()).limit(10).all()]
        snaps = [{"ts": r.ts, "spot": r.spot, "net_gex": r.net_gex, "zero_gamma": r.zero_gamma,
                  "call_wall": r.call_wall, "put_wall": r.put_wall, "king": r.king,
                  "profile": json.loads(r.profile or "[]")} for r in rows]
    finally:
        session.close()
    return {"symbol": sym, "date": on.isoformat(), "snapshots": snaps, "days": days}
