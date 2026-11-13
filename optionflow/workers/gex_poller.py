"""optionflow/workers/gex_poller.py — keep GEX fresh for symbols that open boards are watching.

Every poll_interval() seconds (120, or 10 while Public.com serves chains), recomputes GEX for each watched symbol, which
also refreshes the cache, records a flow snapshot and a (throttled) replay snapshot. Runs as a daemon thread
started by the app's lifespan.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone

from optionflow.modules.flow import history, service
from optionflow.providers.market_data import chains_rate_limited, chains_realtime
from optionflow.workers import backfill

logger = logging.getLogger("optionflow.poller")

POLL_INTERVAL = 120          # seconds; Yahoo data is ~15 min delayed, and every refresh fetches up to 12 chains
REALTIME_POLL_INTERVAL = 1   # seconds while Public.com (real-time) serves chains: ~13 requests per symbol at the
                             # provider's 8/s pacing (~1.7 s/symbol), so a cycle refreshes each watched symbol about
                             # every 1.7 s × symbols. The pause is just a breather between cycles; Public is never
                             # asked for more than 8/s (C-88). Between cycles workers.gex_respot re-prices the levels
                             # at the live price every second.


def poll_interval() -> int:
    """Seconds until the next cycle: faster while a real-time source serves chains."""
    return REALTIME_POLL_INTERVAL if chains_realtime() else POLL_INTERVAL


def poll_once() -> None:
    """Refresh GEX for every watched symbol and store replay snapshots."""
    if chains_rate_limited():
        return                      # every chain source is backing off: no calls at all
    for sym in service.active_symbols():
        try:
            result = service.refresh_gex(sym)
            history.record(result)   # GEX replay snapshot (throttled, never raises) — kept per C-5/C-6
        except Exception as exc:
            logger.debug("Poller error for %s: %s", sym, exc)


def run_forever() -> None:
    last_date = datetime.now(timezone.utc).date()
    while True:
        time.sleep(poll_interval())
        today = datetime.now(timezone.utc).date()
        if today != last_date:
            backfill.reset_daily()
            last_date = today
        poll_once()


def start() -> threading.Thread:
    t = threading.Thread(target=run_forever, daemon=True, name="gex-poller")
    t.start()
    return t
