"""optionflow/modules/notify/worker.py — once a minute during US market hours, push new hedge and level alerts.

Started by the app's lifespan (`notify.worker.start()`); a daemon thread, like the GEX poller. Does nothing
until the VAPID keys are set and someone has turned notifications on.
"""
from __future__ import annotations

import logging
import threading
import time

from optionflow.modules.notify import service

logger = logging.getLogger("optionflow.notify")
INTERVAL = 60
_started = False


def tick() -> int:
    priv, _pub, _c = service.config()
    if priv is None or not service.market_open():
        return 0
    from optionflow.modules.hedge import service as hedge
    subs = service.subscriptions()
    users = sorted({s["user_id"] for s in subs})
    books, syms = {}, set()
    for uid in users:                       # books once per user; level symbols across everyone
        try:
            books[uid] = hedge.books_for(uid)
            syms.update(service.level_symbols(books[uid], [s["prefs"] for s in subs if s["user_id"] == uid]))
        except Exception:
            logger.exception("notify books for user %s failed", uid)
    levels = service.level_alerts(sorted(syms)) if syms else {}
    n = 0
    for uid in users:
        if uid not in books:
            continue
        try:
            n += service.run_for_user(uid, books_fn=lambda _u, b=books[uid]: b, levels=levels)
        except Exception:
            logger.exception("notify tick for user %s failed", uid)
    return n


def _loop() -> None:
    while True:
        try:
            tick()
        except Exception:
            logger.exception("notify worker tick failed")
        time.sleep(INTERVAL)


def start() -> None:
    global _started
    if _started:
        return
    _started = True
    threading.Thread(target=_loop, name="notify-worker", daemon=True).start()
