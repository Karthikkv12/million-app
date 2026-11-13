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

Side (who started the trade)
- Each refresh's new volume on a contract we already track is filed as bought, sold or mid by where the contract's
  last trade printed inside the bid/ask (`side`): in the top SIDE_EDGE of the spread or above the ask = bought, the
  bottom SIDE_EDGE or below the bid = sold. In the middle, the tick decides when the last price moved since the
  previous refresh (up = bought, down = sold); otherwise it is mid. Volume from a first sighting or a chain reset has
  no side (it piled up while nobody watched), so bought + sold ≤ the total.
- This is the quote rule on one print per refresh, not a trade-by-trade tape: when many trades happen between two
  refreshes, all of them take the side of the last one.

By strike (feature: delta-adjusted aggression)
- Every sided amount is also kept per contract, in premium and in delta dollars: Δvolume × delta × lot × spot, with
  the contract's Black-Scholes delta at that refresh (calls +, puts −). Customer delta = bought − sold delta dollars:
  positive means customers added long delta (bought calls / sold puts), which dealers on the other side hedge by
  buying shares. `strikes()` reads it; `restore_strikes` brings it back after a restart (flow.repo saves it).
"""
from __future__ import annotations

import logging
import math
import threading
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Callable, Dict, Iterable, List, Optional, Tuple

import numpy as np

logger = logging.getLogger("optionflow.flow.traded")

MAX_EXPIRIES = 12
OPEN_MIN = 9 * 60 + 30
CLOSE_MIN = 16 * 60 + 5
FRESH_MIN = 9 * 60 + 45          # from here a first refresh trusts the chain's volume as today's
RESET_RATIO = 0.5
SIDE_EDGE = 0.35                  # last within this share of the spread from the ask (bid) = bought (sold)

Key = Tuple[str, float, str]      # (expiry, strike, otype)


@dataclass
class _State:
    day: date
    call: float = 0.0
    put: float = 0.0
    last: Dict[Key, float] = field(default_factory=dict)
    px: Dict[Key, float] = field(default_factory=dict)          # each contract's last trade price at the last refresh
    call_bought: float = 0.0
    call_sold: float = 0.0
    put_bought: float = 0.0
    put_sold: float = 0.0
    # per contract, sided volume only: [bought premium, sold premium, bought delta $, sold delta $]
    by_k: Dict[Key, List[float]] = field(default_factory=dict)


_state: Dict[str, _State] = {}
_lock = threading.Lock()


def clear() -> None:
    with _lock:
        _state.clear()


def in_session(now: datetime) -> bool:
    from optionflow.workers.backfill import ET
    et = now.astimezone(ET)
    return et.weekday() < 5 and OPEN_MIN <= et.hour * 60 + et.minute <= CLOSE_MIN


def deltas(df, spot: Optional[float], r: float = 0.045) -> np.ndarray:
    """Black-Scholes delta per row of a chain frame (calls 0..1, puts −1..0); 0 where IV, T or spot is missing."""
    n = len(df)
    if not spot or spot <= 0 or n == 0 or "iv" not in df.columns or "T" not in df.columns:
        return np.zeros(n)
    K = np.asarray(df["strike"], float)
    T = np.nan_to_num(np.asarray(df["T"], float))
    v = np.nan_to_num(np.asarray(df["iv"], float))
    ok = (K > 0) & (T > 0) & (v > 0)
    d1 = np.zeros(n)
    sq = v[ok] * np.sqrt(T[ok])
    d1[ok] = (np.log(spot / K[ok]) + (r + 0.5 * v[ok] ** 2) * T[ok]) / sq
    erf = np.vectorize(math.erf)
    nd1 = 0.5 * (1.0 + erf(d1 / math.sqrt(2.0)))
    call = np.asarray(df["otype"]).astype(str) == "call"
    out = np.where(call, nd1, nd1 - 1.0)
    return np.where(ok, out, 0.0)


def contracts(df, lot: int = 100, spot: Optional[float] = None) -> list:
    """[(key, volume, premium per contract, bid, ask, last, delta $ per contract)] for the nearest MAX_EXPIRIES
    expiries of a chain frame (bid / ask / last are None when the frame has no such column or no quote; delta $ is
    delta × lot × spot, 0 without a spot or IV)."""
    if df is None or len(df) == 0:
        return []
    keep = set(sorted(df["expiry"].unique().tolist())[:MAX_EXPIRIES])
    out = []
    n = len(df)
    col = lambda c: df[c] if c in df.columns else [None] * n
    dd = deltas(df, spot) * lot * (spot or 0.0)
    for exp, strike, otype, vol, mid, bid, ask, last, d in zip(df["expiry"], df["strike"], df["otype"], df["volume"],
                                                               df["mid"], col("bid"), col("ask"), col("last"), dd):
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
        out.append(((str(exp), float(strike), str(otype)), v, m * lot, _num(bid), _num(ask), _num(last), float(d)))
    return out


def _num(x) -> Optional[float]:
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) and f > 0 else None


def side(bid: Optional[float], ask: Optional[float], last: Optional[float], prev_last: Optional[float] = None) -> str:
    """"bought", "sold" or "mid" for volume whose latest print is `last` (see the module notes)."""
    if last is None:
        return "mid"
    if bid is not None and ask is not None and ask >= bid:
        if last >= ask:
            return "bought"
        if last <= bid:
            return "sold"
        spread = ask - bid
        if spread > 0:
            pos = (last - bid) / spread
            if pos >= 1 - SIDE_EDGE:
                return "bought"
            if pos <= SIDE_EDGE:
                return "sold"
    if prev_last is not None and abs(last - prev_last) > 1e-9:
        return "bought" if last > prev_last else "sold"
    return "mid"


def sides(symbol: str, now: Optional[datetime] = None) -> Optional[Tuple[float, float, float, float]]:
    """Today's (call bought, call sold, put bought, put sold) premium for `symbol`, or None with no state today."""
    from optionflow.workers.backfill import ET
    day = (now or datetime.now(timezone.utc)).astimezone(ET).date()
    with _lock:
        st = _state.get(symbol.upper())
        if st is None or st.day != day:
            return None
        return st.call_bought, st.call_sold, st.put_bought, st.put_sold


