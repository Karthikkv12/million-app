"""optionflow/modules/insight/swings.py — drawdown and upside-spike series from daily closes (pure, no I/O).

- Drawdown: how far the close is below the highest close so far in the range (0 at a new high, negative below).
- Upside spike: how far the close is above the lowest close of the last `lookback` sessions (0 at a new low).
  The lookback grows with the range (LOOKBACK), so a 1-month chart shows week-scale spikes and the all-time
  chart shows half-year runs.
"""
from __future__ import annotations

from collections import deque
from typing import Any, Dict, List, Optional, Sequence

PERIODS = ("1mo", "3mo", "6mo", "1y", "5y", "max")
LOOKBACK = {"1mo": 5, "3mo": 10, "6mo": 21, "1y": 21, "5y": 63, "max": 126}    # sessions
MAX_POINTS = 420


def drawdown(closes: Sequence[float]) -> List[float]:
    out, peak = [], 0.0
    for c in closes:
        peak = max(peak, c)
        out.append(c / peak - 1.0 if peak > 0 else 0.0)
    return out


def spike(closes: Sequence[float], lookback: int) -> List[float]:
    """close ÷ the lowest close of the last `lookback` sessions (today included) − 1."""
    out: List[float] = []
    lows: deque = deque()                       # indices, closes increasing: the front is the window's low
    for i, c in enumerate(closes):
        while lows and closes[lows[-1]] >= c:
            lows.pop()
        lows.append(i)
        while lows[0] <= i - lookback:
            lows.popleft()
        low = closes[lows[0]]
        out.append(c / low - 1.0 if low > 0 else 0.0)
    return out


def _thin(dates: Sequence[str], closes: Sequence[float], dd: Sequence[float], sp: Sequence[float],
          max_points: int) -> List[Dict[str, Any]]:
    """At most `max_points` points; a bucket keeps its deepest drawdown and its highest spike, so extremes survive."""
    n = len(closes)
    size = max(1, -(-n // max_points))
    out = []
    for a in range(0, n, size):
        b = min(n, a + size)
        out.append({"date": dates[b - 1], "close": round(closes[b - 1], 4),
                    "drawdown": round(min(dd[a:b]), 5), "spike": round(max(sp[a:b]), 5)})
    return out


def swings(dates: Sequence[str], closes: Sequence[float], period: str = "1y",
           max_points: int = MAX_POINTS) -> Dict[str, Any]:
    """{lookback, points: [{date, close, drawdown, spike}], stats}. Decimals: −0.12 = 12% below the high."""
    lookback = LOOKBACK.get(period, 21)
    if not closes:
        return {"lookback": lookback, "points": [], "stats": None}
    dd, sp = drawdown(closes), spike(closes, lookback)
    i_dd = min(range(len(dd)), key=dd.__getitem__)
    i_sp = max(range(len(sp)), key=sp.__getitem__)
    i_peak = max(i for i in range(len(dd)) if dd[i] == 0.0)          # the high the current drawdown is measured from
    under = [d for d in dd if d < 0]
    stats = {
        "current_drawdown": round(dd[-1], 5), "max_drawdown": round(dd[i_dd], 5), "max_drawdown_date": dates[i_dd],
        "avg_drawdown": round(sum(under) / len(under), 5) if under else 0.0,
        "peak_date": dates[i_peak], "sessions_since_peak": len(dd) - 1 - i_peak,
        "near_high_share": round(sum(1 for d in dd if d >= -0.05) / len(dd), 4),     # share of sessions within 5% of the high
        "current_spike": round(sp[-1], 5), "max_spike": round(sp[i_sp], 5), "max_spike_date": dates[i_sp],
        "spike_percentile": round(sum(1 for s in sp if s <= sp[-1]) / len(sp), 4),   # today's spike vs the range
        "sessions": len(closes), "first_date": dates[0], "last_date": dates[-1],
    }
    return {"lookback": lookback, "points": _thin(dates, closes, dd, sp, max_points), "stats": stats}


def rolling_low_note(period: str) -> Optional[str]:
    n = LOOKBACK.get(period)
    return f"{n}-session low" if n else None
