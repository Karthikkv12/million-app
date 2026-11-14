"""optionflow/modules/hedge/scan_live.py — the Signal scanner, live every second in regular market hours, with alerts.

Owner, 2026-11-14: "these signal scanners must run and alert every sec during regular market hours".

Each tick (TICK seconds, 09:30–16:00 ET on weekdays):
- one batched Public quote request (QUOTE_BATCH symbols) for the 100 popular names, every tick. The S&P 500 is live
  only while someone has opened it in the last VIEW_TTL seconds, and goes LIVE_BATCH names per tick (all 503 in ~10 s):
  Public allows ~8 requests a second for the whole app, and the live flow / dealer refresh shares them;
- each name's cached daily bars get today's bar set to the live price and are read again (hedge.signal +
  hedge.swing, ~0.6 ms a name), so the rows in GET /hedge/scan move with the tape;
- a name that turns into a Buy (1–3 month), a Swing buy or a Strong swing buy, and stays one for CONFIRM straight
  ticks, alerts once per symbol and kind per day: the Notification Center of every user whose `scanner` pref is on,
  and a phone push where notifications are set up.

The rules are read on closes: an intraday Buy means "if it closes here". The backtests buy at the NEXT open after the
close, so the alert says so.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger("optionflow.hedge.scan_live")

TICK = 1.0                 # seconds between ticks
CONFIRM = 3                # straight ticks a Buy must hold before it alerts (a one-print wick does not)
LIVE_BATCH = 50            # S&P 500 names re-priced per tick (one Public request)
VIEW_TTL = 15 * 60.0       # the S&P 500 stays live this long after someone opens it
IDLE_SLEEP = 15.0          # outside market hours

_lock = threading.Lock()
_started = False
_live: Dict[str, Dict[str, Any]] = {}          # universe -> {"tick_at": epoch, "ticks": int, "priced": int}
_streak: Dict[str, int] = {}                   # "universe|SYM|kind" -> straight ticks the Buy has held
_cursor: Dict[str, int] = {}                   # S&P 500 rotation position
_closed: Dict[str, str] = {}                   # universe -> ET day whose closing reads are logged


def market_open(now: Optional[datetime] = None) -> bool:
    from optionflow.modules.notify.service import ET
    t = (now or datetime.now(ET)).astimezone(ET)
    return t.weekday() < 5 and (9, 30) <= (t.hour, t.minute) < (16, 0)


def status(universe: str) -> Dict[str, Any]:
    """For GET /hedge/scan: is this universe being re-priced every second right now, and when it last was."""
    with _lock:
        s = dict(_live.get(universe) or {})
    at = s.get("tick_at")
    live = bool(at and time.time() - at < 10 * TICK + 5 and market_open())
    return {"live": live, "tick_at": datetime.fromtimestamp(at, timezone.utc).isoformat(timespec="seconds").replace(
        "+00:00", "Z") if at else None, "tick_seconds": TICK}


def patch(bars: List[Dict[str, Any]], price: float, today: str) -> List[Dict[str, Any]]:
    """Daily bars with today's bar at the live price (appended when the cached bars end before today)."""
    if not bars:
        return bars
    last = bars[-1]
    if last.get("date") == today:
        hi = max(x for x in (last.get("high"), price) if x is not None)
        lo = min(x for x in (last.get("low"), price) if x is not None)
        return bars[:-1] + [dict(last, close=price, high=hi, low=lo)]
    return bars + [{"date": today, "open": price, "high": price, "low": price, "close": price, "volume": None}]


def kinds(r: Dict[str, Any]) -> List[str]:
    """The Buy reads this row has now (what can alert)."""
    out = []
    if r.get("verdict") == "ADD":
        out.append("BUY")
    if r.get("swing") == "BUY":
        out.append("SWING_STRONG" if r.get("swing_strong") else "SWING")
    return out