def strikes(symbol: str, now: Optional[datetime] = None) -> Optional[Tuple[date, Dict[Key, List[float]]]]:
    """(day, {contract key: [bought prem, sold prem, bought delta $, sold delta $]}) for `symbol` today, or None."""
    from optionflow.workers.backfill import ET
    day = (now or datetime.now(timezone.utc)).astimezone(ET).date()
    with _lock:
        st = _state.get(symbol.upper())
        if st is None or st.day != day:
            return None
        return st.day, {k: list(v) for k, v in st.by_k.items()}


def update(symbol: str, rows: Iterable[tuple], now: Optional[datetime] = None,
           restore: Optional[Callable[[str, date], Optional[tuple]]] = None,
           restore_strikes: Optional[Callable[[str, date], Optional[Dict[Key, List[float]]]]] = None,
           ) -> Optional[Tuple[float, float]]:
    """Fold one refresh into the day's totals; returns (call, put) traded today, or None outside the session
    (and before the symbol's first in-session refresh). `restore(symbol, day)` gives the totals saved today:
    (call, put) or (call, put, call bought, call sold, put bought, put sold). Rows are (key, volume, premium per
    contract) with optional (bid, ask, last) after them, as `contracts` builds."""
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
                st.call, st.put = saved[0], saved[1]
                if len(saved) >= 6 and all(x is not None for x in saved[2:6]):
                    st.call_bought, st.call_sold, st.put_bought, st.put_sold = (float(x) for x in saved[2:6])
                if restore_strikes is not None:
                    try:
                        st.by_k = {k: list(v) for k, v in (restore_strikes(sym, day) or {}).items()}
                    except Exception as exc:
                        logger.info("traded: no saved strikes for %s: %s", sym, exc)
                for r in rows:
                    st.last[r[0]] = r[1]
                    _remember_px(st, r)
                return st.call, st.put
            count_first = et.hour * 60 + et.minute >= FRESH_MIN
            for r in rows:
                k, v, prem = r[0], r[1], r[2]
                st.last[k] = v
                _remember_px(st, r)
                if count_first:
                    _add(st, k, v * prem)
            return st.call, st.put
        for r in rows:
            k, v, prem = r[0], r[1], r[2]
            prev = st.last.get(k)
            if prev is None:
                st.last[k] = v
                _add(st, k, v * prem)
            elif v > prev:
                st.last[k] = v
                bid, ask, last, dd = (tuple(r[3:7]) + (None, None, None, None))[:4]
                _add(st, k, (v - prev) * prem, side(bid, ask, last, st.px.get(k)), (v - prev) * (dd or 0.0))
            elif v < prev * RESET_RATIO:
                st.last[k] = v
                _add(st, k, v * prem)
            _remember_px(st, r)
        return st.call, st.put


def _remember_px(st: _State, r: tuple) -> None:
    if len(r) >= 6 and r[5] is not None:
        st.px[r[0]] = r[5]


def _add(st: _State, k: Key, amount: float, how: Optional[str] = None, dd: float = 0.0) -> None:
    if amount <= 0:
        return
    if how in ("bought", "sold"):
        b = st.by_k.setdefault(k, [0.0, 0.0, 0.0, 0.0])
        i = 0 if how == "bought" else 1
        b[i] += amount
        b[i + 2] += dd
    if k[2] == "call":
        st.call += amount
        if how == "bought":
            st.call_bought += amount
        elif how == "sold":
            st.call_sold += amount
    else:
        st.put += amount
        if how == "bought":
            st.put_bought += amount
        elif how == "sold":
            st.put_sold += amount
