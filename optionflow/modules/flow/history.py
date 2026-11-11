"""optionflow/modules/flow/history.py — GEX snapshots for replay (moved from logic/gex_history.py).

The GEX poller calls `record(result)` after each computation. At most one
snapshot per symbol every SNAPSHOT_EVERY seconds is stored: spot, net GEX,
flip, call/put walls, king node and the net-GEX profile for the strikes nearest
spot. `day(symbol, date)` returns one ET trading day's regular-session snapshots in order. Table: gex_snapshots (one
database, ORM).
"""
from __future__ import annotations

import json
import logging
import threading
import time
from datetime import date, datetime, time as dtime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy import func

from database.models import GexSnapshot
from optionflow.core.db import get_session

logger = logging.getLogger("optionflow.gex_history")

SNAPSHOT_EVERY = 300          # seconds between stored snapshots per symbol
PROFILE_STRIKES = 30          # strikes kept around spot
ET = ZoneInfo("America/New_York")
SESSION_OPEN, SESSION_CLOSE = dtime(9, 30), dtime(16, 0)
DAYS_LOOKBACK = 21            # days scanned for the day picker (10 shown)

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


def _et_date(ts: str) -> date:
    """ET calendar date of a stored UTC timestamp ('YYYY-MM-DDTHH:MM:SSZ')."""
    return datetime.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).astimezone(ET).date()


def _in_session(ts: str) -> bool:
    """True for a weekday 9:30–16:00 ET timestamp (regular session; holidays are not special-cased)."""
    t = datetime.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).astimezone(ET)
    return t.weekday() < 5 and SESSION_OPEN <= t.time() <= SESSION_CLOSE


def _utc_bounds(on: date) -> Tuple[str, str]:
    """[start, end) of an ET calendar day as stored-format UTC strings (DST-aware)."""
    fmt = "%Y-%m-%dT%H:%M:%SZ"
    lo = datetime.combine(on, dtime(0), ET).astimezone(timezone.utc)
    hi = datetime.combine(on + timedelta(days=1), dtime(0), ET).astimezone(timezone.utc)
    return lo.strftime(fmt), hi.strftime(fmt)


def day(symbol: str, on: Optional[date] = None) -> Dict[str, Any]:
    """Snapshots for one ET trading day, regular session (9:30–16:00 ET) only.

    Days are ET calendar dates, so a board left open after 7 pm ET (00:00 UTC) no longer starts a new day of
    after-hours snapshots (C-91). Default: the latest day with regular-session snapshots, else the latest day
    with any. A day with no regular-session snapshots (weekend, after-hours only) shows all of its snapshots."""
    sym = symbol.strip().upper()
    session = get_session()
    try:
        since = (datetime.now(timezone.utc) - timedelta(days=DAYS_LOOKBACK)).strftime("%Y-%m-%dT%H:%M:%SZ")
        stamps = [ts for (ts,) in session.query(GexSnapshot.ts).filter(GexSnapshot.symbol == sym, GexSnapshot.ts >= since)]
        if on is None and not stamps:     # nothing recent: fall back to the latest snapshot at all
            latest = session.query(func.max(GexSnapshot.ts)).filter(GexSnapshot.symbol == sym).scalar()
            stamps = [latest] if latest else []
        all_days = sorted({_et_date(ts) for ts in stamps}, reverse=True)
        session_days = sorted({_et_date(ts) for ts in stamps if _in_session(ts)}, reverse=True)
        if on is None:
            if not all_days:
                return {"symbol": sym, "date": None, "snapshots": [], "days": []}
            on = session_days[0] if session_days else all_days[0]
        lo, hi = _utc_bounds(on)
        rows = (session.query(GexSnapshot).filter(GexSnapshot.symbol == sym, GexSnapshot.ts >= lo, GexSnapshot.ts < hi)
                .order_by(GexSnapshot.ts).all())
        regular = [r for r in rows if _in_session(r.ts)]
        rows = regular or rows
        snaps = [{"ts": r.ts, "spot": r.spot, "net_gex": r.net_gex, "zero_gamma": r.zero_gamma,
                  "call_wall": r.call_wall, "put_wall": r.put_wall, "king": r.king,
                  "profile": json.loads(r.profile or "[]")} for r in rows]
    finally:
        session.close()
    return {"symbol": sym, "date": on.isoformat(), "snapshots": snaps,
            "days": [d.isoformat() for d in all_days[:10]]}
