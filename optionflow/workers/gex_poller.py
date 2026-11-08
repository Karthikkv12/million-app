"""optionflow/workers/gex_poller.py — keep GEX fresh for symbols that open boards are watching.

Every POLL_INTERVAL seconds, recomputes GEX for each watched symbol, which
also refreshes the cache, records a flow snapshot and a (throttled) replay snapshot. Runs as a daemon thread
started by the app's lifespan.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone

from optionflow.modules.flow import history, service
from optionflow.providers.market_data import is_rate_limited
from optionflow.workers import backfill

logger = logging.getLogger("optionflow.poller")

POLL_INTERVAL = 120  # seconds; Yahoo data is ~15 min delayed, and every refresh fetches up to 12 chains


def poll_once() -> None:
    """Refresh GEX for every watched symbol and store replay snapshots."""
    if is_rate_limited():
        return                      # back-off in force: no Yahoo calls at all
    for sym in service.active_symbols():
        try:
            result = service.refresh_gex(sym)
            history.record(result)   # GEX replay snapshot (throttled, never raises) — kept per C-5/C-6
        except Exception as exc:
            logger.debug("Poller error for %s: %s", sym, exc)


def run_forever() -> None:
    last_date = datetime.now(timezone.utc).date()
    while True:
        time.sleep(POLL_INTERVAL)
        today = datetime.now(timezone.utc).date()
        if today != last_date:
            backfill.reset_daily()
            last_date = today
        poll_once()


def start() -> threading.Thread:
    t = threading.Thread(target=run_forever, daemon=True, name="gex-poller")
    t.start()
    return t
