"""optionflow/modules/hedge/swing.py — the swing-trade read (1 week – 1 month), backtested (pure, no I/O).

Tested in scripts/backtest_signal/swing.py + swing2.py, re-tested on 200 names in swing3.py + swing3b.py
(docs/swing-signal.md): 200 US stocks and ETFs, 1995–2026,
bought at the NEXT open after the signal close, 0.2% round-trip cost, one trade at a time per symbol. Rules chosen
on 1995–2014 by month-clustered t-stat, read once on 2015–2026:

  BUY   a fear dip (hedge.signal fear score ≥ SCORE_CUT: VIX percentile × how oversold)
        OR a drop of ≥ 5% over 5 trading days while the close is above the 200-day average
  SELL  at the first close above the 10-day average, or after 20 trading days. No stop: every stop tested
        (5%, 7%, 10%) lowered the average trade.
  STRONG  a buy whose 5-day drop is ≥ 7% with the close above the 200-day (round 3, chosen on 1995–2014 among 8
        grades): about twice the average trade (2015–2026 +0.95% vs +0.56%), with a deeper worst case (−13% 1 in 20).

Round 3 (52 names added, never used to choose): the rule held on them (2015–2026 +0.56% a trade, t 5.1). Nine
sharper drop legs (volatility-scaled, stock-only vs SPY, trend filters) did not beat it on 1995–2014 by more than
noise, so the trigger is unchanged.

Most of the fear-dip trade is the whole market bouncing (excess over the same day's average +0.1%); the 5-day
drop above the 200-day is more about the stock (+0.5% over 10 days). Like the 1–3 month read, it lost in long bear
markets less than a plain hold did, but single trades can lose ~10% (worst 1 in 20).
"""
from __future__ import annotations

from typing import Any, Dict, Optional, Sequence

from optionflow.modules.hedge import signal as sg

DROP, DROP_DAYS = 0.05, 5          # ≥ 5% down over 5 trading days …
STRONG_DROP = 0.07                 # STRONG: ≥ 7% down over 5 trading days (above the 200-day)
TREND = 200                        # … with the close above the 200-day average
EXIT_MA, MAX_DAYS = 10, 20         # sell: first close above the 10-day average, else after 20 trading days

# Trade results, after costs, 200 symbols (swing3.json / swing3b.json): IS = 1995–2014 (rule chosen), OOS = 2015–2026
# (unseen), new52 = 2015–2026 on the 52 names added in round 3 (never used to choose anything).
STATS: Dict[str, Dict[str, float]] = {
    "is":  {"trades": 19578, "avg": 0.0081, "median": 0.0125, "win": 0.671, "days": 5.4, "worst5": -0.085, "t": 9.89},
    "oos": {"trades": 16307, "avg": 0.0056, "median": 0.0108, "win": 0.658, "days": 5.5, "worst5": -0.087, "t": 5.51},
    "new52": {"trades": 4384, "avg": 0.0056, "median": 0.0108, "win": 0.664, "days": 5.5, "worst5": -0.078, "t": 5.09},
    "strong_is":  {"trades": 2414, "avg": 0.0153, "median": 0.0255, "win": 0.697, "days": 7.0, "worst5": -0.108, "t": 6.70},
    "strong_oos": {"trades": 2125, "avg": 0.0095, "median": 0.0235, "win": 0.660, "days": 7.5, "worst5": -0.131, "t": 5.36},
    "baseline_oos_5d": {"avg": 0.0016, "win": 0.512},   # any day, held 5 days (148-name run)
    "symbols": 200,
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
    strong = ret5 <= -STRONG_DROP and spot > m200
    out: Dict[str, Any] = {"verdict": "BUY" if (fear or drop) else "WAIT", "ret5": round(ret5, 4),
                           "strong": bool((fear or drop) and strong),
                           "vs_200d": round(spot / m200 - 1.0, 4), "exit_above": round(m10, 2), "max_days": MAX_DAYS,
                           "fear": fear, "drop": drop, "buy_below": None, "reason": ""}
    if fear or drop:
        why = []
        if fear:
            why.append(f"fear dip (score {fs:.2f})")
        if drop:
            why.append(f"down {-ret5:.1%} in 5 days above the 200-day")
        out["reason"] = ("Strong swing buy: " if out["strong"] else "Swing buy: ") + " and ".join(why) + (f". Sell at the first close above the 10-day average "
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
