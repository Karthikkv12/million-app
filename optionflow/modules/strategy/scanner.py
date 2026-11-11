"""optionflow/modules/strategy/scanner.py — find trades for the owner's strategy across the market.

Stage 1, price screen (every symbol in the universe; daily bars cached for an hour):
  spot (one batched quote call), pullback off the 20-day high, 14-day RSI, 200-day average, day change,
  20-day realized vol (HV20) and its 1-year range. Filters: price, pullback range, RSI ≤ max, above the 200-day.
Stage 2, the chain (only stage-1 survivors, best pullbacks first, at most MAX_CHAINS per scan):
  ATM IV, IV ÷ HV20 and where IV sits in HV20's 1-year range (a stand-in for IV rank: we don't keep a
  year of IV history), liquidity on the short leg (open interest, bid/ask spread), earnings before expiry,
  then the strategy's own contract pick (strategy.engine) and its minimum yield.
Each survivor gets a 0–100 score and plain-English reasons.

The trade per strategy: a put to sell (spike wheel / wheel / cash-secured puts), a put credit spread, or for
covered calls a buy-write (100 shares + an out-of-the-money call).
"""
from __future__ import annotations

import logging
import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from cachetools import TTLCache

from optionflow.modules.hedge import bs
from optionflow.modules.hedge.suggest import Quote
from optionflow.modules.strategy import catalog, engine
from optionflow.modules.strategy.catalog import Rules

logger = logging.getLogger("optionflow.scanner")

DEFAULT_UNIVERSE = [
    # ETFs
    "SPY", "QQQ", "IWM", "DIA", "XLF", "XLE", "XLK", "XLV", "XLI", "XLY", "XLP", "XLU", "SMH", "GLD", "SLV", "TLT", "KRE", "XBI",
    # mega and large caps
    "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "AVGO", "BRK.B", "JPM", "V", "MA", "UNH", "XOM", "CVX", "LLY",
    "JNJ", "PG", "HD", "COST", "WMT", "KO", "PEP", "MRK", "ABBV", "BAC", "WFC", "C", "GS", "MS", "SCHW", "AXP", "BLK",
    "ORCL", "CRM", "ADBE", "AMD", "INTC", "QCOM", "TXN", "MU", "AMAT", "LRCX", "KLAC", "ANET", "PANW", "CRWD", "NOW",
    "SNOW", "NFLX", "DIS", "CMCSA", "T", "VZ", "TMUS", "NKE", "SBUX", "MCD", "CMG", "LOW", "TGT", "BKNG", "ABNB", "UBER",
    "PYPL", "SQ", "SHOP", "COIN", "HOOD", "PLTR", "MSTR", "SMCI", "ARM", "DELL", "IBM", "CSCO", "BA", "CAT", "DE", "GE",
    "HON", "LMT", "RTX", "UPS", "FDX", "F", "GM", "RIVN", "PFE", "MRNA", "BMY", "GILD", "AMGN", "CVS", "OXY", "COP",
    "SLB", "FCX", "NEM", "DAL", "UAL", "AAL", "CCL", "RCL", "MARA", "RIOT", "SOFI", "AFRM", "DKNG", "ROKU", "ZM",
]
MAX_CHAINS = 30            # chains fetched per scan (the slow, rate-limited part)
WORKERS = 6
_bars: TTLCache = TTLCache(maxsize=1024, ttl=3600)
_earn: TTLCache = TTLCache(maxsize=1024, ttl=12 * 3600)
_lock = threading.Lock()


# ── Pure helpers ──────────────────────────────────────────────────────────────
def rsi(closes: List[float], n: int = 14) -> Optional[float]:
    """Wilder's RSI over the last n changes (0–100)."""
    if len(closes) < n + 1:
        return None
    gains = losses = 0.0
    for a, b in zip(closes[-n - 1:-1], closes[-n:]):
        d = b - a
        gains += max(d, 0.0)
        losses += max(-d, 0.0)
    if losses == 0:
        return 100.0
    rs = (gains / n) / (losses / n)
    return 100.0 - 100.0 / (1.0 + rs)


