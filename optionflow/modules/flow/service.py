"""optionflow/modules/flow/service.py — GEX results, the cache, watched symbols and flow history.

Plain functions with no FastAPI imports: the API, the workers and the tests
all call them the same way.
"""
from __future__ import annotations

import dataclasses
import logging
import threading
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from optionflow.modules.flow import repo
from optionflow.modules.flow.gamma import GEXResult, compute_gamma_exposure
from optionflow.providers.market_data import MarketDataRateLimited

logger = logging.getLogger("optionflow.flow")

GEX_CACHE_TTL = 120     # seconds a cached GEX result is served to the API (board refetches every 60s)
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
    """Cached result if younger than `max_age` seconds, else a fresh one.

    While the data source is rate-limiting, serve the last good result marked
    `stale` (with its `as_of`); 503 only when there is nothing cached.
    """
    hit = _gex_cache.get(symbol.upper())
    if hit and (time.monotonic() - hit[0]) < max_age:
        return hit[1]
    try:
        return refresh_gex(symbol)
    except MarketDataRateLimited:
        if hit:
            return dataclasses.replace(hit[1], stale=True)
        raise


def clear_cache() -> None:
    _gex_cache.clear()
    with _snapshot_lock:
        _last_snapshot.clear()


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
        "heatmap_vex_values": result.heatmap_vex_values,
        "zero_gamma": result.zero_gamma,
        "max_call_wall": result.max_call_wall,
        "max_put_wall": result.max_put_wall,
        "max_gex_strike": result.max_gex_strike,
        "net_gex": result.net_gex,
        "net_vex": result.net_vex,
        "call_premium": result.call_premium,
        "put_premium": result.put_premium,
        "net_flow": result.net_flow,
        "total_volume": result.total_volume,
        "flow_by_expiry": result.flow_by_expiry,
        "top_flow_strikes": result.top_flow_strikes,
        "ideas": result.ideas,
        "outlook": result.outlook,
        "data_source": result.data_source,
        "error": result.error,
        "as_of": result.as_of,
        "stale": result.stale,
    }


# ── Snapshots ──────────────────────────────────────────────────────────────────
def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


_last_snapshot: Dict[str, str] = {}
_snapshot_lock = threading.Lock()


def record_snapshot(result: GEXResult) -> None:
    """Store the premium/flow totals of a GEX result, at most once per symbol per second. Never raises.
    (Concurrent refreshes — the poller and a page — used to write the same second 2–3 times; T-41.)"""
    ts = now_iso()
    sym = (result.symbol or "").upper()
    with _snapshot_lock:
        if _last_snapshot.get(sym) == ts:
            return
        _last_snapshot[sym] = ts
    traded = _traded(result)
    try:
        repo.add_snapshot(
            symbol=result.symbol,
            ts=ts,
            price=round(result.spot, 2),
            call_prem=round(result.call_premium, 0),
            put_prem=round(result.put_premium, 0),
            net_flow=round(result.net_flow, 0),
            total_prem=round(result.call_premium + result.put_premium, 0),
            volume=int(result.total_volume),
            call_traded=round(traded[0], 0) if traded else None,
            put_traded=round(traded[1], 0) if traded else None,
        )
    except Exception as exc:
        logger.error("record_snapshot failed for %s: %s", result.symbol, exc)


def _traded(result: GEXResult) -> Optional[Tuple[float, float]]:
    """Today's traded (call, put) premium after folding in this refresh (flow.traded); None outside the session,
    for a result with no chain, or on any error."""
    if result.error or not result.contracts:
        return None
    try:
        from optionflow.modules.flow import traded
        return traded.update(result.symbol, result.contracts, restore=_restore_traded)
    except Exception as exc:
        logger.error("traded premium failed for %s: %s", result.symbol, exc)
        return None


def _restore_traded(symbol: str, day) -> Optional[Tuple[float, float]]:
    from optionflow.workers.backfill import ET
    start = datetime(day.year, day.month, day.day, tzinfo=ET).astimezone(timezone.utc)
    return repo.last_traded(symbol, start.strftime("%Y-%m-%dT%H:%M:%SZ"), start.strftime("%Y-%m-%dT%H:%M:%S+00:00"))


def _parse_ts(ts: str) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except ValueError:
        return None


def drop_estimates_where_live(rows: List[tuple]) -> List[tuple]:
    """Drop backfill estimates (workers.backfill) on any US-Eastern day that has live snapshots.

    Backfill rows sit on bar boundaries (second 0); live snapshots carry the poll's own second. A day with any
    live row shows only live rows, so the two series never interleave (T-41: NVDA's 00:00 ET daily-bar estimate,
    ~$29B calls, became 11-09's "since start" baseline against live totals of ~$3.9B). A live row that happens to
    land on second 0 of such a day is dropped too, which costs one point."""
    from optionflow.workers.backfill import ET, is_bar_boundary
    live_days = set()
    for row in rows:
        t = _parse_ts(row[0])
        if t is not None and not is_bar_boundary(t):
            live_days.add(t.astimezone(ET).date())
    if not live_days:
        return rows
    out = []
    for row in rows:
        t = _parse_ts(row[0])
        if t is not None and is_bar_boundary(t) and t.astimezone(ET).date() in live_days:
            continue
        out.append(row)
    return out


def net_flow_history(symbol: str, days: int = 1, bucket_minutes: int = 0) -> List[Dict[str, Any]]:
    """Snapshots for the last `days` (1–30), optionally bucketed by N minutes (last value wins)."""
    days = max(1, min(days, 30))
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    rows = repo.list_since(
        symbol.upper(),
        cutoff.strftime("%Y-%m-%dT%H:%M:%SZ"),
        cutoff.strftime("%Y-%m-%dT%H:%M:%S+00:00"),
    )
    rows = drop_estimates_where_live(rows)
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
                **_traded_fields(last[7], last[8]),
            })
        return out
    return [
        {"ts": ts, "price": price, "call_prem": cp, "put_prem": pp,
         "net_flow": nf, "total_prem": tp, "volume": vol, **_traded_fields(ct, pt)}
        for ts, price, cp, pp, nf, tp, vol, ct, pt in rows
    ]


def _traded_fields(ct, pt) -> Dict[str, Any]:
    net = ct - pt if ct is not None and pt is not None else None
    return {"call_traded": ct, "put_traded": pt, "net_traded": net}


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
