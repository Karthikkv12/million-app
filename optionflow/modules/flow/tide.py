"""optionflow/modules/flow/tide.py — net premium leaders and market tide across the watched universe (C-98).

Both read the net-flow snapshots the GEX poller already writes (one per refresh of a watched symbol): chain-snapshot
premium (volume × price per contract, the same measure as /options/gamma-exposure), not a trade tape.

Baseline rule (as net-flow-history / FlowMomentumChart): per symbol and US-Eastern session day, premium is counted
from the first snapshot at or after 09:30 ET; earlier snapshots still carry the previous session's chain and are left
out, and so are snapshots after the close (CLOSE_MIN). The measure is Σ volume × current price, so a total can fall
during the day (option prices drop); deltas are signed, not clamped. Backfill estimates are dropped on days with live snapshots (service.drop_estimates_where_live).
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from optionflow.modules.flow import repo
from optionflow.modules.flow.service import _parse_ts, drop_estimates_where_live
from optionflow.workers.backfill import ET

OPEN_MIN = 9 * 60 + 30
CLOSE_MIN = 16 * 60 + 5          # a refresh just after the bell still counts; later ones see a changed chain
                                 # (expired 0DTE drops out: NVDA's call total jumped $4.2B → $6.1B at 21:00 ET, 11-11)
UNIVERSES = {"default"}           # every symbol with snapshots in the session (what the poller has watched)

# (ts, price, call_prem, put_prem)
_Row = Tuple[datetime, Optional[float], float, float]


def _sessions(days: int) -> Dict[str, Dict[date, List[_Row]]]:
    """{symbol: {ET day: rows from the 09:30 ET open on, oldest first}} for the last `days` session days."""
    days = max(1, min(days, 30))
    cutoff = datetime.now(timezone.utc) - timedelta(days=days + 3)     # weekends / holidays: trim to `days` below
    raw = repo.list_all_since(cutoff.strftime("%Y-%m-%dT%H:%M:%SZ"), cutoff.strftime("%Y-%m-%dT%H:%M:%S+00:00"))
    by_sym: Dict[str, List[tuple]] = defaultdict(list)
    for sym, *rest in raw:
        by_sym[(sym or "").upper()].append(tuple(rest))
    out: Dict[str, Dict[date, List[_Row]]] = {}
    all_days = set()
    for sym, rows in by_sym.items():
        per_day: Dict[date, List[_Row]] = defaultdict(list)
        for ts, price, cp, pp, *_ in drop_estimates_where_live(rows):
            t = _parse_ts(ts)
            if t is None or cp is None or pp is None:
                continue
            if t.tzinfo is None:
                t = t.replace(tzinfo=timezone.utc)
            et = t.astimezone(ET)
            if not OPEN_MIN <= et.hour * 60 + et.minute <= CLOSE_MIN or et.weekday() >= 5:
                continue
            per_day[et.date()].append((t, price, float(cp), float(pp)))
        per_day = {d: _consistent(sorted(r, key=lambda x: x[0])) for d, r in per_day.items()}
        per_day = {d: r for d, r in per_day.items() if r}
        if per_day:
            out[sym] = per_day
            all_days.update(per_day)
    keep = set(sorted(all_days)[-days:])
    return {s: {d: r for d, r in dd.items() if d in keep} for s, dd in out.items() if any(d in keep for d in dd)}


MIX_RATIO = 3.0


def _consistent(rows: List[_Row]) -> List[_Row]:
    """Drop snapshots from a different chain source than most of the day's. A symbol's live snapshots can switch
    between Public (12 expiries) and Yahoo (every expiry, ~15× the premium): MU on 11-11 read $77B at 16:00:31 and
    $4.9B two seconds later. Snapshots are seconds apart and premium builds gradually, so a > MIX_RATIO× jump between
    neighbours is a source switch; each switch toggles the source, and the source with the most rows is kept."""
    if len(rows) < 2:
        return rows
    side, sides = 0, [0]
    for prev, cur in zip(rows, rows[1:]):
        a, b = prev[2] + prev[3], cur[2] + cur[3]
        if a > 0 and b > 0 and max(a, b) / min(a, b) > MIX_RATIO:
            side ^= 1
        sides.append(side)
    keep = 0 if sides.count(0) >= sides.count(1) else 1
    return [r for r, sd in zip(rows, sides) if sd == keep]


def _delta(rows: List[_Row]) -> Tuple[float, float]:
    """(call, put) premium added since the session's baseline row."""
    base, last = rows[0], rows[-1]
    return last[2] - base[2], last[3] - base[3]


