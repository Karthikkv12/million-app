"""optionflow/workers/gex_respot.py — dealer levels re-priced at the live price every second.

A full GEX refresh downloads ~13 chain requests per symbol (one per expiry), and Public allows about 8 requests a
second, so a full refresh can't run every second. What moves second to second is the spot: open interest changes
once a day and IV slowly. So once a second this worker asks Public for the price of every watched symbol in ONE
batched quotes request and re-prices each symbol's last chain at it (flow.service.respot → gamma.respot_gex):
gamma, flip, walls, king, outlook and the heatmap move with the price; OI, IV, volume and premium stay as of the
last full refresh (the gex poller, as fast as the rate limit allows).

Only while chains come from the real-time source (Public); Yahoo prices are delayed, so respot would add nothing.
Symbols Public doesn't price are skipped (no Yahoo fallback here: that would be a Yahoo call per second).
"""
from __future__ import annotations

import logging
import threading
import time

from optionflow.modules.flow import gamma, service
from optionflow.providers.market_data import chains_realtime, get_market_data

logger = logging.getLogger("optionflow.respot")

INTERVAL = 1.0      # seconds between re-prices


def tick() -> int:
    """Re-price every watched symbol at its live price; returns how many changed."""
    if not chains_realtime():
        return 0
    want = {s: gamma.chain_symbol(s) for s in service.active_symbols()}
    want = {s: p for s, p in want.items() if p}
    if not want:
        return 0
    batch = getattr(get_market_data(), "quotes_batch", None)
    if batch is None:
        return 0
    quotes = batch(sorted(set(want.values())))
    changed = 0
    for sym, provider_sym in want.items():
        q = quotes.get(provider_sym.strip().upper())
        price = q.get("price") if q else None
        if price and service.respot(sym, float(price)) is not None:
            changed += 1
    return changed


def run_forever() -> None:
    while True:
        started = time.monotonic()
        try:
            tick()
        except Exception as exc:          # never let the loop die (rate limits, a bad chain)
            logger.debug("respot error: %s", exc)
        time.sleep(max(0.05, INTERVAL - (time.monotonic() - started)))


def start() -> threading.Thread:
    t = threading.Thread(target=run_forever, daemon=True, name="gex-respot")
    t.start()
    return t
