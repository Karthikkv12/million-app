"""optionflow/modules/hedge/signal_log.py — the live track record of the Signal scanner's buys.

Owner, 2026-11-14 (round 4): a forward test on data no rule was fitted to. hedge.scan_live logs
- "intraday": a Buy / Swing buy / Strong swing buy alert that held CONFIRM seconds (what you were told), and
- "close": the reads on the session's last re-price, once a day after 16:00 ET (what the backtests trade: buy at the
  next open).
Outcomes are worked out when read, from daily bars: the return from the NEXT session's open (the backtests' entry)
to the close 5 / 20 / 60 sessions after the signal; the swing kinds also by their own exit (the first close above the
10-day average, or after 20 sessions). Summaries per kind sit beside the backtest's 2015–2026 numbers.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger("optionflow.hedge.signal_log")
KINDS = ("BUY", "SWING", "SWING_STRONG")
HORIZONS = (5, 20, 60)
COST = 0.002                     # the backtests' round-trip cost


def log(rows: List[Dict[str, Any]], trigger: str, day: str, universe: str = "popular") -> int:
    """Store one entry per (day, symbol, kind, trigger) for the Buy reads in `rows` (scan rows). Never raises."""
    from optionflow.modules.hedge.scan_live import kinds
    from database.models import SignalLog as L
    from optionflow.core.db import get_session
    want = [(r, k) for r in rows for k in kinds(r)]
    if not want:
        return 0
    now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    s = get_session()
    try:
        have = {(sym, k) for sym, k in s.query(L.symbol, L.kind).filter(L.day == day, L.trigger == trigger)}
        n = 0
        for r, k in want:
            if (r["symbol"], k) in have:
                continue
            have.add((r["symbol"], k))
            s.add(L(day=day, symbol=r["symbol"], kind=k, trigger=trigger, price=float(r["price"]),
                    fear_score=r.get("fear_score"), ret5=r.get("ret5"), universe=universe, created_at=now))
            n += 1
        s.commit()
        return n
    except Exception:
        logger.exception("signal log: write failed")
        s.rollback()
        return 0
    finally:
        s.close()


def outcome(bars: List[Dict[str, Any]], day: str, kind: str) -> Dict[str, Any]:
    """Forward results of a signal on `day` from daily bars: entry at the next session's open."""
    dates = [b["date"] for b in bars]
    if day not in dates:
        i = next((j - 1 for j, d in enumerate(dates) if d > day), None)       # the last bar on/before the day
        if i is None or i < 0:
            return {"entry": None}
    else:
        i = dates.index(day)
    if i + 1 >= len(bars):
        return {"entry": None}                                                # entry is tomorrow's open
    entry = bars[i + 1].get("open") or bars[i + 1]["close"]
    out: Dict[str, Any] = {"entry": round(entry, 4), "entry_day": bars[i + 1]["date"]}
    for h in HORIZONS:
        j = i + h
        out[f"r{h}"] = (bars[j]["close"] / entry - 1.0 - COST) if j < len(bars) else None
    if kind.startswith("SWING"):
        closes = [b["close"] for b in bars]
        last = min(i + 20, len(bars) - 1)
        for j in range(i + 1, last + 1):
            ma10 = sum(closes[j - 9:j + 1]) / 10 if j >= 9 else None
            done = (ma10 is not None and closes[j] > ma10) or j == i + 20
            if done:
                out["swing_ret"], out["swing_days"] = closes[j] / entry - 1.0 - COST, j - i
                break
        else:
            out["swing_ret"], out["swing_days"] = None, None                 # still open
    return out


def _avg(xs: List[float]) -> Optional[float]:
    return sum(xs) / len(xs) if xs else None


def report(days: int = 365, trigger: Optional[str] = None, bars_fn=None) -> Dict[str, Any]:
    """Entries of the last `days` days with outcomes, and a summary per kind (closed results only)."""
    from datetime import date, timedelta
    from database.models import SignalLog as L
    from optionflow.core.db import get_session
    if bars_fn is None:
        from optionflow.modules.hedge.scan import _bars as bars_fn
    since = (date.today() - timedelta(days=days)).isoformat()
    s = get_session()
    try:
        q = s.query(L).filter(L.day >= since)
        if trigger:
            q = q.filter(L.trigger == trigger)
        rows = q.order_by(L.day.desc(), L.symbol).all()
        entries = [{"day": r.day, "symbol": r.symbol, "kind": r.kind, "trigger": r.trigger, "price": r.price,
                    "fear_score": r.fear_score, "ret5": r.ret5} for r in rows]
    finally:
        s.close()
    cache: Dict[str, List[Dict[str, Any]]] = {}
    for e in entries:
        if e["symbol"] not in cache:
            try:
                cache[e["symbol"]] = bars_fn(e["symbol"]) or []
            except Exception:
                cache[e["symbol"]] = []
        e.update(outcome(cache[e["symbol"]], e["day"], e["kind"]))
    summary = {}
    for k in KINDS:
        es = [e for e in entries if e["kind"] == k and e["trigger"] == "close"]
        main = "swing_ret" if k.startswith("SWING") else "r60"
        done = [e[main] for e in es if e.get(main) is not None]
        summary[k] = {"signals": len(es), "closed": len(done), "avg": _avg(done),
                      "win": (sum(1 for x in done if x > 0) / len(done)) if done else None,
                      "avg_r5": _avg([e["r5"] for e in es if e.get("r5") is not None]),
                      "measure": "swing exit" if main == "swing_ret" else "60 sessions"}
    return {"since": since, "entries": entries, "summary": summary}
