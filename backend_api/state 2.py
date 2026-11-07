"""backend_api/state.py — Module-level shared state (caches, poller, flow DB helpers).

Centralised here so that routers can import without creating circular dependencies
back through main.py.
"""
from __future__ import annotations

import logging
import re
import sqlite3 as _sqlite3
import threading
import time
from datetime import datetime, timezone, timedelta as _td
from datetime import timezone as _tz
from pathlib import Path as _Path
from typing import Any, Set

logger = logging.getLogger("optionflow.state")

# ── GEX cache ─────────────────────────────────────────────────────────────────
_GEX_CACHE_TTL = 10
_gex_cache: dict[str, tuple[float, Any]] = {}

# ── Background poller state ───────────────────────────────────────────────────
_POLL_INTERVAL = 10
_watched: Set[str] = set()
_watched_lock = threading.Lock()
_watched_ttl: dict[str, float] = {}
_WATCH_TTL = 120

_RANGE_INTERVAL: dict[int, str] = {
    1: "1m", 2: "5m", 3: "5m", 7: "30m", 14: "30m", 30: "1d",
}
_backfilled: set[tuple[str, int]] = set()
_backfill_lock = threading.Lock()

# ── Flow snapshot DB ──────────────────────────────────────────────────────────
_FLOW_DB = _Path(__file__).parent.parent / "markets.db"
_flow_db_initialised = False
_flow_db_init_lock = threading.Lock()


def init_flow_db() -> None:
    """Run one-time schema migrations for the flow snapshot DB.

    Safe to call multiple times — subsequent calls are no-ops.
    """
    global _flow_db_initialised
    with _flow_db_init_lock:
        if _flow_db_initialised:
            return
        con = _sqlite3.connect(str(_FLOW_DB))
        try:
            con.execute("""
                CREATE TABLE IF NOT EXISTS net_flow_snapshots (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    symbol     TEXT    NOT NULL,
                    ts         TEXT    NOT NULL,
                    price      REAL    NOT NULL,
                    call_prem  REAL    NOT NULL,
                    put_prem   REAL    NOT NULL,
                    net_flow   REAL    NOT NULL,
                    total_prem REAL    NOT NULL DEFAULT 0,
                    volume     INTEGER NOT NULL DEFAULT 0
                )
            """)
            for col, typ in [
                ("total_prem", "REAL NOT NULL DEFAULT 0"),
                ("volume", "INTEGER NOT NULL DEFAULT 0"),
            ]:
                try:
                    con.execute(f"ALTER TABLE net_flow_snapshots ADD COLUMN {col} {typ}")
                except _sqlite3.OperationalError:
                    pass
            con.execute(
                "CREATE INDEX IF NOT EXISTS idx_nf_sym_ts ON net_flow_snapshots (symbol, ts)"
            )
            con.execute("""
                UPDATE net_flow_snapshots
                SET ts = REPLACE(REPLACE(ts, '+00:00', 'Z'), ' ', 'T')
                WHERE ts LIKE '%+00:00' OR ts LIKE '% %'
            """)
            con.commit()
        finally:
            con.close()
        _flow_db_initialised = True


def _flow_db() -> _sqlite3.Connection:
    """Return a raw sqlite3 connection to the flow snapshot DB."""
    return _sqlite3.connect(str(_FLOW_DB))


def _record_flow_snapshot(
    symbol: str,
    spot: float,
    call_prem: float,
    put_prem: float,
    net_flow: float,
    total_prem: float = 0.0,
    volume: int = 0,
) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        with _flow_db() as con:
            con.execute(
                "INSERT INTO net_flow_snapshots "
                "(symbol,ts,price,call_prem,put_prem,net_flow,total_prem,volume) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (
                    symbol, ts, round(spot, 2), round(call_prem, 0), round(put_prem, 0),
                    round(net_flow, 0), round(total_prem, 0), int(volume),
                ),
            )
    except Exception as exc:
        logger.error("_record_flow_snapshot failed for %s: %s", symbol, exc)