def hv_range(closes: List[float], window: int = 20, lookback: int = 252) -> Tuple[Optional[float], Optional[float]]:
    """(min, max) of rolling HV20 over the last year."""
    px = closes[-(lookback + window + 1):]
    vals = [bs.historical_vol(px[: i + 1], window) for i in range(window, len(px))]
    vals = [v for v in vals if v]
    return (min(vals), max(vals)) if vals else (None, None)


def screen(sym: str, closes: List[float], highs: List[float], spot: float) -> Dict[str, Any]:
    """Stage-1 metrics from daily bars and the live price."""
    high20 = max((highs or closes)[-20:]) if closes else None
    high20 = max(high20 or 0.0, spot)
    sma200 = sum(closes[-200:]) / 200 if len(closes) >= 200 else None
    lo, hi = hv_range(closes)
    prev = closes[-1] if closes else None
    return {
        "symbol": sym, "spot": spot,
        "pullback": 1 - spot / high20 if high20 else None, "high20": high20,
        "rsi": rsi(closes + [spot]) if closes else None,
        "sma200": sma200, "sma200_gap": spot / sma200 - 1 if sma200 else None,
        "day_change": spot / prev - 1 if prev else None,
        "hv20": bs.historical_vol(closes + [spot], 20), "hv_lo": lo, "hv_hi": hi,
    }


def passes_screen(m: Dict[str, Any], f: Dict[str, Any]) -> Optional[str]:
    """None when it passes, else the reason it doesn't."""
    if not (f["min_price"] <= m["spot"] <= f["max_price"]):
        return "price"
    pb = m.get("pullback")
    if pb is None or not (f["pullback_min"] <= pb <= f["pullback_max"]):
        return "pullback"
    if m.get("rsi") is not None and m["rsi"] > f["rsi_max"]:
        return "rsi"
    if f["above_sma200"] and (m.get("sma200") is None or m["spot"] < m["sma200"]):
        return "trend"
    return None


def iv_pctile(iv: Optional[float], lo: Optional[float], hi: Optional[float]) -> Optional[float]:
    if iv is None or lo is None or hi is None or hi <= lo:
        return None
    return min(max((iv - lo) / (hi - lo), 0.0), 1.0)


def score(pullback: float, f: Dict[str, Any], iv_hv: Optional[float], yld: float, rules: Rules,
          pct: Optional[float], spread_pct: float) -> float:
    """0–100: how deep the pullback (25), IV over realized (25), yield over the minimum (30), IV in its range (10), tight market (10)."""
    span = max(f["pullback_max"] - f["pullback_min"], 1e-9)
    p = min(max((pullback - f["pullback_min"]) / span, 0.0), 1.0)
    v = min(max(((iv_hv or 1.0) - 0.8) / 0.8, 0.0), 1.0)           # 0.8 → 0, 1.6+ → 1
    y = min(yld / max(rules.min_yield * 2, 1e-9), 1.0)              # 2× the minimum → full marks
    r = pct if pct is not None else 0.5
    liq = 1.0 - min(spread_pct / max(f["max_spread_pct"], 1e-9), 1.0)
    return round(100 * (0.25 * p + 0.25 * v + 0.30 * y + 0.10 * r + 0.10 * liq), 1)


def _num(v: Any) -> Optional[float]:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def quotes_from_rows(rows: List[Dict[str, Any]], spot: float, today: date) -> Tuple[List[Quote], Dict[tuple, Dict[str, float]]]:
    """Chain rows → Quotes (delta at spot) + {(expiry, strike, otype): {oi, spread_pct}}."""
    out, liq = [], {}
    for r in rows:
        bid, ask, last, iv = _num(r.get("bid")), _num(r.get("ask")), _num(r.get("last")), _num(r.get("iv"))
        mid = (bid + ask) / 2 if bid is not None and ask and ask >= bid else last
        if not mid or mid <= 0 or not iv or iv < bs.MIN_SIGMA:
            continue
        try:
            dte = float((date.fromisoformat(str(r["expiry"])) - today).days) + 0.25
        except ValueError:
            continue
        k, t = float(r["strike"]), str(r["otype"])
        q = Quote(k, t, iv, bid, ask, mid, dte, str(r["expiry"]))
        q.delta = bs.delta(spot, k, bs.year_fraction(dte), iv, t)
        out.append(q)
        liq[(q.expiry, k, t)] = {"oi": _num(r.get("oi")) or 0.0,
                                  "spread_pct": ((ask - bid) / mid) if bid is not None and ask else 1.0}
    return out, liq


