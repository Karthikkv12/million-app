"""logic/catalyst.py — upcoming catalysts and context for one stock.

Pulls from Yahoo Finance (via yfinance): earnings date and estimates,
dividends, earnings history, analyst actions and targets, volume and short
interest, 52-week range, headlines, and the options-implied move into the
next earnings. Every section is fetched independently, so one failing source
only blanks that section. Results are cached per symbol for 10 minutes.

Pure helpers (expected_move, build_signals, days_until) take plain values so
they can be unit-tested without network access.
"""
from __future__ import annotations

import logging
import math
import threading
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from cachetools import TTLCache

logger = logging.getLogger("optionflow.catalyst")

_cache: TTLCache = TTLCache(maxsize=256, ttl=600)
_lock = threading.Lock()


# ── Pure helpers ──────────────────────────────────────────────────────────────

def _f(v: Any) -> Optional[float]:
    """Float or None (drops NaN/inf/non-numeric)."""
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def days_until(d: Optional[date], today: Optional[date] = None) -> Optional[int]:
    if d is None:
        return None
    today = today or datetime.now(timezone.utc).date()
    return (d - today).days


def expected_move(spot: Optional[float], call_mid: Optional[float], put_mid: Optional[float]) -> Optional[Dict[str, float]]:
    """ATM straddle as the options-implied move: price and % of spot."""
    spot, c, p = _f(spot), _f(call_mid), _f(put_mid)
    if not spot or c is None or p is None or c < 0 or p < 0:
        return None
    straddle = c + p
    return {"dollars": round(straddle, 2), "pct": round(straddle / spot * 100, 2),
            "low": round(spot - straddle, 2), "high": round(spot + straddle, 2)}


def _mid(row: Any) -> Optional[float]:
    bid, ask, last = _f(row.get("bid")), _f(row.get("ask")), _f(row.get("lastPrice"))
    if bid and ask and ask >= bid:
        return (bid + ask) / 2
    return last


def build_signals(c: Dict[str, Any]) -> List[Dict[str, str]]:
    """Plain-language flags from a catalysts payload. Tone: good / bad / warn / neutral."""
    out: List[Dict[str, str]] = []
    e = c.get("earnings") or {}
    du = e.get("days_until")
    if du is not None and 0 <= du <= 14:
        out.append({"label": "Earnings today" if du == 0 else f"Earnings in {du} day{'s' if du != 1 else ''}", "tone": "warn"})
    em = c.get("expected_move") or {}
    if em.get("pct") is not None and em["pct"] >= 8:
        out.append({"label": f"Options price a ±{em['pct']:.1f}% move", "tone": "warn"})
    vol = c.get("volume") or {}
    rv = vol.get("relative")
    if rv is not None and rv >= 1.8:
        out.append({"label": f"Volume {rv:.1f}× average", "tone": "warn"})
    sp = vol.get("short_pct_float")
    if sp is not None and sp >= 10:
        out.append({"label": f"Short interest {sp:.1f}% of float", "tone": "bad"})
    rng = c.get("range") or {}
    pos = rng.get("position_pct")
    if pos is not None:
        if pos >= 97:
            out.append({"label": "At a 52-week high", "tone": "good"})
        elif pos <= 3:
            out.append({"label": "At a 52-week low", "tone": "bad"})
    actions = (c.get("analysts") or {}).get("actions") or []
    ups = sum(1 for a in actions if a.get("action") == "up")
    downs = sum(1 for a in actions if a.get("action") == "down")
    if ups:
        out.append({"label": f"{ups} upgrade{'s' if ups > 1 else ''} in 30 days", "tone": "good"})
    if downs:
        out.append({"label": f"{downs} downgrade{'s' if downs > 1 else ''} in 30 days", "tone": "bad"})
    div = c.get("dividend") or {}
    ddu = div.get("ex_days_until")
    if ddu is not None and 0 <= ddu <= 14:
        out.append({"label": f"Ex-dividend in {ddu} day{'s' if ddu != 1 else ''}", "tone": "neutral"})
    hist = c.get("earnings_history") or []
    beats = [h for h in hist if h.get("surprise_pct") is not None]
    if len(beats) >= 4 and all(h["surprise_pct"] > 0 for h in beats[:4]):
        out.append({"label": "Beat EPS the last 4 quarters", "tone": "good"})
    return out


