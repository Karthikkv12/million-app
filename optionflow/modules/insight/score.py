"""optionflow/modules/insight/score.py — the LEAPS score: 0 (bad) to 100 (extremely good) (pure, no I/O).

"Is this a good moment to buy a long-dated call on this stock?" Ten factors, each scored 0–100 and weighted.
A long call wants a stock that goes up over years, bought on a pullback inside that uptrend, when implied
volatility is cheap, in a name that trades enough to get in and out and does not gap its holder to zero.

  trend        18  price vs the 200-day average, that average's slope, 50-day over 200-day
  pullback     18  how far under the 52-week high: 10–25% off in an uptrend is the sweet spot; at the high there is
                   no discount; a deep fall in a downtrend is a falling knife
  iv           14  implied vol vs realized (cheap options score high); without IV, where realized vol sits in its year
  volatility   10  how wild it is: calm-to-normal scores high, "super volatile" low
  liquidity    10  dollar volume traded per day (log scale)
  momentum     10  3- and 6-month return, with RSI: overbought trims it, oversold in an uptrend adds
  growth        8  compound annual return over the history available (up to 5 years)
  resilience    8  worst drawdown, and the share of days spent within 20% of the high
  strength      7  1-year return vs SPY
  dealers       5  above / below the gamma flip, long / short gamma

A factor with no data is left out and the rest are re-weighted. Bands: 0–19 Avoid, 20–39 Weak, 40–59 Fair,
60–79 Good, 80–100 Excellent.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

BANDS: Tuple[Tuple[int, str], ...] = ((80, "Excellent"), (60, "Good"), (40, "Fair"), (20, "Weak"), (0, "Avoid"))
WEIGHTS = {"trend": 18, "pullback": 18, "iv": 14, "volatility": 10, "liquidity": 10, "momentum": 10,
           "growth": 8, "resilience": 8, "strength": 7, "dealers": 5}
LABELS = {"trend": "Long-term trend", "pullback": "Pullback", "iv": "Option price (IV)", "volatility": "Volatility",
          "liquidity": "Volume", "momentum": "Momentum", "growth": "Long-run growth", "resilience": "Drawdown history",
          "strength": "Strength vs SPY", "dealers": "Dealer positioning"}
MIN_BARS = 60


def band(score: float) -> str:
    return next(name for floor, name in BANDS if score >= floor)


def lerp(x: float, pts: Sequence[Tuple[float, float]]) -> float:
    """Piecewise-linear through `pts` (sorted by x), flat beyond the ends."""
    if x <= pts[0][0]:
        return pts[0][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return pts[-1][1]


def sma(xs: Sequence[float], n: int) -> Optional[float]:
    return sum(xs[-n:]) / n if len(xs) >= n else None


def rsi(closes: Sequence[float], n: int = 14) -> Optional[float]:
    if len(closes) < n + 1:
        return None
    ch = [closes[i] - closes[i - 1] for i in range(len(closes) - n, len(closes))]
    up, dn = sum(c for c in ch if c > 0), -sum(c for c in ch if c < 0)
    return 100.0 if dn == 0 else 100.0 - 100.0 / (1.0 + up / dn)


def hv(closes: Sequence[float], n: int) -> Optional[float]:
    """Annualised close-to-close volatility of the last n returns."""
    if len(closes) < n + 1:
        return None
    r = [math.log(closes[i] / closes[i - 1]) for i in range(len(closes) - n, len(closes)) if closes[i - 1] > 0 and closes[i] > 0]
    if len(r) < 2:
        return None
    m = sum(r) / len(r)
    return math.sqrt(sum((x - m) ** 2 for x in r) / (len(r) - 1)) * math.sqrt(252.0)


def ret(closes: Sequence[float], n: int) -> Optional[float]:
    return closes[-1] / closes[-1 - n] - 1.0 if len(closes) > n and closes[-1 - n] > 0 else None


def _pct(x: float, d: int = 0) -> str:
    return f"{x * 100:+.{d}f}%"


def _factor(key: str, score: float, value: str, note: str) -> Dict[str, Any]:
    return {"key": key, "label": LABELS[key], "score": int(round(min(100.0, max(0.0, score)))),
            "weight": WEIGHTS[key], "value": value, "note": note}


def leaps_score(closes: Sequence[float], volumes: Optional[Sequence[Optional[float]]] = None, *,
                spy_closes: Optional[Sequence[float]] = None, atm_iv: Optional[float] = None,
                net_gex: Optional[float] = None, zero_gamma: Optional[float] = None) -> Dict[str, Any]:
    """{score, band, summary, factors, traits}; score None (with `error`) under MIN_BARS sessions of history."""
    px = [float(c) for c in closes if c and c > 0]
    if len(px) < MIN_BARS:
        return {"score": None, "band": None, "summary": "", "factors": [], "traits": None,
                "error": f"Needs {MIN_BARS} sessions of history; {len(px)} available."}
    last = px[-1]
    f: List[Dict[str, Any]] = []

    # ── trend ────────────────────────────────────────────────────────────────
    n_long = min(200, len(px))
    ma_long, ma50 = sma(px, n_long), sma(px, min(50, len(px)))
    vs_ma = last / ma_long - 1.0
    back = min(63, len(px) - n_long)
    slope = (ma_long / (sum(px[-n_long - back:-back]) / n_long) - 1.0) if back >= 20 else None
    golden = ma50 >= ma_long
    parts = [(0.45, lerp(vs_ma, [(-0.25, 0), (-0.05, 35), (0.0, 50), (0.10, 85), (0.25, 100)])),
             (0.20, 100.0 if golden else 20.0)]
    if slope is not None:
        parts.append((0.35, lerp(slope, [(-0.10, 0), (0.0, 45), (0.04, 80), (0.10, 100)])))
    trend = sum(w * s for w, s in parts) / sum(w for w, _ in parts)
    direction = "up" if trend >= 62 else "down" if trend < 38 else "sideways"
    f.append(_factor("trend", trend, f"{_pct(vs_ma)} vs {n_long}-day avg",
                     {"up": "Uptrend: the long-term average is rising and price holds around or above it.", "down": "Downtrend: below the long-term average.",
                      "sideways": "No clear long-term trend."}[direction]))

    # ── pullback ─────────────────────────────────────────────────────────────
    high = max(px[-252:])
    off = last / high - 1.0
    pb = lerp(off, [(-0.65, 10), (-0.45, 35), (-0.30, 75), (-0.20, 100), (-0.12, 95), (-0.05, 65), (0.0, 45)])
    if off > -0.03:
        state, note = "at the high", "At the 52-week high: no discount on the entry."
    elif off > -0.08:
        state, note = "small dip", "A small dip off the high."
    elif off > -0.30:
        state, note = "pulled back", "Pulled back: a discount on the entry."
    else:
        state, note = "deep drawdown", "Deep drawdown: cheap, but it has to stop falling first."
    if direction == "down" and off < -0.08:
        pb *= 0.6
        note = "Pulled back inside a downtrend: a falling knife until the trend turns."
    f.append(_factor("pullback", pb, f"{_pct(off)} from 52-wk high", note))

    # ── option price ─────────────────────────────────────────────────────────
    hv20, hv60 = hv(px, 20), hv(px, min(60, len(px) - 1))
    if atm_iv and hv60:
        ratio = atm_iv / hv60
        f.append(_factor("iv", lerp(ratio, [(0.8, 100), (1.0, 75), (1.3, 40), (1.8, 5)]), f"IV {atm_iv:.0%} vs realized {hv60:.0%}",
                         "Options are cheap vs how the stock moves." if ratio < 1.0 else
                         "Options are priced about in line with realized moves." if ratio < 1.3 else
                         "Options are expensive: you overpay for time value."))
    elif hv20 and len(px) >= 120:
        hist = [h for h in (hv(px[:i], 20) for i in range(len(px) - min(252, len(px) - 21), len(px) + 1)) if h]
        rank = sum(1 for h in hist if h <= hv20) / len(hist)
        f.append(_factor("iv", lerp(rank, [(0.0, 90), (0.5, 60), (1.0, 15)]), f"realized vol at its {rank:.0%} of the year",
                         "No option quote; realized vol is low for this stock, so options are likely cheap." if rank < 0.4 else
                         "No option quote; realized vol is high for this stock, so options are likely expensive." if rank > 0.7 else
                         "No option quote; realized vol is mid-range for this stock."))

    # ── volatility character ─────────────────────────────────────────────────
    vol = hv60 or hv20
    vol_tag = None
    if vol:
        vol_tag = "calm" if vol < 0.20 else "normal" if vol < 0.45 else "volatile" if vol < 0.80 else "super volatile"
        f.append(_factor("volatility", lerp(vol, [(0.10, 60), (0.18, 90), (0.35, 100), (0.55, 70), (0.80, 35), (1.20, 5)]),
                         f"{vol:.0%} a year",
                         {"calm": "Calm: small moves, cheap time value, slower payoff.",
                          "normal": "Normal swings for a stock.", "volatile": "Volatile: big swings both ways.",
                          "super volatile": "Super volatile: a long call can lose most of its value fast."}[vol_tag]))

    # ── liquidity ────────────────────────────────────────────────────────────
    vol_tag2 = None
    vs = [float(v) for v in (volumes or []) if v]
    if len(vs) >= 20 and len(vs) >= len(px) * 0.8:
        dollars = sum(vs[-20:]) / 20 * last
        rel = (sum(vs[-20:]) / 20) / (sum(vs[-90:]) / len(vs[-90:]))
        vol_tag2 = "low" if rel < 0.7 else "high" if rel > 1.3 else "normal"
        money = f"${dollars / 1e9:.1f}B" if dollars >= 1e9 else f"${dollars / 1e6:.0f}M"
        f.append(_factor("liquidity", lerp(math.log10(max(dollars, 1.0)), [(6.5, 0), (7.5, 40), (8.5, 80), (9.3, 100)]),
                         f"{money} a day, {rel:.1f}× its 90-day pace",
                         "Thinly traded: wide option spreads likely." if dollars < 3e7 else
                         f"Trades plenty; volume is {vol_tag2} vs its own 90 days."))

    # ── momentum ─────────────────────────────────────────────────────────────
    r3, r6, r14 = ret(px, 63), ret(px, 126), rsi(px)
    if r6 is not None or r3 is not None:
        m = [lerp(r, [(-0.30, 0), (0.0, 45), (0.15, 80), (0.40, 100), (1.0, 70)]) for r in (r3, r6) if r is not None]
        mom = sum(m) / len(m)
        note = "Rising over the last 3–6 months." if mom >= 60 else "Flat to weak over the last 3–6 months." if mom >= 35 else "Falling over the last 3–6 months."
        if r14 is not None and r14 > 75:
            mom, note = mom - 15, note + f" Overbought (RSI {r14:.0f})."
        elif r14 is not None and r14 < 30 and direction != "down":
            mom, note = mom + 10, note + f" Oversold (RSI {r14:.0f}) in an intact trend."
        f.append(_factor("momentum", mom, " · ".join(f"{k} {_pct(v)}" for k, v in (("3m", r3), ("6m", r6)) if v is not None), note))

    # ── long-run growth ──────────────────────────────────────────────────────
    years = (len(px) - 1) / 252.0
    if years >= 1.5:
        cagr = (last / px[0]) ** (1.0 / years) - 1.0
        f.append(_factor("growth", lerp(cagr, [(-0.10, 0), (0.0, 35), (0.08, 65), (0.15, 85), (0.25, 100)]),
                         f"{_pct(cagr)} a year over {years:.1f} years",
                         "Compounds well over the years." if cagr >= 0.12 else "Modest long-run growth." if cagr >= 0.03 else
                         "Has not grown over the years: a LEAPS needs the stock to rise."))

    # ── drawdown history ─────────────────────────────────────────────────────
    peak, worst, near = 0.0, 0.0, 0
    for c in px:
        peak = max(peak, c)
        d = c / peak - 1.0
        worst = min(worst, d)
        near += d >= -0.20
    near_share = near / len(px)
    f.append(_factor("resilience", 0.6 * lerp(worst, [(-0.90, 0), (-0.70, 20), (-0.50, 50), (-0.30, 80), (-0.15, 100)]) + 0.4 * near_share * 100,
                     f"worst {_pct(worst)}, {near_share:.0%} of days within 20% of the high",
                     "Shallow drawdowns that recover." if worst > -0.35 else "Has had deep drawdowns." if worst > -0.60 else
                     "Has lost most of its value before."))

    # ── strength vs SPY ──────────────────────────────────────────────────────
    spy = [float(c) for c in (spy_closes or []) if c and c > 0]
    n_rs = min(252, len(px) - 1, len(spy) - 1)
    if n_rs >= 60:
        ex = ret(px, n_rs) - ret(spy, n_rs)
        f.append(_factor("strength", lerp(ex, [(-0.30, 0), (0.0, 50), (0.30, 100)]), f"{_pct(ex)} vs SPY",
                         "Beating the market." if ex > 0.05 else "Lagging the market." if ex < -0.05 else "In line with the market."))

    # ── dealers ──────────────────────────────────────────────────────────────
    if net_gex is not None and zero_gamma:
        above, long_g = last >= zero_gamma, net_gex >= 0
        f.append(_factor("dealers", {(True, True): 80, (True, False): 60, (False, True): 45, (False, False): 25}[(above, long_g)],
                         f"{'above' if above else 'below'} the flip, {'long' if long_g else 'short'} gamma",
                         "Dealers dampen moves here: a steadier entry." if above and long_g else
                         "Below the flip with short gamma: dealers amplify the selling." if not above and not long_g else
                         "Mixed dealer positioning."))

    total_w = sum(x["weight"] for x in f)
    score = int(round(sum(x["score"] * x["weight"] for x in f) / total_w))
    ranked = sorted(f, key=lambda x: (x["score"] - 50) * x["weight"])
    weak = [x["label"].lower() for x in ranked[:2] if x["score"] < 45]
    strong = [x["label"].lower() for x in reversed(ranked[-2:]) if x["score"] >= 65]
    summary = band(score) + " for a LEAPS."
    if strong:
        summary += f" Helped by {' and '.join(strong)}."
    if weak:
        summary += f" Held back by {' and '.join(weak)}."
    day_vol = (atm_iv or hv20 or vol or 0.0) / math.sqrt(252.0)
    traits = {"trend": direction, "state": state, "volatility": vol_tag, "volume": vol_tag2,
              "off_high": round(off, 4), "rsi": round(r14, 1) if r14 is not None else None,
              "daily_move": round(day_vol, 4) if day_vol else None,                 # typical one-day move (1σ)
              "monthly_move": round(day_vol * math.sqrt(21.0), 4) if day_vol else None,
              "sessions": len(px)}
    return {"score": score, "band": band(score), "summary": summary, "factors": f, "traits": traits, "error": None}
