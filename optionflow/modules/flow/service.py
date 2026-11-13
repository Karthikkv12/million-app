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
from optionflow.modules.flow import gamma
from optionflow.modules.flow.gamma import GEXResult, compute_gamma_exposure
from optionflow.providers.market_data import MarketDataRateLimited

logger = logging.getLogger("optionflow.flow")

GEX_CACHE_TTL = 120     # seconds a cached GEX result is served to the API (board refetches every 60s)
WATCH_TTL = 120         # seconds a symbol stays watched after the last heartbeat
RESPOT_MAX_CHAIN_AGE = 120   # re-price a cached chain at the live spot only while the chain is this fresh
STRIKES_EVERY = 60      # seconds between saves of the per-strike sides (flow_strike_sides) per symbol
SNAPSHOT_EVERY = 10     # seconds between stored flow snapshots per symbol (refreshes run every ~2 s on Public;
                        # traded premium is still counted on every refresh, the row just stores the running total)

_gex_cache: Dict[str, Tuple[float, GEXResult]] = {}
_watched_ttl: Dict[str, float] = {}
_watched_lock = threading.Lock()


# ── GEX + cache ────────────────────────────────────────────────────────────────
def cached_gex(symbol: str) -> Optional[GEXResult]:
    """The cached result for `symbol` regardless of age, or None."""
    hit = _gex_cache.get(symbol.upper())
    return hit[1] if hit else None


_cache_lock = threading.Lock()


def compute_and_cache(symbol: str) -> GEXResult:
    """Compute GEX now and cache it (no snapshot)."""
    result = compute_gamma_exposure(symbol)
    with _cache_lock:
        _gex_cache[symbol.upper()] = (time.monotonic(), result)
    return result


def respot(symbol: str, spot: float) -> Optional[GEXResult]:
    """Re-price `symbol`'s cached chain at a live `spot` and cache it (workers.gex_respot, every second).

    Nothing is fetched and no snapshot is stored. Skipped (None) when nothing good is cached, the chain is older
    than RESPOT_MAX_CHAIN_AGE, or the spot hasn't moved a cent. The cache keeps the full refresh's time, so
    get_gex still refetches on its own schedule; a full refresh that lands meanwhile is never overwritten.
    """
    sym = symbol.upper()
    hit = _gex_cache.get(sym)
    if hit is None or hit[1].error or not spot or spot <= 0 or round(spot, 2) == hit[1].spot:
        return None
    age = gamma.chain_age(sym)
    if age is None or age > RESPOT_MAX_CHAIN_AGE:
        return None
    result = gamma.respot_gex(sym, spot)
    if result is None or result.error:
        return None
    result = dataclasses.replace(result, stale=hit[1].stale)
    with _cache_lock:
        if _gex_cache.get(sym) is not hit:       # a full refresh landed while we computed
            return None
        _gex_cache[sym] = (hit[0], result)
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
    gamma.clear_chains()
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
    """Count this refresh's traded premium, and store the flow totals at most once per SNAPSHOT_EVERY seconds
    per symbol. Never raises. (Concurrent refreshes used to write the same second 2–3 times, T-41; refreshes
    now run every ~2 s on Public, and a row every 10 s keeps the table and the charts the size they were.)"""
    ts = now_iso()
    sym = (result.symbol or "").upper()
    traded = _traded(result)                       # every refresh: the Δvolume baseline must keep up
    if traded:
        _save_strikes(sym)
    t = _parse_ts(ts)
    with _snapshot_lock:
        prev = _last_snapshot.get(sym)
        p = _parse_ts(prev) if prev else None
        if prev == ts or (t is not None and p is not None and 0 <= (t - p).total_seconds() < SNAPSHOT_EVERY):
            return
        _last_snapshot[sym] = ts
    split = _sides(result.symbol) if traded else None
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
            **({k: round(v, 0) for k, v in zip(_SIDE_COLS, split)} if split else {}),
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
        return traded.update(result.symbol, result.contracts, restore=_restore_traded, restore_strikes=_restore_strikes)
    except Exception as exc:
        logger.error("traded premium failed for %s: %s", result.symbol, exc)
        return None


_SIDE_COLS = ("call_bought", "call_sold", "put_bought", "put_sold")


def _sides(symbol: str) -> Optional[Tuple[float, float, float, float]]:
    try:
        from optionflow.modules.flow import traded
        return traded.sides(symbol)
    except Exception as exc:
        logger.error("premium sides failed for %s: %s", symbol, exc)
        return None