# ── Fetch ─────────────────────────────────────────────────────────────────────

def _to_date(v: Any) -> Optional[date]:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, (int, float)) and v > 0:
        return datetime.fromtimestamp(v, tz=timezone.utc).date()
    return None


def _section(name: str, fn, default=None):
    try:
        return fn()
    except Exception as exc:  # one bad source shouldn't sink the page
        logger.info("catalyst %s failed: %s", name, exc)
        return default


def _fetch(symbol: str) -> Dict[str, Any]:
    import yfinance as yf  # imported lazily so tests don't need network setup

    t = yf.Ticker(symbol)
    info: Dict[str, Any] = _section("info", lambda: t.info or {}, {}) or {}
    spot = _f(info.get("currentPrice")) or _f(info.get("regularMarketPrice"))
    prev = _f(info.get("previousClose")) or _f(info.get("regularMarketPreviousClose"))
    cal: Dict[str, Any] = _section("calendar", lambda: t.calendar or {}, {}) or {}

    # Earnings
    e_dates = cal.get("Earnings Date") or []
    e_date = _to_date(e_dates[0]) if e_dates else _to_date(info.get("earningsTimestamp"))
    timing = None
    ets = info.get("earningsTimestamp")
    if ets:
        h = datetime.fromtimestamp(ets, tz=timezone.utc).hour  # UTC; US market 13:30-20:00
        timing = "before open" if h < 14 else ("after close" if h >= 20 else "during market")
    earnings = {
        "date": e_date.isoformat() if e_date else None,
        "days_until": days_until(e_date),
        "timing": timing,
        "eps_avg": _f(cal.get("Earnings Average")), "eps_low": _f(cal.get("Earnings Low")), "eps_high": _f(cal.get("Earnings High")),
        "revenue_avg": _f(cal.get("Revenue Average")), "revenue_low": _f(cal.get("Revenue Low")), "revenue_high": _f(cal.get("Revenue High")),
    }

    # Dividend
    ex_d = _to_date(cal.get("Ex-Dividend Date")) or _to_date(info.get("exDividendDate"))
    pay_d = _to_date(cal.get("Dividend Date"))
    dividend = {
        "ex_date": ex_d.isoformat() if ex_d and (days_until(ex_d) or 0) >= 0 else None,
        "ex_days_until": days_until(ex_d) if ex_d and (days_until(ex_d) or 0) >= 0 else None,
        "pay_date": pay_d.isoformat() if pay_d and (days_until(pay_d) or 0) >= 0 else None,
        "rate": _f(info.get("dividendRate")),
        # dividendYield's unit has changed across Yahoo versions; derive it instead
        "yield_pct": round(_f(info.get("dividendRate")) / spot * 100, 2) if spot and _f(info.get("dividendRate")) else None,
    }

    # Earnings history
    def _hist():
        df = t.get_earnings_dates(limit=8)
        rows = []
        for ts, r in df.iterrows():
            rep = _f(r.get("Reported EPS"))
            if rep is None:
                continue
            rows.append({"date": ts.date().isoformat(), "estimate": _f(r.get("EPS Estimate")), "reported": rep,
                         "surprise_pct": _f(r.get("Surprise(%)"))})
        return rows[:4]
    earnings_history = _section("earnings_history", _hist, []) or []

    # Expected move: first expiry on/after earnings (within 60 days), else nearest
    def _em():
        exps = list(t.options or [])
        if not exps or not spot:
            return None
        chosen = exps[0]
        if e_date and 0 <= (earnings["days_until"] or -1) <= 60:
            later = [x for x in exps if date.fromisoformat(x) >= e_date]
            if later:
                chosen = later[0]
        ch = t.option_chain(chosen)
        calls, puts = ch.calls, ch.puts
        k = min(calls["strike"], key=lambda s: abs(s - spot))
        c_row = calls[calls["strike"] == k].iloc[0]
        p_rows = puts[puts["strike"] == k]
        if p_rows.empty:
            return None
        m = expected_move(spot, _mid(c_row), _mid(p_rows.iloc[0]))
        if m:
            m.update({"expiry": chosen, "strike": float(k), "covers_earnings": bool(e_date and date.fromisoformat(chosen) >= e_date)})
        return m
    em = _section("expected_move", _em)

    # Analysts
    def _actions():
        df = t.upgrades_downgrades
        if df is None or df.empty:
            return []
        cutoff = datetime.now() - __import__("datetime").timedelta(days=30)
        rows = []
        for ts, r in df.iterrows():
            when = ts.to_pydatetime().replace(tzinfo=None) if hasattr(ts, "to_pydatetime") else ts
            if when < cutoff:
                continue
            raw = str(r.get("Action") or "").lower()
            action = {"up": "up", "down": "down", "init": "init", "main": "main", "reit": "main"}.get(raw, raw or "main")
            rows.append({"date": when.date().isoformat(), "firm": r.get("Firm"), "action": action,
                         "from": r.get("FromGrade") or None, "to": r.get("ToGrade") or None,
                         "target": _f(r.get("currentPriceTarget")), "prior_target": _f(r.get("priorPriceTarget"))})
        return rows[:12]
    def _consensus():
        df = t.recommendations
        if df is None or df.empty:
            return None
        r = df.iloc[0]
        return {k: int(r.get(k, 0) or 0) for k in ["strongBuy", "buy", "hold", "sell", "strongSell"]}
    targets = _section("targets", lambda: t.analyst_price_targets or {}, {}) or {}
    analysts = {
        "rating": info.get("recommendationKey"),
        "consensus": _section("consensus", _consensus),
        "targets": {k: _f(targets.get(k)) for k in ["low", "mean", "median", "high"]},
        "upside_pct": round((_f(targets.get("mean")) / spot - 1) * 100, 1) if spot and _f(targets.get("mean")) else None,
        "actions": _section("actions", _actions, []) or [],
    }

    # Volume / positioning / range
    vol_today, vol_avg = _f(info.get("regularMarketVolume")), _f(info.get("averageVolume"))
    short = _f(info.get("shortPercentOfFloat"))
    volume = {
        "today": vol_today, "average": vol_avg,
        "relative": round(vol_today / vol_avg, 2) if vol_today and vol_avg else None,
        "short_pct_float": round(short * 100, 2) if short is not None and short < 1 else short,
        "short_ratio": _f(info.get("shortRatio")),
        "beta": _f(info.get("beta")),
    }
    hi, lo = _f(info.get("fiftyTwoWeekHigh")), _f(info.get("fiftyTwoWeekLow"))
    rng = {"high": hi, "low": lo,
           "position_pct": round((spot - lo) / (hi - lo) * 100, 1) if spot and hi and lo and hi > lo else None}

    # News
    def _news():
        out = []
        for n in (t.news or [])[:10]:
            c = n.get("content") or n
            url = (c.get("canonicalUrl") or {}).get("url") if isinstance(c.get("canonicalUrl"), dict) else c.get("link")
            out.append({"title": c.get("title"), "publisher": (c.get("provider") or {}).get("displayName") if isinstance(c.get("provider"), dict) else c.get("publisher"),
                        "url": url, "published": c.get("pubDate") or c.get("providerPublishTime")})
        return [x for x in out if x["title"]][:8]
    news = _section("news", _news, []) or []

    payload = {
        "symbol": symbol,
        "name": info.get("shortName") or info.get("longName") or symbol,
        "price": spot,
        "change_pct": round((spot / prev - 1) * 100, 2) if spot and prev else None,
        "earnings": earnings,
        "dividend": dividend,
        "expected_move": em,
        "earnings_history": earnings_history,
        "analysts": analysts,
        "volume": volume,
        "range": rng,
        "news": news,
        "as_of": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "Yahoo Finance (delayed)",
    }
    payload["signals"] = build_signals(payload)
    return payload


def get_catalysts(symbol: str) -> Dict[str, Any]:
    sym = symbol.strip().upper()
    if not sym or len(sym) > 12:
        raise ValueError("invalid symbol")
    with _lock:
        hit = _cache.get(sym)
    if hit is not None:
        return hit
    data = _fetch(sym)
    if data.get("price") is None and not data.get("news"):
        raise LookupError(f"No data for {sym}")
    with _lock:
        _cache[sym] = data
    return data
