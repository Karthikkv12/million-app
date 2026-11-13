"""optionflow/modules/flow/traded.py — premium actually traded today, from per-contract volume changes.

The snapshot totals (call_prem / put_prem) are open interest × mid: the value of the open positions, so their
change through the day is mostly repricing (11-12: NVDA +$3.1B "bullish" on a −4.3% day, T-67). This tracker counts
only new trading instead:

    traded += Δvolume × mid × lot        per contract, at every refresh of the symbol

Rules
- Only the nearest MAX_EXPIRIES expiries count. Public serves 12 and Yahoo serves more; on the same 12 the two
  sources agree, so a refresh that switches source doesn't jump.
- State is per symbol and US-Eastern day, and only updated inside the session (09:30–16:05 ET, weekdays).
- A contract's first sighting of the day sets its baseline. It counts its whole volume only when the symbol already
  has state today (a contract listed later); the symbol's first refresh of the day counts nothing before 09:45 ET,
  because the chain can still carry the previous session's volume for the first minutes. From 09:45 ET the first
  refresh counts each contract's volume so far at the current mid (an estimate for the time nobody watched).
- After a restart the day's totals come back from the last snapshot that has them, and current volumes become the
  baseline (trading while the API was down is not counted).
- Volume that falls a little (one source lags the other) is ignored and the baseline keeps the higher number; a
  fall below half (the chain reset for a new session) restarts that contract from its new volume.
"""
from __future__ import annotations

import logging
import math
import threading
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Callable, Dict, Iterable, Optional, Tuple

logger = logging.getLogger("optionflow.flow.traded")

MAX_EXPIRIES = 12
OPEN_MIN = 9 * 60 + 30
CLOSE_MIN = 16 * 60 + 5
FRESH_MIN = 9 * 60 + 45          # from here a first refresh trusts the chain's volume as today's
RESET_RATIO = 0.5

Key = Tuple[str, float, str]      # (expiry, strike, otype)


@dataclass
class _State:
    day: date
    call: float = 0.0
    put: float = 0.0
    last: Dict[Key, float] = field(default_factory=dict)


_state: Dict[str, _State] = {}
_lock = threading.Lock()


def clear() -> None:
    with _lock:
        _state.clear()


def in_session(now: datetime) -> bool:
    from optionflow.workers.backfill import ET
    et = now.astimezone(ET)
    return et.weekday() < 5 and OPEN_MIN <= et.hour * 60 + et.minute <= CLOSE_MIN


def contracts(df, lot: int = 100) -> list:
    """[(key, volume, premium per contract)] for the nearest MAX_EXPIRIES expiries of a chain frame."""
    if df is None or len(df) == 0:
        return []
    keep = set(sorted(df["expiry"].unique().tolist())[:MAX_EXPIRIES])
    out = []
    for exp, strike, otype, vol, mid in zip(df["expiry"], df["strike"], df["otype"], df["volume"], df["mid"]):
        if exp not in keep:
            continue
        try:
            v, m = float(vol), float(mid)
        except (TypeError, ValueError):
            continue
        if math.isnan(v) or v < 0:
            continue
        if math.isnan(m) or m < 0:
            m = 0.0
        out.append(((str(exp), float(strike), str(otype)), v, m * lot))
    return out


def update(symbol: str, rows: Iterable[tuple], now: Optional[datetime] = None,
           restore: Optional[Callable[[str, date], Optional[Tuple[float, float]]]] = None) -> Optional[Tuple[float, float]]:
    """Fold one refresh into the day's totals; returns (call, put) traded today, or None outside the session
    (and before the symbol's first in-session refresh). `restore(symbol, day)` gives the totals saved today."""
    from optionflow.workers.backfill import ET
    now = now or datetime.now(timezone.utc)
    sym = symbol.upper()
    et = now.astimezone(ET)
    day = et.date()
    with _lock:
        st = _state.get(sym)
        if not in_session(now):
            return (st.call, st.put) if st and st.day == day else None
        rows = list(rows)
        if st is None or st.day != day:
            saved = None
            if restore is not None:
                try:
                    saved = restore(sym, day)
                except Exception as exc:
                    logger.info("traded: no saved totals for %s: %s", sym, exc)
            st = _State(day=day)
            _state[sym] = st
            if saved is not None:                       # restart: keep today's totals, baseline = now
                st.call, st.put = saved
                st.last = {k: v for k, v, _ in rows}
                return st.call, st.put
            count_first = et.hour * 60 + et.minute >= FRESH_MIN
            for k, v, prem in rows:
                st.last[k] = v
                if count_first:
                    _add(st, k, v * prem)
            return st.call, st.put
        for k, v, prem in rows:
            prev = st.last.get(k)
            if prev is None:
                st.last[k] = v
                _add(st, k, v * prem)
            elif v > prev:
                st.last[k] = v
                _add(st, k, (v - prev) * prem)
            elif v < prev * RESET_RATIO:
                st.last[k] = v
                _add(st, k, v * prem)
        return st.call, st.put


def _add(st: _State, k: Key, amount: float) -> None:
    if amount <= 0:
        return
    if k[2] == "call":
        st.call += amount
    else:
        st.put += amount