def atm_iv(quotes: List[Quote], spot: float, target_dte: float = 30.0) -> Optional[float]:
    exps = sorted({(abs(q.dte - target_dte), q.expiry) for q in quotes})
    if not exps:
        return None
    exp = exps[0][1]
    on = [q for q in quotes if q.expiry == exp]
    k = min({q.strike for q in on}, key=lambda s: abs(s - spot))
    ivs = [q.iv for q in on if q.strike == k and q.iv]
    return sum(ivs) / len(ivs) if ivs else None


def trade_for(rules: Rules, quotes: List[Quote], spot: float,
              long_quotes: Optional[List[Quote]] = None) -> Tuple[Optional[Dict[str, Any]], str]:
    """The strategy's trade on this chain: (row fields, why-not). `quotes` = liquid contracts to sell."""
    if rules.key == "put_credit_spread":
        sp, why = engine.build_spread(quotes, spot, rules, long_quotes)
        if sp is None:
            return None, why
        q = sp.short
        return {"action": "SELL_PUT_SPREAD", "strike": q.strike, "long_strike": sp.long.strike, "expiry": q.expiry,
                "dte": q.dte, "delta": q.delta, "premium": sp.credit, "credit": sp.credit * 100, "yield_ann": sp.yield_ann,
                "collateral": sp.max_loss * 100, "max_loss": sp.max_loss * 100, "short": q,
                "headline": f"Sell {q.strike:g}/{sp.long.strike:g}P {q.expiry} for ${sp.credit:.2f}"}, ""
    otype = "call" if rules.key == "covered_call" else "put"
    q = engine.pick(quotes, otype, spot, rules)
    if q is None:
        return None, f"No {otype} {rules.delta_min:.2f}–{rules.delta_max:.2f}Δ, {rules.dte_min}–{rules.dte_max} days out."
    prem = q.mid or 0.0
    if otype == "call":                               # buy-write: 100 shares + this call
        y = engine.annual_yield(prem, spot, q.dte)
        return {"action": "BUY_WRITE", "strike": q.strike, "long_strike": None, "expiry": q.expiry, "dte": q.dte,
                "delta": q.delta, "premium": prem, "credit": prem * 100, "yield_ann": y,
                "collateral": (spot - prem) * 100, "max_loss": None, "short": q,
                "headline": f"Buy 100 sh + sell {q.strike:g}C {q.expiry} for ${prem:.2f}"}, ""
    y = engine.annual_yield(prem, q.strike, q.dte)
    return {"action": "SELL_PUT", "strike": q.strike, "long_strike": None, "expiry": q.expiry, "dte": q.dte,
            "delta": q.delta, "premium": prem, "credit": prem * 100, "yield_ann": y,
            "collateral": q.strike * 100, "max_loss": None, "short": q,
            "headline": f"Sell {q.strike:g}P {q.expiry} for ${prem:.2f}"}, ""


# ── Fetching (cached) ─────────────────────────────────────────────────────────
def _bars_for(sym: str) -> Tuple[List[float], List[float]]:
    with _lock:
        hit = _bars.get(sym)
    if hit is not None:
        return hit
    from optionflow.providers.market_data import get_market_data
    df = get_market_data().price_history(sym, "1y", "1d")
    closes, highs = [], []
    if df is not None and not df.empty:
        c = next((x for x in ("close", "Close") if x in df.columns), None)
        h = next((x for x in ("high", "High") if x in df.columns), None)
        closes = [float(v) for v in df[c].tolist() if v == v] if c else []
        highs = [float(v) for v in df[h].tolist() if v == v] if h else closes
    out = (closes, highs)
    with _lock:
        _bars[sym] = out
    return out


