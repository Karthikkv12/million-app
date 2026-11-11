"""optionflow/modules/notify/worker.py — once a minute during US market hours, push new hedge alerts.

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
    users = sorted({s["user_id"] for s in service.subscriptions()})
    n = 0
    for uid in users:
        try:
            n += service.run_for_user(uid)
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
