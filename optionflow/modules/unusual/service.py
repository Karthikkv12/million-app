"""logic/unusual.py — unusual options activity from Yahoo option chains.

Yahoo gives end-of-snapshot chains (≈15 min delayed), not a trade tape, so
"unusual" here means a contract whose *day volume* is large relative to its
*open interest* and whose premium traded is large. That catches fresh
positioning (new contracts opened today) without claiming to see individual
sweeps or blocks, which need a real-time feed.

For each contract we keep: volume, open interest, vol/OI, premium
(volume × mid × 100), moneyness, days to expiry, implied volatility, and a
side estimate from where the last trade printed inside the bid/ask.

Pure helpers (classify_side, score, is_unusual) are unit-tested; the fetch
runs per symbol in a small thread pool and is cached for 5 minutes.
"""
from __future__ import annotations

import logging
import math
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from cachetools import TTLCache

logger = logging.getLogger("optionflow.unusual")

DEFAULT_UNIVERSE = [
    "SPY", "QQQ", "IWM", "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA",
    "AMD", "NFLX", "AVGO", "PLTR", "COIN", "MSTR", "SMCI", "UBER", "BA", "JPM",
]
MAX_EXPIRIES = 4        # nearest expiries scanned per symbol
MAX_DTE = 60

_cache: TTLCache = TTLCache(maxsize=128, ttl=300)
_lock = threading.Lock()


def _f(v: Any) -> Optional[float]:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


# ── Pure helpers ──────────────────────────────────────────────────────────────

def classify_side(last: Optional[float], bid: Optional[float], ask: Optional[float]) -> str:
    """Where the last print sat in the spread: 'ask' (buyer-initiated), 'bid', or 'mid'."""
    last, bid, ask = _f(last), _f(bid), _f(ask)
    if last is None or bid is None or ask is None or ask <= 0 or ask < bid:
        return "unknown"
    spread = ask - bid
    if spread <= 0:
        return "mid"
    pos = (last - bid) / spread
    if pos >= 0.8:
        return "ask"
    if pos <= 0.2:
        return "bid"
    return "mid"


def is_unusual(volume: float, oi: float, premium: float, *, min_premium: float, min_volume: int = 250, min_ratio: float = 1.2) -> bool:
    if volume < min_volume or premium < min_premium:
        return False
    if oi <= 0:
        return volume >= 2 * min_volume
    return volume / oi >= min_ratio


def score(vol_oi: Optional[float], premium: float, otm_pct: float, dte: int) -> float:
    """0–1 'how notable' score: fresh size (vol/OI), money at stake, short-dated OTM."""
    r = min((vol_oi if vol_oi is not None else 5.0) / 5.0, 1.0)            # 5x OI or more = max
    p = min(math.log10(max(premium, 1)) / 7.0, 1.0)                         # $10M = max
    otm = min(max(otm_pct, 0) / 10.0, 1.0)                                  # 10% OTM = max
    near = 1.0 if dte <= 7 else 0.6 if dte <= 21 else 0.3
    return round(0.45 * r + 0.35 * p + 0.1 * otm + 0.1 * near, 3)


# ── Fetch ─────────────────────────────────────────────────────────────────────

def _scan_symbol(sym: str, min_premium: float) -> List[Dict[str, Any]]:
    from optionflow.providers.market_data import get_market_data

    with _lock:
        hit = _cache.get((sym, min_premium))
    if hit is not None:
        return hit

    t = get_market_data().raw_ticker(sym)
    try:
        info = t.fast_info
        spot = _f(getattr(info, "last_price", None))
    except Exception:
        spot = None
    today = datetime.now(timezone.utc).date()
    rows: List[Dict[str, Any]] = []
    try:
        expiries = [e for e in (t.options or []) if 0 <= (date.fromisoformat(e) - today).days <= MAX_DTE][:MAX_EXPIRIES]
    except Exception as exc:
        logger.info("unusual %s: no expiries (%s)", sym, exc)
        expiries = []

    for exp in expiries:
        try:
            ch = t.option_chain(exp)
        except Exception as exc:
            logger.info("unusual %s %s: chain failed (%s)", sym, exp, exc)
            continue
        dte = (date.fromisoformat(exp) - today).days
        for kind, df in (("call", ch.calls), ("put", ch.puts)):
            for r in df.to_dict("records"):
                vol, oi = _f(r.get("volume")) or 0.0, _f(r.get("openInterest")) or 0.0
                bid, ask, last = _f(r.get("bid")), _f(r.get("ask")), _f(r.get("lastPrice"))
                mid = (bid + ask) / 2 if bid and ask and ask >= bid else last
                if not mid or vol <= 0:
                    continue
                premium = vol * mid * 100
                if not is_unusual(vol, oi, premium, min_premium=min_premium):
                    continue
                strike = float(r["strike"])
                otm = None
                if spot:
                    otm = (strike / spot - 1) * 100 if kind == "call" else (1 - strike / spot) * 100
                vol_oi = round(vol / oi, 2) if oi > 0 else None
                rows.append({
                    "symbol": sym, "type": kind, "strike": strike, "expiry": exp, "dte": dte,
                    "spot": spot, "otm_pct": round(otm, 2) if otm is not None else None,
                    "last": last, "bid": bid, "ask": ask, "side": classify_side(last, bid, ask),
                    "volume": int(vol), "open_interest": int(oi), "vol_oi": vol_oi,
                    "iv_pct": round((_f(r.get("impliedVolatility")) or 0) * 100, 1) or None,
                    "premium": round(premium, 0),
                    "score": score(vol_oi, premium, otm or 0, dte),
                })
    with _lock:
        _cache[(sym, min_premium)] = rows
    return rows


def scan(symbols: Optional[Iterable[str]] = None, *, min_premium: float = 100_000, kind: str = "all", limit: int = 300) -> Dict[str, Any]:
    syms = [s.strip().upper() for s in (symbols or DEFAULT_UNIVERSE) if s and s.strip()][:40]
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda s: _safe(s, min_premium), syms))
    rows = [r for rs in results for r in rs]
    if kind in ("call", "put"):
        rows = [r for r in rows if r["type"] == kind]
    rows.sort(key=lambda r: (r["score"], r["premium"]), reverse=True)
    calls = sum(r["premium"] for r in rows if r["type"] == "call")
    puts = sum(r["premium"] for r in rows if r["type"] == "put")
    return {
        "rows": rows[:limit],
        "count": len(rows),
        "symbols": syms,
        "call_premium": calls,
        "put_premium": puts,
        "as_of": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "Yahoo Finance option chains (delayed); unusual = day volume ≥1.2× open interest",
    }


def _safe(sym: str, min_premium: float) -> List[Dict[str, Any]]:
    try:
        return _scan_symbol(sym, min_premium)
    except Exception as exc:
        logger.info("unusual %s failed: %s", sym, exc)
        return []
