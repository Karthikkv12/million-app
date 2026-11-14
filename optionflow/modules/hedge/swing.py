"""optionflow/modules/hedge/swing.py — the swing-trade read (1 week – 1 month), backtested (pure, no I/O).

Tested in scripts/backtest_signal/swing.py + swing2.py (docs/swing-signal.md): 148 US stocks and ETFs, 1995–2026,
bought at the NEXT open after the signal close, 0.2% round-trip cost, one trade at a time per symbol. Rules chosen
on 1995–2014 by month-clustered t-stat, read once on 2015–2026:

  BUY   a fear dip (hedge.signal fear score ≥ SCORE_CUT: VIX percentile × how oversold)
        OR a drop of ≥ 5% over 5 trading days while the close is above the 200-day average
  SELL  at the first close above the 10-day average, or after 20 trading days. No stop: every stop tested
        (5%, 7%, 10%) lowered the average trade.

Most of the fear-dip trade is the whole market bouncing (excess over the same day's average +0.1%); the 5-day
drop above the 200-day is more about the stock (+0.5% over 10 days). Like the 1–3 month read, it lost in long bear
markets less than a plain hold did, but single trades can lose ~10% (worst 1 in 20).
"""
from __future__ import annotations

from typing import Any, Dict, Optional, Sequence

from optionflow.modules.hedge import signal as sg

DROP, DROP_DAYS = 0.05, 5          # ≥ 5% down over 5 trading days …
TREND = 200                        # … with the close above the 200-day average
EXIT_MA, MAX_DAYS = 10, 20         # sell: first close above the 10-day average, else after 20 trading days

# Trade results, after costs (swing2.json): IS = 1995–2014 (rule chosen), OOS = 2015–2026 (unseen).
STATS: Dict[str, Dict[str, float]] = {
    "is":  {"trades": 13495, "avg": 0.0084, "median": 0.0122, "win": 0.670, "days": 5.4, "worst5": -0.082, "t": 9.45},
    "oos": {"trades": 11923, "avg": 0.0056, "median": 0.0108, "win": 0.655, "days": 5.5, "worst5": -0.091, "t": 5.33},
    "baseline_oos_5d": {"avg": 0.0016, "win": 0.512},   # any day, held 5 days
}


def read(closes: Sequence[float], vix: Sequence[float], live: bool = True,
         fear_buy_below: Optional[float] = None) -> Optional[Dict[str, Any]]:
    """The swing read on the latest close. `closes`: daily closes, oldest first; the last is the close being decided
    (`live`: today's session, so tomorrow's open is the entry). `fear_buy_below`: hedge.signal's close that would make
    the fear score trigger at today's VIX (plan.buy_below), to report the nearer of the two triggers.
    None without 200 days of history."""
    px = [float(c) for c in closes if c is not None]
    if len(px) < TREND + 1:
        return None
    spot = px[-1]
    m200, m10 = sg.sma(px, TREND), sg.sma(px, EXIT_MA)
    ret5 = spot / px[-1 - DROP_DAYS] - 1.0
    fs = sg.fear_score(sg.vix_percentile(vix), sg.rsi(px))
    fear = fs is not None and fs >= sg.SCORE_CUT
    drop = ret5 <= -DROP and spot > m200
    out: Dict[str, Any] = {"verdict": "BUY" if (fear or drop) else "WAIT", "ret5": round(ret5, 4),
                           "vs_200d": round(spot / m200 - 1.0, 4), "exit_above": round(m10, 2), "max_days": MAX_DAYS,
                           "fear": fear, "drop": drop, "buy_below": None, "reason": ""}
    if fear or drop:
        why = []
        if fear:
            why.append(f"fear dip (score {fs:.2f})")
        if drop:
            why.append(f"down {-ret5:.1%} in 5 days above the 200-day")
        out["reason"] = "Swing buy: " + " and ".join(why) + (f". Sell at the first close above the 10-day average "
                                                              f"(now {m10:,.2f}) or after {MAX_DAYS} trading days.")
        return out
    # the next close that would trigger it: a 5-day drop of 5% (if that close is still above the 200-day), or the
    # fear trigger at today's VIX
    # live: today's close is the one being decided (vs 5 sessions before today); else the next session's close
    ref = px[-1 - DROP_DAYS] if live else px[-DROP_DAYS]
    cands = []
    lvl = ref * (1.0 - DROP)
    if lvl > m200 and lvl < spot:
        cands.append(lvl)
    if fear_buy_below is not None and fear_buy_below < spot:
        cands.append(float(fear_buy_below))
    if cands:
        out["buy_below"] = round(max(cands), 2)
    out["reason"] = ("Wait: no swing setup" + (f". Swing buy if it closes ≤ {out['buy_below']:,.2f} "
                                               f"({out['buy_below'] / spot - 1.0:+.1%})" if out["buy_below"] else "")
                     + (". Under the 200-day: only a fear dip qualifies" if spot <= m200 else "") + ".")
    return out