def earnings_date(sym: str) -> Optional[str]:
    """Next earnings date (YYYY-MM-DD) from Yahoo's calendar, cached 12 h; None when unknown."""
    with _lock:
        if sym in _earn:
            return _earn[sym]
    d = None
    try:
        from optionflow.providers.market_data import get_market_data
        cal = get_market_data().raw_ticker(sym).calendar or {}
        dates = cal.get("Earnings Date") or []
        if dates:
            d = str(dates[0])[:10]
    except Exception as exc:
        logger.debug("earnings %s failed: %s", sym, exc)
    with _lock:
        _earn[sym] = d
    return d


def universe(f: Dict[str, Any], user_id: Optional[int] = None) -> List[str]:
    syms: List[str] = list(DEFAULT_UNIVERSE) if f["use_default_universe"] else []
    if f["use_watchlists"] and user_id is not None:
        try:
            from optionflow.modules.watchlists import service as wl
            for g in wl.list_groups(user_id):
                syms += g.get("symbols") or []
        except Exception as exc:
            logger.info("scanner watchlists for user %s failed: %s", user_id, exc)
    syms += f["symbols"]
    seen, out = set(), []
    for s in syms:
        s = s.strip().upper()
        if s and s not in seen:
            seen.add(s)
            out.append(s)
    return out


# ── Scan ─────────────────────────────────────────────────────────────────────
def _chain_stage(m: Dict[str, Any], f: Dict[str, Any], rules: Rules, today: date) -> Tuple[Optional[Dict[str, Any]], str]:
    from optionflow.providers.market_data import get_market_data
    sym, spot = m["symbol"], m["spot"]
    ch = get_market_data().option_contracts(sym, max_dte=rules.dte_max + 1, max_expiries=8)
    rows = ch.rows.to_dict("records") if ch.rows is not None else []
    quotes, liq = quotes_from_rows(rows, spot, today)
    if not quotes:
        return None, "no chain"
    iv = atm_iv(quotes, spot, (rules.dte_min + rules.dte_max) / 2)
    hv = m.get("hv20")
    ivhv = iv / hv if iv and hv else None
    pct = iv_pctile(iv, m.get("hv_lo"), m.get("hv_hi"))
    if iv is None or iv < f["min_iv"]:
        return None, "iv"
    if ivhv is not None and ivhv < f["min_iv_hv"]:
        return None, "iv_hv"
    if f["min_iv_pctile"] > 0 and (pct is None or pct < f["min_iv_pctile"]):
        return None, "iv_pctile"
    liquid = [q for q in quotes if liq[(q.expiry, q.strike, q.otype)]["oi"] >= f["min_oi"]
              and liq[(q.expiry, q.strike, q.otype)]["spread_pct"] <= f["max_spread_pct"]]
    t, why = trade_for(rules, liquid, spot, quotes)      # a spread's long leg only needs a price
    if t is None:
        return None, "no_contract"
    if t["yield_ann"] is None or t["yield_ann"] < rules.min_yield:
        return None, "yield"
    if f["max_collateral"] and t["collateral"] > f["max_collateral"]:
        return None, "collateral"
    earn = earnings_date(sym) if f["skip_earnings"] else None
    if earn and earn <= t["expiry"] and earn >= today.isoformat():
        return None, "earnings"
    short = t.pop("short")
    lq = liq[(short.expiry, short.strike, short.otype)]
    sc = score(m["pullback"], f, ivhv, t["yield_ann"], rules, pct, lq["spread_pct"])
    reasons = [f"{m['pullback']:.1%} off the 20-day high (${m['high20']:,.2f})"
               + (f", RSI {m['rsi']:.0f}" if m.get("rsi") is not None else "") + "."]
    if m.get("sma200_gap") is not None:
        reasons.append(f"{m['sma200_gap']:+.1%} vs the 200-day average.")
    reasons.append(f"ATM IV {iv:.0%}" + (f" = {ivhv:.2f}× realized" if ivhv else "")
                   + (f", {pct:.0%} of its 1-year range" if pct is not None else "") + ".")
    reasons.append(f"{t['headline']}: Δ {t['delta']:.2f}, {t['dte']:.0f} days, {t['yield_ann']:.0%}/yr on "
                   + ("risk" if t["action"] == "SELL_PUT_SPREAD" else "the shares" if t["action"] == "BUY_WRITE" else "the cash") + ".")
    if f["skip_earnings"]:
        reasons.append(f"Earnings {earn} (after expiry)." if earn else "No earnings date found before expiry.")
    key = f"{rules.key}:{sym}:{t['strike']:g}" + (f"/{t['long_strike']:g}" if t.get("long_strike") else "") + f":{t['expiry']}"
    return {"key": key, "symbol": sym, "strategy": rules.key, **{k: _round(v) for k, v in t.items()},
            "spot": round(spot, 2), "day_change": _round(m.get("day_change")), "pullback": _round(m["pullback"]),
            "rsi": _round(m.get("rsi"), 1), "sma200_gap": _round(m.get("sma200_gap")), "iv": _round(iv), "hv20": _round(hv),
            "iv_hv": _round(ivhv), "iv_pctile": _round(pct), "oi": int(lq["oi"]), "spread_pct": _round(lq["spread_pct"]),
            "earnings": earn, "score": sc, "reasons": reasons}, ""


