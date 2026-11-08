"""logic/gex_history.py — GEX snapshots through the session, for replay.

The background poller calls `record(result)` after each gamma-exposure
computation. At most one snapshot per symbol every SNAPSHOT_EVERY seconds is
stored: spot, net GEX, flip, call/put walls, king node and the net-GEX profile
for the strikes nearest spot. `day(symbol, date)` returns them in order.

Stored in its own table in markets.db (DB_DIR aware), created on first use.
Self-contained so it can move into the flow module in the backend restructure.
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import time
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("optionflow.gex_history")

SNAPSHOT_EVERY = 300          # seconds between stored snapshots per symbol
PROFILE_STRIKES = 30          # strikes kept around spot

_last: Dict[str, float] = {}
_lock = threading.Lock()
_ready = False


def _db_path() -> Path:
    return Path(os.getenv("DB_DIR") or Path(__file__).resolve().parents[1]) / "markets.db"


def _connect() -> sqlite3.Connection:
    global _ready
    con = sqlite3.connect(str(_db_path()))
    if not _ready:
        con.execute("""
            CREATE TABLE IF NOT EXISTS gex_snapshots (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol     TEXT NOT NULL,
                ts         TEXT NOT NULL,
                spot       REAL NOT NULL,
                net_gex    REAL,
                zero_gamma REAL,
                call_wall  REAL,
                put_wall   REAL,
                king       REAL,
                profile    TEXT NOT NULL DEFAULT '[]'
            )""")
        con.execute("CREATE INDEX IF NOT EXISTS idx_gex_snap_sym_ts ON gex_snapshots (symbol, ts)")
        con.commit()
        _ready = True
    return con


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
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with _connect() as con:
            con.execute(
                "INSERT INTO gex_snapshots (symbol, ts, spot, net_gex, zero_gamma, call_wall, put_wall, king, profile) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (sym, ts, float(result.spot), result.net_gex, result.zero_gamma, result.max_call_wall,
                 result.max_put_wall, result.max_gex_strike, json.dumps(prof)),
            )
    except Exception as exc:
        logger.warning("gex snapshot failed for %s: %s", getattr(result, "symbol", "?"), exc)


def day(symbol: str, on: Optional[date] = None) -> Dict[str, Any]:
    """Snapshots for one UTC day (default: latest day with data)."""
    sym = symbol.strip().upper()
    with _connect() as con:
        if on is None:
            row = con.execute("SELECT substr(MAX(ts), 1, 10) FROM gex_snapshots WHERE symbol = ?", (sym,)).fetchone()
            if not row or not row[0]:
                return {"symbol": sym, "date": None, "snapshots": [], "days": []}
            on = date.fromisoformat(row[0])
        rows = con.execute(
            "SELECT ts, spot, net_gex, zero_gamma, call_wall, put_wall, king, profile FROM gex_snapshots "
            "WHERE symbol = ? AND substr(ts, 1, 10) = ? ORDER BY ts", (sym, on.isoformat())).fetchall()
        days = [r[0] for r in con.execute(
            "SELECT DISTINCT substr(ts, 1, 10) FROM gex_snapshots WHERE symbol = ? ORDER BY 1 DESC LIMIT 10", (sym,))]
    snaps = [{"ts": r[0], "spot": r[1], "net_gex": r[2], "zero_gamma": r[3], "call_wall": r[4],
              "put_wall": r[5], "king": r[6], "profile": json.loads(r[7] or "[]")} for r in rows]
    return {"symbol": sym, "date": on.isoformat(), "snapshots": snaps, "days": days}