def _restore_traded(symbol: str, day) -> Optional[Tuple[float, float]]:
    from optionflow.workers.backfill import ET
    start = datetime(day.year, day.month, day.day, tzinfo=ET).astimezone(timezone.utc)
    return repo.last_traded(symbol, start.strftime("%Y-%m-%dT%H:%M:%SZ"), start.strftime("%Y-%m-%dT%H:%M:%S+00:00"))


def _restore_strikes(symbol: str, day):
    hit = repo.load_strike_sides(symbol, day.isoformat())
    return hit[1] if hit else None


_last_strikes: Dict[str, float] = {}


def _save_strikes(symbol: str) -> None:
    """Persist today's per-strike sides at most once per STRIKES_EVERY seconds. Never raises."""
    sym = symbol.upper()
    now = time.monotonic()
    with _snapshot_lock:
        if now - _last_strikes.get(sym, -1e9) < STRIKES_EVERY:
            return
        _last_strikes[sym] = now
    try:
        from optionflow.modules.flow import traded
        hit = traded.strikes(sym)
        if hit and hit[1]:
            repo.save_strike_sides(sym, hit[0].isoformat(), hit[1])
    except Exception as exc:
        logger.error("saving strike sides failed for %s: %s", sym, exc)


def strike_flow(symbol: str, expiry: Optional[str] = None) -> Dict[str, Any]:
    """Today's sided premium and delta dollars by strike (live from flow.traded, else the latest saved day).

    customer Δ$ = bought − sold delta dollars, with the option's sign (calls +, puts −): > 0 means customers added
    long delta (bought calls, sold puts); dealers on the other side hedge that by buying shares.
    """
    from optionflow.modules.flow import traded
    sym = symbol.upper()
    hit = traded.strikes(sym)
    live = bool(hit and hit[1])
    if live:
        day, by = hit[0].isoformat(), hit[1]
    else:
        saved = repo.load_strike_sides(sym)
        day, by = (saved if saved else (None, {}))
    expiries = sorted({k[0] for k in by})
    rows: Dict[float, Dict[str, float]] = {}
    for (exp, strike, otype), (b, s, bdd, sdd) in by.items():
        if expiry and exp != expiry:
            continue
        r = rows.setdefault(strike, {"strike": strike, "call_bought": 0.0, "call_sold": 0.0, "put_bought": 0.0,
                                     "put_sold": 0.0, "call_delta": 0.0, "put_delta": 0.0})
        p = "call" if otype == "call" else "put"
        r[f"{p}_bought"] += b
        r[f"{p}_sold"] += s
        r[f"{p}_delta"] += bdd - sdd
    out = sorted(rows.values(), key=lambda r: r["strike"])
    for r in out:
        r["net_delta"] = r["call_delta"] + r["put_delta"]
    g = cached_gex(sym)
    ok = g is not None and not g.error
    tot = lambda k: sum(r[k] for r in out)
    return {
        "symbol": sym, "day": day, "live": live, "expiry": expiry, "expiries": expiries,
        "spot": g.spot if ok else None,
        "zero_gamma": g.zero_gamma if ok else None, "call_wall": g.max_call_wall if ok else None,
        "put_wall": g.max_put_wall if ok else None, "king": g.max_gex_strike if ok else None,
        "rows": out,
        "call_bought": tot("call_bought"), "call_sold": tot("call_sold"),
        "put_bought": tot("put_bought"), "put_sold": tot("put_sold"),
        "call_delta": tot("call_delta"), "put_delta": tot("put_delta"), "net_delta": tot("net_delta"),
    }


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
                **_traded_fields(*last[7:13]),
            })
        return out
    return [
        {"ts": ts, "price": price, "call_prem": cp, "put_prem": pp,
         "net_flow": nf, "total_prem": tp, "volume": vol, **_traded_fields(*rest)}
        for ts, price, cp, pp, nf, tp, vol, *rest in rows
    ]


def _traded_fields(ct=None, pt=None, cb=None, cs=None, pb=None, ps=None) -> Dict[str, Any]:
    """Traded totals plus their bought / sold split. NCP = calls bought − sold, NPP = puts bought − sold; the
    sentiment split counts calls bought and puts sold as bullish, calls sold and puts bought as bearish."""
    net = ct - pt if ct is not None and pt is not None else None
    have = None not in (cb, cs, pb, ps)
    return {"call_traded": ct, "put_traded": pt, "net_traded": net,
            "call_bought": cb, "call_sold": cs, "put_bought": pb, "put_sold": ps,
            "ncp": cb - cs if have else None, "npp": pb - ps if have else None}


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