def alert(r: Dict[str, Any], kind: str) -> Dict[str, Any]:
    sym, px = r["symbol"], r["price"]
    if kind == "BUY":
        title = f"{sym}: Buy (1–3 months)"
        body = (f"Fear score {r.get('fear_score') or 0:.2f} at ${px:,.2f}. If it closes here, the backtested Buy is on; "
                f"add in thirds, 10+ trading days apart.")
    else:
        word = "Strong swing buy" if kind == "SWING_STRONG" else "Swing buy"
        title = f"{sym}: {word} (1–4 weeks)"
        ex = r.get("swing_exit_above")
        body = (f"{(r.get('ret5') or 0) * 100:+.1f}% in 5 days at ${px:,.2f}. If it closes here: buy at the next open, sell at "
                f"the first close above the 10-day average{f' (now ${ex:,.2f})' if ex else ''} or after 20 trading days.")
    return {"key": f"scan:{sym}:{kind}", "kind": "scanner", "symbol": sym, "title": title, "body": body,
            "url": f"/stocks/{sym}"}


def confirmed(universe: str, rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Alerts for rows whose Buy has held CONFIRM straight ticks (exactly then: once per streak; the per-day key
    stops repeats)."""
    out = []
    with _lock:
        for r in rows:
            now = set(kinds(r))
            for k in ("BUY", "SWING", "SWING_STRONG"):
                key = f"{universe}|{r['symbol']}|{k}"
                if k in now:
                    _streak[key] = _streak.get(key, 0) + 1
                    if _streak[key] == CONFIRM:
                        out.append(alert(r, k))
                else:
                    _streak.pop(key, None)
    return out


def _users() -> List[int]:
    from database.models import User
    from optionflow.core.db import get_session
    s = get_session()
    try:
        return [uid for (uid,) in s.query(User.id).all()]
    finally:
        s.close()


def deliver(alerts: List[Dict[str, Any]], users_fn=None, sender=None) -> int:
    """Notification Center for every user with the `scanner` pref on; a push to their devices that allow it. Returns
    pushes sent."""
    if not alerts:
        return 0
    from optionflow.modules.notify import service as ns
    sent = 0
    for uid in (users_fn or _users)():
        try:
            prefs = ns.get_prefs(uid)
            if not prefs.get("scanner", True):
                continue
            ns.record(uid, alerts)
            subs = ns.subscriptions(uid)
            if not subs or ns.config()[0] is None:
                continue
            new = set(ns.SENT.new(uid, [a["key"] for a in alerts]))
            todo = [a for a in alerts if a["key"] in new]
            if len(todo) > ns.MAX_PER_CYCLE:
                todo = [{"key": "scan-summary", "kind": "summary", "symbol": "", "title": f"Scanner: {len(todo)} new buys",
                         "body": ", ".join(a["title"] for a in todo[:4]) + "…", "url": "/catalyst/signals"}]
            for a in todo:
                sent += ns.push_user(uid, {"title": a["title"], "body": a["body"], "url": a["url"], "tag": a["key"]},
                                     sender=sender, alert=a)["sent"]
        except Exception:
            logger.exception("scanner alerts for user %s failed", uid)
    return sent


def tick(universe: str, symbols: List[str], quotes_fn=None) -> List[Dict[str, Any]]:
    """Re-price `symbols` of `universe` at the live price and update its scan rows. Returns the confirmed alerts."""
    from optionflow.modules.hedge import scan as sc
    from optionflow.modules.hedge import service
    st = sc._states[universe]
    if not st["rows"] or not symbols:
        return []
    if quotes_fn is None:
        from optionflow.providers.market_data import get_market_data
        md = get_market_data()
        quotes_fn = getattr(md, "quotes_batch", None)
        if quotes_fn is None:
            return []
    q = quotes_fn(symbols) or {}
    vbars = service._daily_bars(service.VIX)
    vix, vix_dates = [b["close"] for b in vbars], [b["date"] for b in vbars]
    today = service._session_frac()[0].isoformat()
    fresh: Dict[str, Dict[str, Any]] = {}
    for sym in symbols:
        price = (q.get(sym.upper()) or {}).get("price")
        if not price:
            continue
        try:
            r = sc.row(sym, vix, vix_dates, today, bars=patch(sc._bars(sym), float(price), today))
        except Exception:
            logger.exception("live scan %s failed", sym)
            continue
        if r:
            fresh[sym] = r
    if fresh:
        with sc._lock:
            rows = [fresh.get(r["symbol"], r) for r in st["rows"]]
            sc.sort_rows(rows)
            st["rows"] = rows
    if fresh:                                # no live quotes (Public not set up / failing): not "live"
        with _lock:
            s = _live.setdefault(universe, {"ticks": 0})
            s.update(tick_at=time.time(), ticks=s["ticks"] + 1, priced=len(fresh))
    return confirmed(universe, list(fresh.values()))


def _symbols(universe: str) -> List[str]:
    from optionflow.modules.hedge import scan as sc
    syms = sc.UNIVERSES[universe]
    if len(syms) <= 2 * LIVE_BATCH:
        return list(syms)
    i = _cursor.get(universe, 0) % len(syms)
    _cursor[universe] = i + LIVE_BATCH
    return (syms[i:] + syms[:i])[:LIVE_BATCH]


def _today() -> str:
    from optionflow.modules.notify.service import ET
    return datetime.now(ET).date().isoformat()


def log_close(now: Optional[datetime] = None) -> int:
    """After 16:00 ET on a weekday, once per universe and day: log the Buy reads on the session's last re-price
    (hedge.signal_log, trigger "close"). Only universes re-priced live today, so the rows are today's closes."""
    from optionflow.modules.hedge import scan as sc, signal_log
    from optionflow.modules.notify.service import ET
    t = (now or datetime.now(ET)).astimezone(ET)
    if t.weekday() >= 5 or (t.hour, t.minute) < (16, 0):
        return 0
    day, n = t.date().isoformat(), 0
    for u in sc.UNIVERSES:
        with _lock:
            at = (_live.get(u) or {}).get("tick_at")
        if _closed.get(u) == day or not at or datetime.fromtimestamp(at, ET).date().isoformat() != day:
            continue
        _closed[u] = day
        with sc._lock:
            rows = list(sc._states[u]["rows"])
        n += signal_log.log(rows, "close", day, universe=u)
    return n


def run_once() -> int:
    """One tick over the live universes; returns pushes sent."""
    from optionflow.modules.hedge import scan as sc
    alerts: List[Dict[str, Any]] = []
    for u in sc.UNIVERSES:
        st = sc._states[u]
        if u != "popular" and time.time() - st.get("viewed", 0.0) > VIEW_TTL:
            continue
        if not st["rows"]:
            sc.get(universe=u)               # starts the daily-bar scan the live ticks build on
            continue
        alerts += tick(u, _symbols(u))
    seen, uniq = set(), []
    for a in alerts:                         # a name in both universes alerts once
        if a["key"] not in seen:
            seen.add(a["key"]); uniq.append(a)
    if uniq:
        from optionflow.modules.hedge import signal_log
        rows = {r["symbol"]: r for u in sc.UNIVERSES for r in sc._states[u]["rows"]}
        signal_log.log([rows[a["symbol"]] for a in uniq if a["symbol"] in rows], "intraday", _today())
    return deliver(uniq)


def _loop() -> None:
    while True:
        t0 = time.monotonic()
        if not market_open():
            try:
                log_close()                  # once a day after the close: the track record's "close" entries
            except Exception:
                logger.exception("signal log at the close failed")
            time.sleep(IDLE_SLEEP)
            continue
        try:
            from optionflow.providers.market_data import chains_rate_limited
            if not chains_rate_limited():
                run_once()
        except Exception:
            logger.exception("live scan tick failed")
        time.sleep(max(0.05, TICK - (time.monotonic() - t0)))


def start() -> None:
    global _started
    if _started:
        return
    _started = True
    threading.Thread(target=_loop, name="signal-scan-live", daemon=True).start()
