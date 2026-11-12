"""optionflow/modules/pulse/worker.py — every INTERVAL seconds on weekdays 04:00–20:00 ET (Public quotes cover the
extended session), check price alerts and paper trades (service.check). One batched quote request per pass, and
none at all when nothing is armed. A daemon thread started by the app's lifespan, like the notify worker."""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime
from typing import Optional

from optionflow.modules.pulse import service
from optionflow.workers.backfill import ET

logger = logging.getLogger("optionflow.pulse")
INTERVAL = 15
_started = False


def session_open(now: Optional[datetime] = None) -> bool:
    t = (now or datetime.now(ET)).astimezone(ET)
    return t.weekday() < 5 and 4 <= t.hour < 20


def tick() -> int:
    if not session_open():
        return 0
    from optionflow.providers.market_data import chains_rate_limited
    try:
        if chains_rate_limited():
            return 0
    except Exception:
        pass
    return len(service.check())


def _loop() -> None:
    while True:
        try:
            tick()
        except Exception:
            logger.exception("pulse worker tick failed")
        time.sleep(INTERVAL)


def start() -> None:
    global _started
    if _started:
        return
    _started = True
    threading.Thread(target=_loop, name="pulse-worker", daemon=True).start()
