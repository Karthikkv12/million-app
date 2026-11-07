"""optionflow/modules/flow/service.py — GEX results, the cache, watched symbols and flow history.

Plain functions with no FastAPI imports: the API, the workers and the tests
all call them the same way.
"""
from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from optionflow.modules.flow import repo
from optionflow.modules.flow.gamma import GEXResult, compute_gamma_exposure

logger = logging.getLogger("optionflow.flow")

GEX_CACHE_TTL = 10      # seconds a cached GEX result is served to the API
WATCH_TTL = 120         # seconds a symbol stays watched after the last heartbeat

_gex_cache: Dict[str, Tuple[float, GEXResult]] = {}
_watched_ttl: Dict[str, float] = {}
_watched_lock = threading.Lock()


# ── GEX + cache ────────────────────────────────────────────────────────────────
def cached_gex(symbol: str) -> Optional[GEXResult]:
    """The cached result for `symbol` regardless of age, or None."""
    hit = _gex_cache.get(symbol.upper())
    return hit[1] if hit else None


def compute_and_cache(symbol: str) -> GEXResult:
    """Compute GEX now and cache it (no snapshot)."""
    result = compute_gamma_exposure(symbol)
    _gex_cache[symbol.upper()] = (time.monotonic(), result)
    return result


def refresh_gex(symbol: str) -> GEXResult:
    """Compute GEX now, cache it, and record a flow snapshot."""
    result = compute_and_cache(symbol)
    record_snapshot(result)
    return result


def get_gex(symbol: str, max_age: float = GEX_CACHE_TTL) -> GEXResult:
    """Cached result if younger than `max_age` seconds, else a fresh one."""
    hit = _gex_cache.get(symbol.upper())
    if hit and (time.monotonic() - hit[0]) < max_age:
        return hit[1]
    return refresh_gex(symbol)


def clear_cache() -> None:
    _gex_cache.clear()


def gex_payload(result: GEXResult) -> Dict[str, Any]:
    """The JSON shape the flow board expects."""
    return {
        "symbol": result.symbol, "spot": result.spot,
        "expiries": result.expiries, "strikes": result.strikes,
        "gex_by_strike": result.gex_by_strike,
        "call_gex_by_strike": result.call_gex_by_strike,
        "put_gex_by_strike": result.put_gex_by_strike,
        "heatmap_expiries": result.heatmap_expiries,
        "heatmap_strikes": result.heatmap_strikes,
        "heatmap_values": result.heatmap_values,
        "zero_gamma": result.zero_gamma,
        "max_call_wall": result.max_call_wall,
        "max_put_wall": result.max_put_wall,
        "max_gex_strike": result.max_gex_strike,
        "net_gex": result.net_gex,
        "call_premium": result.call_premium,
        "put_premium": result.put_premium,
        "net_flow": result.net_flow,
        "total_volume": result.total_volume,
        "flow_by_expiry": result.flow_by_expiry,
        "top_flow_strikes": result.top_flow_strikes,
        "data_source": result.data_source,
        "error": result.error,
    }


# ── Snapshots ──────────────────────────────────────────────────────────────────
def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def record_snapshot(result: GEXResult) -> None:
    """Store the premium/flow totals of a GEX result. Never raises."""
    try:
        repo.add_snapshot(
            symbol=result.symbol,
            ts=now_iso(),
            price=round(result.spot, 2),
            call_prem=round(result.call_premium, 0),
            put_prem=round(result.put_premium, 0),
            net_flow=round(result.net_flow, 0),
            total_prem=round(result.call_premium + result.put_premium, 0),
            volume=int(result.total_volume),
        )
    except Exception as exc:
        logger.error("record_snapshot failed for %s: %s", result.symbol, exc)


def net_flow_history(symbol: str, days: int = 1, bucket_minutes: int = 0) -> List[Dict[str, Any]]:
    """Snapshots for the last `days` (1–30), optionally bucketed by N minutes (last value wins)."""
    days = max(1, min(days, 30))
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    rows = repo.list_since(
        symbol.upper(),
        cutoff.strftime("%Y-%m-%dT%H:%M:%SZ"),
        cutoff.strftime("%Y-%m-%dT%H:%M:%S+00:00"),
    )
    if not rows:
        return []
    if bucket_minutes and bucket_minutes > 0:
        size = bucket_minutes * 60
        buckets: Dict[int, list] = defaultdict(list)
        for row in rows:
            try:
                epoch = int(datetime.fromisoformat(row[0].replace("Z", "+00:00")).timestamp())
                buckets[(epoch // size) * size].append(row)
            except Exception:
                continue
        out = []
        for key in sorted(buckets):
            group = buckets[key]
            last = group[-1]
            out.append({
                "ts": datetime.fromtimestamp(key, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "price": last[1], "call_prem": last[2], "put_prem": last[3],
                "net_flow": last[4], "total_prem": last[5],
                "volume": sum(r[6] or 0 for r in group),
            })
        return out
    return [
        {"ts": ts, "price": price, "call_prem": cp, "put_prem": pp,
         "net_flow": nf, "total_prem": tp, "volume": vol}
        for ts, price, cp, pp, nf, tp, vol in rows
    ]


# ── Watched symbols (heartbeat from open flow boards) ─────────────────────────
def watch(symbols: List[str]) -> List[str]:
    """Mark symbols as watched now; returns the ones that weren't watched before."""
    now = time.monotonic()
    new: List[str] = []
    with _watched_lock:
        for s in (x.strip().upper() for x in symbols if x and x.strip()):
            if s not in _watched_ttl:
                new.append(s)
            _watched_ttl[s] = now
    return new


def active_symbols() -> List[str]:
    """Watched symbols, dropping any without a heartbeat for WATCH_TTL seconds."""
    now = time.monotonic()
    with _watched_lock:
        for s in [s for s, t in _watched_ttl.items() if now - t > WATCH_TTL]:
            del _watched_ttl[s]
        return list(_watched_ttl)