def leaders(universe: str = "default", limit: int = 10) -> Dict[str, Any]:
    """Top `limit` bullish and bearish symbols by net premium (calls − puts) added since today's open,
    in the latest session that has snapshots."""
    limit = max(1, min(limit, 50))
    data = _sessions(1)
    day = max((d for dd in data.values() for d in dd), default=None)
    rows: List[Dict[str, Any]] = []
    as_of: Optional[datetime] = None
    for sym, dd in data.items():
        r = dd.get(day)
        if not r:
            continue
        call, put = _delta(r)
        as_of = max(as_of, r[-1][0]) if as_of else r[-1][0]
        rows.append({"symbol": sym, "net": round(call - put), "call_prem": round(call), "put_prem": round(put),
                     "spot": r[-1][1], "change_pct": None})
    _add_change_pct(rows)
    bull = sorted((x for x in rows if x["net"] > 0), key=lambda x: -x["net"])[:limit]
    bear = sorted((x for x in rows if x["net"] < 0), key=lambda x: x["net"])[:limit]
    return {"session": day.isoformat() if day else None,
            "as_of": as_of.strftime("%Y-%m-%dT%H:%M:%SZ") if as_of else None,
            "universe": universe, "symbols": len(rows), "bullish": bull, "bearish": bear}


def _add_change_pct(rows: List[Dict[str, Any]]) -> None:
    """Day change % from real-time quotes when the provider has them (Public.com); left None otherwise."""
    from optionflow.providers.market_data import get_market_data
    fn = getattr(get_market_data(), "quotes_batch", None)
    if not callable(fn) or not rows:
        return
    try:
        q = fn([r["symbol"] for r in rows]) or {}
    except Exception:
        return
    for r in rows:
        r["change_pct"] = (q.get(r["symbol"]) or {}).get("change_pct")


def tide(days: int = 1, bucket_minutes: int = 5) -> List[Dict[str, Any]]:
    """Summed premium added since each session's open across the universe, on a `bucket_minutes` grid:
    [{ts, net, call_prem, put_prem, spy, symbols}]. Each symbol's last value carries forward until its next
    snapshot; the sum resets at each session's open. `spy` is SPY's price at that point (None until SPY has one)."""
    size = max(1, min(bucket_minutes, 60)) * 60
    data = _sessions(days)
    # per (day, bucket): {symbol: (call, put)} last value in that bucket, and SPY price
    grid: Dict[date, Dict[int, Dict[str, Tuple[float, float]]]] = defaultdict(lambda: defaultdict(dict))
    spy: Dict[int, float] = {}
    for sym, dd in data.items():
        for day, rows in dd.items():
            base_c, base_p = rows[0][2], rows[0][3]
            for t, price, cp, pp in rows:
                b = int(t.timestamp()) // size * size
                grid[day][b][sym] = (cp - base_c, pp - base_p)
                if sym == "SPY" and price is not None:
                    spy[b] = price
    out: List[Dict[str, Any]] = []
    for day in sorted(grid):
        carry: Dict[str, Tuple[float, float]] = {}
        last_spy: Optional[float] = None
        for b in sorted(grid[day]):
            carry.update(grid[day][b])
            last_spy = spy.get(b, last_spy)
            call = sum(c for c, _ in carry.values())
            put = sum(p for _, p in carry.values())
            out.append({"ts": datetime.fromtimestamp(b, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                        "net": round(call - put), "call_prem": round(call), "put_prem": round(put),
                        "spy": last_spy, "symbols": len(carry)})
    return out