def backfill_history(sym: str, days: int) -> None:  # noqa: C901
    import yfinance as yf  # type: ignore[import-untyped]
    from pandas import DatetimeIndex

    key = (sym, days)
    with _backfill_lock:
        if key in _backfilled:
            return
        _backfilled.add(key)
    try:
        interval = _RANGE_INTERVAL.get(days, "5m")
        period_map = {1: "1d", 2: "2d", 3: "5d", 7: "5d", 14: "1mo", 30: "1mo"}
        period = period_map.get(days, f"{days}d")
        ticker = yf.Ticker(sym)
        bars = ticker.history(period=period, interval=interval, progress=False)  # type: ignore[no-untyped-call]
        if bars.empty:
            return
        idx: DatetimeIndex = bars.index  # type: ignore[assignment]
        if idx.tz is None:
            bars.index = idx.tz_localize("UTC")
        else:
            bars.index = idx.tz_convert("UTC")
        cutoff = datetime.now(_tz.utc) - _td(days=days)
        bars = bars[bars.index >= cutoff]  # type: ignore[operator]
        if bars.empty:
            return
        call_ratio, put_ratio, prem_per_share = 0.55, 0.45, 0.5
        try:
            from logic.gamma import compute_gamma_exposure

            cached = _gex_cache.get(sym)
            result = cached[1] if cached else compute_gamma_exposure(sym)
            if not cached:
                _gex_cache[sym] = (time.monotonic(), result)
            total = (result.call_premium or 0) + (result.put_premium or 0)
            if total > 0:
                call_ratio = result.call_premium / total
                put_ratio = result.put_premium / total
            prem_per_share = total / max(result.total_volume or 1, 1)
        except Exception:
            pass
        since_iso = cutoff.strftime("%Y-%m-%dT%H:%M:%SZ")
        with _flow_db() as con:
            existing = {
                r[0]
                for r in con.execute(
                    "SELECT ts FROM net_flow_snapshots WHERE symbol=? AND ts>=?",
                    (sym, since_iso),
                ).fetchall()
            }
        rows_to_insert: list[tuple[str, str, float, float, float, float, float, int]] = []
        for ts_idx, row in bars.iterrows():
            from pandas import Timestamp
            ts: Timestamp = ts_idx  # type: ignore[assignment]
            raw_ts = ts.isoformat(timespec="seconds")
            ts_str: str = raw_ts.replace(" ", "T")
            ts_str = re.sub(r"[+-]00:?00$", "Z", str(ts_str))
            if not ts_str.endswith("Z") and "+" not in ts_str and ts_str.count("-") == 2:
                ts_str += "Z"
            if ts_str in existing:
                continue
            price = float(row.get("Close", 0) or row.get("close", 0) or 0)
            volume = int(row.get("Volume", 0) or row.get("volume", 0) or 0)
            if price <= 0:
                continue
            est_total = volume * prem_per_share
            cp = round(est_total * call_ratio, 0)
            pp = round(est_total * put_ratio, 0)
            rows_to_insert.append(
                (sym, ts_str, round(price, 2), cp, pp, round(cp - pp, 0), round(est_total, 0), volume)
            )
        if rows_to_insert:
            with _flow_db() as con:
                con.executemany(
                    "INSERT OR IGNORE INTO net_flow_snapshots "
                    "(symbol,ts,price,call_prem,put_prem,net_flow,total_prem,volume) "
                    "VALUES (?,?,?,?,?,?,?,?)",
                    rows_to_insert,
                )
    except Exception as exc:
        logger.error("backfill_history %s %dd failed: %s", sym, days, exc)
        with _backfill_lock:
            _backfilled.discard(key)


def background_poller() -> None:
    from logic.gamma import compute_gamma_exposure

    last_date = datetime.now(_tz.utc).date()
    while True:
        time.sleep(_POLL_INTERVAL)
        now = time.monotonic()
        today = datetime.now(_tz.utc).date()
        if today != last_date:
            with _backfill_lock:
                _backfilled.clear()
            last_date = today
        with _watched_lock:
            expired = [s for s, t in _watched_ttl.items() if now - t > _WATCH_TTL]
            for s in expired:
                _watched.discard(s)
                _watched_ttl.pop(s, None)
            symbols = list(_watched)
        for sym in symbols:
            try:
                result = compute_gamma_exposure(sym)
                _gex_cache[sym] = (time.monotonic(), result)
                _record_flow_snapshot(
                    symbol=result.symbol,
                    spot=result.spot,
                    call_prem=result.call_premium,
                    put_prem=result.put_premium,
                    net_flow=result.net_flow,
                    total_prem=result.call_premium + result.put_premium,
                    volume=result.total_volume,
                )
            except Exception as exc:
                logger.debug("Poller error for %s: %s", sym, exc)