def _round(v: Any, n: int = 4) -> Any:
    return round(v, n) if isinstance(v, float) and math.isfinite(v) else (None if isinstance(v, float) else v)


def scan(rules: Rules, f: Dict[str, Any], user_id: Optional[int] = None) -> Dict[str, Any]:
    from optionflow.providers.market_data import get_market_data
    t0 = time.time()
    syms = universe(f, user_id)
    md = get_market_data()
    try:
        prices = md.last_prices(syms) if hasattr(md, "last_prices") else {s: md.last_price(s) for s in syms}
    except Exception as exc:
        logger.info("scanner prices failed: %s", exc)
        prices = {}
    skipped: Dict[str, int] = {}

    def stage1(sym: str) -> Optional[Dict[str, Any]]:
        try:
            closes, highs = _bars_for(sym)
        except Exception as exc:
            logger.debug("scanner bars %s failed: %s", sym, exc)
            return None
        spot = prices.get(sym) or (closes[-1] if closes else None)
        return screen(sym, closes, highs, float(spot)) if spot and closes else None

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        metrics = [m for m in pool.map(stage1, syms)]
    passed = []
    for sym, m in zip(syms, metrics):
        why = "no_data" if m is None else passes_screen(m, f)
        if why:
            skipped[why] = skipped.get(why, 0) + 1
        else:
            passed.append(m)
    passed.sort(key=lambda m: m["pullback"], reverse=True)
    if len(passed) > MAX_CHAINS:
        skipped["chain_cap"] = len(passed) - MAX_CHAINS
    today = datetime.now(timezone.utc).date()

    def stage2(m: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], str]:
        try:
            return _chain_stage(m, f, rules, today)
        except Exception as exc:
            logger.info("scanner chain %s failed: %s", m["symbol"], exc)
            return None, "no_chain"

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        results = list(pool.map(stage2, passed[:MAX_CHAINS]))
    rows = []
    for r, why in results:
        if r is None:
            skipped[why] = skipped.get(why, 0) + 1
        else:
            rows.append(r)
    rows.sort(key=lambda r: r["score"], reverse=True)
    return {"as_of": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "strategy": rules.key, "strategy_name": catalog.get(rules.key).name, "rules": rules.to_dict(), "filters": f,
            "universe": len(syms), "screened": len(passed), "chains": min(len(passed), MAX_CHAINS),
            "skipped": skipped, "rows": rows[: f["max_results"]], "seconds": round(time.time() - t0, 1)}
