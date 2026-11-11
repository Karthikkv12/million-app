"""optionflow/modules/strategy/worker.py — runs each user's scanner and pushes new picks.

Background: once a minute, during US market hours, for every user who turned scanner notifications on and whose
`interval_min` has passed since their last scan. New picks (first time today for that contract) are stored
(scanner_picks) and pushed to every device through notify.service.push_user: one per pick, or one summary when
there are more than MAX_PUSH. A manual scan (POST /strategy/scan) stores its picks too, so the next background
scan doesn't push what the owner has already seen on screen.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any, Dict, Optional

from optionflow.modules.strategy import catalog, scanner, service

logger = logging.getLogger("optionflow.scanner")
TICK = 60
MAX_PUSH = 5
LATEST: Dict[int, Dict[str, Any]] = {}          # user → last scan result (memory; GET /strategy/scan)
_last_run: Dict[int, float] = {}
_running: Dict[int, threading.Lock] = {}
_guard = threading.Lock()
_started = False


def _user_lock(uid: int) -> threading.Lock:
    with _guard:
        return _running.setdefault(uid, threading.Lock())


def run_for_user(user_id: int, notify: bool, sender=None, scan_fn=None) -> Optional[Dict[str, Any]]:
    """Scan with the user's strategy and filters, store picks, push the new ones when `notify`.
    Returns the scan (with `new` = keys first seen in this run), or None if a scan is already running."""
    lock = _user_lock(user_id)
    if not lock.acquire(blocking=False):
        return None
    try:
        st = service.get_settings(user_id)
        rules = catalog.rules_for(st["strategy"], st["overrides"])
        result = (scan_fn or scanner.scan)(rules, st["scanner"], user_id)
        fresh = service.record_picks(user_id, result["rows"])
        result["new"] = [r["key"] for r in fresh]
        if notify and fresh:
            result["pushed"] = _push(user_id, fresh, sender)
        _last_run[user_id] = time.time()
        LATEST[user_id] = result
        return result
    finally:
        lock.release()


def _push(user_id: int, fresh, sender=None) -> int:
    from optionflow.modules.notify import service as notify
    if len(fresh) > MAX_PUSH:
        items = [{"title": f"Scanner: {len(fresh)} new trades",
                  "body": ", ".join(f"{r['symbol']} {_short(r)}" for r in fresh[:4]) + "…", "tag": "scanner-summary"}]
    else:
        items = [{"title": f"Scanner: {r['symbol']} {_short(r)}",
                  "body": f"{(r.get('yield_ann') or 0):.0%}/yr, {r['pullback']:.0%} pullback, IV {(r.get('iv') or 0):.0%}"
                          + (f" ({r['iv_hv']:.1f}× realized)" if r.get("iv_hv") else "") + f". Score {r['score']:.0f}.",
                  "tag": r["key"]} for r in fresh]
    sent = 0
    for it in items:
        sent += notify.push_user(user_id, {**it, "url": "/hedge/scanner"}, sender=sender)["sent"]
    service.mark_notified(user_id, [r["key"] for r in fresh])
    return sent


def _short(r: Dict[str, Any]) -> str:
    exp = (r.get("expiry") or "")[5:]
    if r["action"] == "SELL_PUT_SPREAD":
        return f"{r['strike']:g}/{r['long_strike']:g}P {exp}"
    if r["action"] == "BUY_WRITE":
        return f"buy-write {r['strike']:g}C {exp}"
    return f"{r['strike']:g}P {exp}"


def tick(now: Optional[float] = None) -> int:
    from optionflow.modules.notify import service as notify
    priv, _pub, _c = notify.config()
    if priv is None or not notify.market_open():
        return 0
    now = now or time.time()
    ran = 0
    for uid in service.notify_users():
        interval = service.get_settings(uid)["scanner"]["interval_min"] * 60
        if now - _last_run.get(uid, 0.0) < interval:
            continue
        try:
            if run_for_user(uid, notify=True) is not None:
                ran += 1
                _last_run[uid] = now
        except Exception:
            logger.exception("scanner for user %s failed", uid)
            _last_run[uid] = now                  # don't hammer a failing provider every minute
    return ran


def _loop() -> None:
    while True:
        try:
            tick()
        except Exception:
            logger.exception("scanner worker tick failed")
        time.sleep(TICK)


def start() -> None:
    global _started
    if _started:
        return
    _started = True
    threading.Thread(target=_loop, name="scanner-worker", daemon=True).start()
