"""optionflow/modules/watchlists/cboe.py — Cboe's extended-hours equity options list (GTH pre-market 7:30–9:25 a.m. ET,
Curb post-market 4:00–4:15 p.m. ET).

Source of truth: Cboe's FAQ says the current list is the "GTH Eligible" column of the Cboe Options (C1) Underlying
Reference Data file. Cboe re-balances it twice a year and announces changes by Exchange Notice, so reading the file
keeps the list current with no code change.

We keep stocks and ETFs only: the same column also flags index options (SPX, XSP, VIX, RUT), which already trade
overnight, and exchange test symbols (e.g. PTEST, NTEST, ZBZX), which are dropped by name.

The file (~700 KB) is fetched at most every 12 h; while Cboe is unreachable the last good list is served, and before
any successful fetch the launch list below (Oct 19, 2026) is the fallback.
"""
from __future__ import annotations

import csv
import io
import logging
import threading
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional

import httpx

log = logging.getLogger(__name__)

URL = "https://cdn-api.cboe.com/api/data/us/options/market_statistics/symbol_reference/cone-underlying.csv"
TTL = 12 * 3600                 # seconds between fetches after a success
RETRY = 15 * 60                 # after a failure, try again in 15 min (serving the last good list meanwhile)
KINDS = {"equity", "etf"}

# The launch list (Cboe press release, Oct 19, 2026), used only until the first successful fetch.
LAUNCH_LIST = [
    "AAPL", "AMD", "AMZN", "AVGO", "BABA", "BAC", "F", "GLD", "GOOG", "GOOGL", "HOOD", "INTC", "IWM", "META", "MRVL",
    "MSFT", "MU", "NFLX", "NOK", "NVDA", "ORCL", "PFE", "PLTR", "QQQ", "SNDK", "SPY", "TSLA", "TSM", "XLF",
]
LAUNCH_AS_OF = "2026-10-19T00:00:00+00:00"

_lock = threading.Lock()
_state: Dict[str, object] = {"symbols": None, "fetched_at": None, "next_try": 0.0}


def parse(text: str) -> List[str]:
    """Stock and ETF symbols marked GTH Eligible in the Underlying Reference Data CSV, sorted, test symbols dropped."""
    out = set()
    for row in csv.DictReader(io.StringIO(text)):
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
        if row.get("gth eligible", "").lower() not in ("yes", "y"):
            continue
        if row.get("symbol type", "").lower() not in KINDS:
            continue
        if "test" in row.get("company", "").lower():
            continue
        sym = row.get("symbol", "").upper()
        if sym:
            out.add(sym)
    return sorted(out)


def _fetch() -> List[str]:
    r = httpx.get(URL, timeout=30, follow_redirects=True, headers={"User-Agent": "optionflow/1.0"})
    r.raise_for_status()
    syms = parse(r.text)
    if "gth eligible" not in r.text[:2000].lower() or len(syms) < 5:
        raise ValueError(f"unexpected file layout ({len(syms)} symbols)")    # layout changed: keep the last good list
    return syms


def extended_hours(now: Optional[float] = None) -> Dict[str, object]:
    """{"symbols", "as_of", "live"}: live = read from Cboe's file (False = the built-in launch list)."""
    now = time.time() if now is None else now
    with _lock:
        if now >= float(_state["next_try"]):  # type: ignore[arg-type]
            try:
                syms = _fetch()
                _state.update(symbols=syms, fetched_at=datetime.now(timezone.utc).isoformat(), next_try=now + TTL)
            except Exception as e:  # network, HTTP or layout problem: serve what we have
                log.warning("Cboe extended-hours list: fetch failed (%s); serving the last good list", e)
                _state["next_try"] = now + RETRY
        syms = _state["symbols"]
        if syms:
            return {"symbols": list(syms), "as_of": _state["fetched_at"], "live": True}  # type: ignore[arg-type]
        return {"symbols": list(LAUNCH_LIST), "as_of": LAUNCH_AS_OF, "live": False}
