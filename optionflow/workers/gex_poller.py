"""optionflow/workers/gex_poller.py — keep GEX fresh for symbols that open boards are watching.

Every POLL_INTERVAL seconds, recomputes GEX for each watched symbol, which
also refreshes the cache and records a flow snapshot. Runs as a daemon thread
started by the app's lifespan.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone

from optionflow.modules.flow import service
from optionflow.workers import backfill

logger = logging.getLogger("optionflow.poller")

POLL_INTERVAL = 10  # seconds


def run_forever() -> None:
    last_date = datetime.now(timezone.utc).date()
    while True:
        time.sleep(POLL_INTERVAL)
        today = datetime.now(timezone.utc).date()
        if today != last_date:
            backfill.reset_daily()
            last_date = today
        for sym in service.active_symbols():
            try:
                service.refresh_gex(sym)
            except Exception as exc:
                logger.debug("Poller error for %s: %s", sym, exc)


def start() -> threading.Thread:
    t = threading.Thread(target=run_forever, daemon=True, name="gex-poller")
    t.start()
    return t
