"""optionflow/workers/backfill.py — fill net-flow history for a newly watched symbol.

Real premium snapshots only exist from the moment someone watches a symbol.
To give the flow chart history right away, this estimates past snapshots from
price bars: bar volume × average premium per contract, split by today's
call/put premium ratio. Each (symbol, days) range runs at most once per day.

Estimates are cumulative within each US-Eastern day, like live snapshots (day totals so far), and today's
still-forming daily bar is not written. Where a day has live snapshots, flow.service hides the estimates (T-41).
"""
from __future__ import annotations

import logging
import re
import threading
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from optionflow.modules.flow import repo, service
from optionflow.providers.market_data import get_market_data

logger = logging.getLogger("optionflow.backfill")

# history range (days) → bar interval
RANGE_INTERVAL: dict[int, str] = {1: "1m", 2: "5m", 3: "5m", 7: "30m", 14: "30m", 30: "1d"}
_RANGE_PERIOD: dict[int, str] = {1: "1d", 2: "2d", 3: "5d", 7: "5d", 14: "1mo", 30: "1mo"}

ET = ZoneInfo("America/New_York")

_done: set[tuple[str, int]] = set()


def is_bar_boundary(ts: datetime) -> bool:
    """Backfill rows sit on bar boundaries (second 0); live snapshots carry the poll's own second."""
    return ts.second == 0 and ts.microsecond == 0
_lock = threading.Lock()


def reset_daily() -> None:
    """Allow every range to backfill again (called once per UTC day)."""
    with _lock:
        _done.clear()


def start_backfill(symbol: str) -> None:
    """Backfill every history range for `symbol` in background threads."""
    for days in RANGE_INTERVAL:
        threading.Thread(
            target=backfill_history, args=(symbol, days), daemon=True,
            name=f"backfill-{symbol}-{days}d",
        ).start()


def _iso_z(ts) -> str:
    s = ts.isoformat(timespec="seconds").replace(" ", "T")
    s = re.sub(r"[+-]00:?00$", "Z", s)
    if not s.endswith("Z") and "+" not in s and s.count("-") == 2:
        s += "Z"
    return s


def backfill_history(symbol: str, days: int) -> None:
    key = (symbol, days)
    with _lock:
        if key in _done:
            return
        _done.add(key)
    try:
        bars = get_market_data().price_history(
            symbol,
            period=_RANGE_PERIOD.get(days, f"{days}d"),
            interval=RANGE_INTERVAL.get(days, "5m"),
        )
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        bars = bars[bars.index >= cutoff] if not bars.empty else bars
        if bars.empty:
            return

        call_ratio, put_ratio, prem_per_share = 0.55, 0.45, 0.5
        try:
            result = service.cached_gex(symbol) or service.compute_and_cache(symbol)
            total = (result.call_premium or 0) + (result.put_premium or 0)
            if total > 0:
                call_ratio = result.call_premium / total
                put_ratio = result.put_premium / total
            prem_per_share = total / max(result.total_volume or 1, 1)
        except Exception:
            pass

        existing = repo.existing_timestamps(symbol, cutoff.strftime("%Y-%m-%dT%H:%M:%SZ"))
        rows = estimate_rows(symbol, bars, RANGE_INTERVAL.get(days, "5m"), call_ratio, put_ratio,
                             prem_per_share, existing)
        repo.add_snapshots(rows)
    except Exception as exc:
        logger.error("backfill_history %s %dd failed: %s", symbol, days, exc)
        with _lock:
            _done.discard(key)


def estimate_rows(symbol: str, bars, interval: str, call_ratio: float, put_ratio: float,
                  prem_per_share: float, existing: set, now: datetime | None = None) -> list[dict]:
    """Estimated snapshots from price bars, cumulative within each US-Eastern day (like live snapshots).
    Today's daily bar is still forming, so it is skipped."""
    today = (now or datetime.now(timezone.utc)).astimezone(ET).date()
    rows: list[dict] = []
    day, run_vol, run_total = None, 0, 0.0
    for ts, bar in bars.iterrows():
        price = float(bar.get("close", 0) or 0)
        volume = int(bar.get("volume", 0) or 0)
        if price <= 0:
            continue
        et_day = ts.tz_convert(ET).date() if getattr(ts, "tzinfo", None) else ts.date()
        if interval == "1d" and et_day >= today:
            continue
        if et_day != day:
            day, run_vol, run_total = et_day, 0, 0.0
        run_vol += volume
        run_total += volume * prem_per_share
        ts_str = _iso_z(ts)
        if ts_str in existing:
            continue
        cp = round(run_total * call_ratio, 0)
        pp = round(run_total * put_ratio, 0)
        rows.append({
            "symbol": symbol, "ts": ts_str, "price": round(price, 2),
            "call_prem": cp, "put_prem": pp, "net_flow": round(cp - pp, 0),
            "total_prem": round(run_total, 0), "volume": run_vol,
        })
    return rows
