"""optionflow/modules/hedge/signal.py — levels and a tested ADD / HOLD / CAUTION read for a holding tracked as stock.

Used for holdings of long calls / long puts only (owner, 2026-11-13): no option strategy, the position is stock
exposure (calls long, puts short). Pure, no I/O.

What the verdict is built on (backtest 2026-11-13: 148 US stocks and ETFs, 1995-01 → 2026-11, 827,892 symbol-days;
rules picked on 1995–2014, checked untouched on 2015–2026; see docs/hedge-signal-backtest.md):

  The pattern: WHY a stock is down decides what comes next.
  - Down while the whole market is scared (VIX in the top 20% of its year) → it rebounds: RSI(14) < 40 with VIX ≥ 80th
    percentile beat simply holding by +1.2% over 20 days and +3.4% over 60 (2015–2026), up 60% of the time.
  - Down while the market is calm (a stock-specific problem) → no rebound edge; 60-day excess −1.2%.
  - Strength is NOT a sell: no bucket of trend / momentum / volume predicted a fall. Being above the averages,
    RSI high, buying volume all predicted slightly LOWER returns for the same stock (mean reversion).
  - A close under support during market fear came before a +1.8–2.7% rebound: a stop there sells the low.

  Verdict (long side; long puts read it mirrored):
    ADD      RSI(14) < ADD_RSI and VIX percentile ≥ ADD_VIX      (fear dip: the one tested buy edge)
    CAUTION  VIX percentile < CALM_VIX and (≥ KNIFE_DD under the 52-week high, or 3–15% over the 50-day with RSI > 65)
             → don't add here (stock-specific weakness, or stretched in a calm tape); not a sell signal
    HOLD     otherwise (most days: no edge either way)
  For long puts: the fear-dip is TRIM (take profit: the stock tends to rebound), everything else HOLD.

  score: the rebound score −100 … +100 = mean of [VIX percentile, oversold RSI, depth under the 50-day]; it ranked
  60-day excess from −1.4% (bottom) to +3.0% (top) out of sample.

Reads that are shown for context but NOT in the verdict: options flow and dealer levels (no history to test them),
trend and volume (tested: no edge, or the wrong sign), IV vs realised (per-stock IV history not available).

Levels: the dealer walls, max pain, the 20 / 50 / 200-day averages, the 20-day high and low, the 1-day / 1-week
expected move. The risk line (calm markets only) is the 200-day average: a calm-market close under it came before a
−1.2% 60-day excess; during fear there is no stop.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence

WEIGHTS = {"fear": 1, "momentum": 1, "dip": 1, "flow": 0, "trend": 0, "dealers": 0, "volume": 0, "volatility": 0}
TESTED = {"fear", "momentum", "dip"}       # the only reads in the verdict / score
ADD_RSI, ADD_VIX = 40.0, 0.80
CALM_VIX, KNIFE_DD = 0.60, -0.10
# Backtest evidence per verdict (2015–2026, out of sample): excess vs holding over 20 / 60 days, share up after 20.
EVIDENCE = {
    "ADD": "Backtest (2015–2026, unseen when the rule was set): +1.2% vs holding over 20 days, +3.4% over 60, "
           "up 60% of the time after 20 days; 29,617 cases, t = 2.7. It beat holding in 159 of 241 separate fear "
           "episodes since 1995, but failed in long bear markets (2008: −6.5%, 2022: −5.1% over 60 days): add in pieces.",
    "CAUTION": "Backtest: −0.3% to −0.6% vs holding over 20 days, about −1.2% over 60; a weak edge (t ≈ −2): "
               "don't add, but it is not a sell.",
    "HOLD": "Backtest: no edge either way on these days (most days).",
    "LEAN": "Backtest: oversold WITHOUT market fear had no edge (2015–2026: −0.0% vs holding over 20 days, −0.9% over "
            "60; 13,059 cases). The edge appears only once the VIX joins in.",
    "TRIM": "Backtest (long side): the stock beat holding by +1.2% / 20 days after this setup: puts tend to give back.",
}
MIN_FLOW = 250_000.0          # $ of option premium traded today before flow counts
STOP_BUFFER = 0.01            # stop = 1% past the support / resistance
NEAR = 0.015                  # within 1.5% of a wall counts as "at" it
# Strength of each level kind: dealer walls hold best, then the long averages.
STRENGTH = {"put_wall": 3, "call_wall": 3, "zero_gamma": 3, "king": 2, "ma200": 2, "ma50": 2, "low20": 2, "high20": 2,
            "max_pain": 1, "ma20": 1, "em_week_lo": 1, "em_week_hi": 1, "em_day_lo": 0, "em_day_hi": 0}
LABEL = {"put_wall": "put wall", "call_wall": "call wall", "zero_gamma": "gamma flip", "king": "king strike",
         "ma200": "200-day avg", "ma50": "50-day avg", "ma20": "20-day avg", "low20": "20-day low", "high20": "20-day high",
         "max_pain": "max pain", "em_week_lo": "1-week move low", "em_week_hi": "1-week move high",
         "em_day_lo": "1-day move low", "em_day_hi": "1-day move high"}


@dataclass
class Tape:
    spot: float
    closes: Sequence[float] = ()             # daily closes, oldest first; the last may be today's (live)
    volumes: Sequence[Optional[float]] = ()  # same length as closes
    highs: Sequence[Optional[float]] = ()
    lows: Sequence[Optional[float]] = ()
    today_bar: bool = False                  # the last bar is today's (partial during the session)
    session_frac: float = 1.0                # share of today's session gone (projects today's volume); 1 = closed
    day_change: Optional[float] = None       # % today
    atm_iv: Optional[float] = None
    hv20: Optional[float] = None
    iv_spike: bool = False
    iv_cooling: bool = False
    net_gex: Optional[float] = None
    zero_gamma: Optional[float] = None
    put_wall: Optional[float] = None
    call_wall: Optional[float] = None
    king: Optional[float] = None
    max_pain: Optional[float] = None
    flow: Optional[Sequence[float]] = None   # (call bought, call sold, put bought, put sold) premium today
    vix: Sequence[float] = ()                # VIX daily closes, oldest first (≥ 1 year), the last = now


@dataclass
class Read:
    key: str
    score: float          # −1 … +1, bullish positive
    value: str
    note: str


@dataclass
class Signal:
    score: int                               # −100 … +100, bullish positive
    bias: str                                # bullish | bearish | neutral
    verdict: str                             # ADD | HOLD | CAUTION (long) · TRIM | HOLD (long puts)
    side: str                                # long | short
    headline: str
    support: Optional[Dict[str, Any]] = None
    resistance: Optional[Dict[str, Any]] = None
    stop: Optional[float] = None             # risk line (calm markets only): the 200-day average
    add_at: Optional[float] = None
    target: Optional[float] = None
    reads: List[Dict[str, Any]] = field(default_factory=list)
    levels: List[Dict[str, Any]] = field(default_factory=list)
    expected_move: Optional[Dict[str, float]] = None
    vix_pct: Optional[float] = None
    evidence: str = ""


# ── helpers ──────────────────────────────────────────────────────────────────
def _clip(x: float, lo: float = -1.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def sma(xs: Sequence[float], n: int) -> Optional[float]:
    return sum(xs[-n:]) / n if len(xs) >= n and n > 0 else None


def rsi(xs: Sequence[float], n: int = 14) -> Optional[float]:
    if len(xs) < n + 1:
        return None
    ch = [b - a for a, b in zip(xs[-n - 1:-1], xs[-n:])]
    up, dn = sum(c for c in ch if c > 0) / n, -sum(c for c in ch if c < 0) / n
    return 100.0 if dn == 0 else 100.0 - 100.0 / (1.0 + up / dn)


def _ok(v: Optional[float]) -> bool:
    return v is not None and isinstance(v, (int, float)) and math.isfinite(v) and v > 0


def _px(x: float) -> str:
    return f"{x:,.2f}"


# ── reads ────────────────────────────────────────────────────────────────────
def _flow(t: Tape) -> Optional[Read]:
    if not t.flow or len(t.flow) != 4:
        return None
    cb, cs, pb, ps = (max(0.0, float(x or 0.0)) for x in t.flow)
    tot = cb + cs + pb + ps
    if tot < MIN_FLOW:
        return None
    net = cb + ps - cs - pb
    s = _clip(net / tot * 2.0)                       # a 50/50 split of bull vs bear premium is 0; ±50% net is ±1
    lean = "bullish" if s > 0.15 else "bearish" if s < -0.15 else "mixed"
    return Read("flow", s, f"{net / 1e6:+,.1f}M of {tot / 1e6:,.1f}M",
                f"Options flow {lean}: calls bought ${cb / 1e6:,.1f}M / sold ${cs / 1e6:,.1f}M, "
                f"puts bought ${pb / 1e6:,.1f}M / sold ${ps / 1e6:,.1f}M today.")


def _trend(t: Tape, px: List[float]) -> Optional[Read]:
    m20, m50, m200 = sma(px, 20), sma(px, 50), sma(px, 200)
    if m20 is None:
        return None
    parts = [_clip((t.spot / m20 - 1.0) / 0.04)]
    if m50:
        parts.append(_clip((t.spot / m50 - 1.0) / 0.08))
    if m200:
        parts.append(_clip((t.spot / m200 - 1.0) / 0.15))
        if m50:
            parts.append(0.6 if m50 >= m200 else -0.6)
    s = sum(parts) / len(parts)
    where = ", ".join(f"{'above' if t.spot >= m else 'below'} the {n}-day ({_px(m)})"
                      for n, m in ((20, m20), (50, m50), (200, m200)) if m)
    cross = "" if not (m50 and m200) else (" 50-day over 200-day." if m50 >= m200 else " 50-day under 200-day.")
    return Read("trend", s, f"{s:+.2f}", f"Price {where}.{cross}")


def _dealers(t: Tape) -> Optional[Read]:
    parts, notes = [], []
    if _ok(t.zero_gamma):
        above = t.spot >= t.zero_gamma
        parts.append(0.5 if above else -0.5)
        notes.append(f"{'above' if above else 'below'} the gamma flip {_px(t.zero_gamma)}"
                     + (" (dealers long gamma: dips get bought)" if above else " (dealers short gamma: moves run further)"))
    elif t.net_gex is not None:
        parts.append(0.3 if t.net_gex > 0 else -0.3)
        notes.append("net GEX " + ("positive: dips get bought" if t.net_gex > 0 else "negative: moves run further"))
    if _ok(t.put_wall) and t.put_wall <= t.spot and t.spot / t.put_wall - 1.0 <= NEAR:
        parts.append(0.6)
        notes.append(f"sitting on the put wall {_px(t.put_wall)} (support)")
    if _ok(t.call_wall) and t.call_wall >= t.spot and t.call_wall / t.spot - 1.0 <= NEAR:
        parts.append(-0.6)
        notes.append(f"pressing the call wall {_px(t.call_wall)} (resistance)")
    if _ok(t.put_wall) and t.spot < t.put_wall * (1.0 - NEAR):
        parts.append(-0.6)
        notes.append(f"broke under the put wall {_px(t.put_wall)}")
    if _ok(t.call_wall) and t.spot > t.call_wall * (1.0 + NEAR):
        parts.append(0.6)
        notes.append(f"broke over the call wall {_px(t.call_wall)}")
    if not parts:
        return None
    s = _clip(sum(parts) / len(parts) * 1.2)
    return Read("dealers", s, f"{s:+.2f}", "Dealers: " + "; ".join(notes) + ".")


def _volume(t: Tape, px: List[float]) -> Optional[Read]:
    """`px`: closes aligned with t.volumes (the last is today's when t.today_bar, else the last full session's)."""
    vols = [float(v) if v else 0.0 for v in t.volumes]
    if len(vols) < 21 or len(vols) != len(px):
        return None
    base = sum(vols[-21:-1]) / 20
    if base <= 0:
        return None
    frac = t.session_frac if t.today_bar else 1.0
    rv = vols[-1] / max(frac, 0.1) / base
    move = (t.day_change if t.today_bar and t.day_change is not None else (px[-1] / px[-2] - 1.0) * 100)
    direction = 1.0 if move > 0.1 else -1.0 if move < -0.1 else 0.0
    heavy = _clip((rv - 1.0) / 1.0, 0.0, 1.0)            # 1× = nothing, 2× and over = full weight
    obv, run = 0.0, []
    for a, b, v in zip(px[-21:-1], px[-20:], vols[-20:]):
        obv += v if b > a else -v if b < a else 0.0
        run.append(obv)
    obv_s = _clip(obv / (base * 10.0))                   # half the 20-day volume net one way = ±1
    s = _clip(0.6 * direction * heavy + 0.4 * obv_s)
    kind = ("accumulation" if direction > 0 else "distribution" if direction < 0 else "churn") if heavy > 0.25 else "normal volume"
    return Read("volume", s, f"{rv:.1f}× avg",
                f"Volume {rv:.1f}× the 20-day average{' (projected for the full day)' if frac < 1 else '' if t.today_bar else ' (last session)'}: {kind}; "
                f"20-day on-balance volume {'rising' if obv > 0 else 'falling'}.")


def _momentum(t: Tape, px: List[float]) -> Optional[Read]:
    """RSI(14) the way the backtest scored it: oversold leans bullish (mean reversion), overbought bearish."""
    r = rsi(px)
    if r is None:
        return None
    tag = "oversold" if r < 30 else "weak" if r < ADD_RSI else "overbought" if r > 70 else "strong" if r > 60 else "neutral"
    roc = px[-1] / px[-21] - 1.0 if len(px) > 21 else None
    return Read("momentum", _clip((50.0 - r) / 25.0), f"RSI {r:.0f}",
                f"RSI(14) {r:.0f}, {tag}" + (f"; {roc:+.1%} over 20 days." if roc is not None else "."))


def _volatility(t: Tape) -> Optional[Read]:
    if not _ok(t.atm_iv):
        return None
    ratio = t.atm_iv / t.hv20 if _ok(t.hv20) else None
    up = (t.day_change or 0.0) > 0
    s, notes = 0.0, []
    if t.iv_spike:
        s += -0.7 if not up else -0.2
        notes.append("IV spiking" + (" on a down day: fear, protection being bought" if not up else " into the rally"))
    if t.iv_cooling:
        s += 0.5 if up else 0.2
        notes.append("IV cooling" + (": relief, sellers stepping back" if up else ""))
    if ratio is not None:
        if ratio >= 1.3:
            s += -0.3
            notes.append(f"IV {ratio:.2f}× realised: options price a bigger move than the stock is making")
        elif ratio <= 0.85:
            s += 0.2
            notes.append(f"IV {ratio:.2f}× realised: calm, cheap protection")
        else:
            notes.append(f"IV {ratio:.2f}× realised: normal")
    return Read("volatility", _clip(s), f"IV {t.atm_iv:.0%}" + (f" / HV {t.hv20:.0%}" if _ok(t.hv20) else ""),
                "Volatility: " + "; ".join(notes) + ".")


def vix_percentile(vix: Sequence[float]) -> Optional[float]:
    """Share of the last 252 VIX closes at or below the latest (the backtest's rolling rank)."""
    v = [float(x) for x in vix if _ok(x)][-252:]
    if len(v) < 126:
        return None
    return sum(1 for x in v if x <= v[-1]) / len(v)


def vix_add_level(vix: Sequence[float]) -> Optional[float]:
    """The VIX close that would reach the ADD_VIX percentile against the current year (approximate)."""
    v = sorted(float(x) for x in list(vix)[-252:] if _ok(x))
    if len(v) < 126:
        return None
    return v[min(len(v) - 1, math.ceil(ADD_VIX * len(v)) - 1)]


def _fear(t: Tape) -> Optional[Read]:
    p = vix_percentile(t.vix)
    if p is None:
        return None
    tag = ("market scared: dips have rebounded" if p >= ADD_VIX else
           "market calm: a dip here is about the stock itself" if p < CALM_VIX else "market normal")
    return Read("fear", _clip(p * 2 - 1), f"VIX {t.vix[-1]:.1f} · {p:.0%} pct",
                f"VIX {t.vix[-1]:.1f}, higher than {p:.0%} of the last year: {tag}.")


def _dip(t: Tape, px: List[float]) -> Optional[Read]:
    m50 = sma(px, 50)
    if not m50:
        return None
    d = t.spot / m50 - 1.0
    return Read("dip", _clip(-d / 0.15), f"{d:+.1%} vs 50-day",
                f"{abs(d):.1%} {'under' if d < 0 else 'over'} the 50-day average ({_px(m50)}).")


# ── levels ───────────────────────────────────────────────────────────────────
def levels(t: Tape, px: List[float]) -> tuple:
    """([{key, label, price, distance, strength}], expected move {day, week} in $ or None)."""
    lv: Dict[str, float] = {}
    for k in ("put_wall", "call_wall", "zero_gamma", "king", "max_pain"):
        v = getattr(t, k)
        if _ok(v):
            lv[k] = float(v)
    for n in (20, 50, 200):
        m = sma(px, n)
        if m:
            lv[f"ma{n}"] = m
    hi = [h for h in list(t.highs)[-20:] if _ok(h)] or px[-20:]
    lo = [l for l in list(t.lows)[-20:] if _ok(l)] or px[-20:]
    if hi and lo:
        lv["high20"], lv["low20"] = max(hi), min(lo)
    em = None
    if _ok(t.atm_iv):
        d, w = t.spot * t.atm_iv * math.sqrt(1 / 252), t.spot * t.atm_iv * math.sqrt(5 / 252)
        em = {"day": round(d, 2), "week": round(w, 2)}
        lv.update({"em_day_lo": t.spot - d, "em_day_hi": t.spot + d, "em_week_lo": t.spot - w, "em_week_hi": t.spot + w})
    out = [{"key": k, "label": LABEL[k], "price": round(p, 2), "distance": round(p / t.spot - 1.0, 4),
            "strength": STRENGTH[k]} for k, p in lv.items()]
    return sorted(out, key=lambda x: -x["price"]), em


def _nearest(lv: List[Dict[str, Any]], spot: float, below: bool) -> Optional[Dict[str, Any]]:
    """The closest level on that side with strength ≥ 2, else the closest of any strength (expected move excluded)."""
    side = [x for x in lv if (x["price"] < spot if below else x["price"] > spot) and not x["key"].startswith("em_day")]
    for min_s in (2, 1):
        strong = [x for x in side if x["strength"] >= min_s]
        if strong:
            return max(strong, key=lambda x: x["price"]) if below else min(strong, key=lambda x: x["price"])
    return None


# ── the signal ───────────────────────────────────────────────────────────────
def evaluate(t: Tape, exposure: float) -> Signal:
    """`exposure`: the holding's net delta (lots); its sign makes the verdict long or short."""
    hist = [float(c) if _ok(c) else float("nan") for c in t.closes]
    if any(math.isnan(c) for c in hist):                  # keep closes and volumes aligned: fill a gap with the last close
        for i, c in enumerate(hist):
            if math.isnan(c):
                hist[i] = hist[i - 1] if i else next((x for x in hist if not math.isnan(x)), t.spot)
    if hist and t.today_bar:
        hist[-1] = t.spot                                  # today's bar closes at the live price
    px = hist if t.today_bar else hist + [t.spot]          # closes up to now
    reads = [r for r in (_fear(t), _momentum(t, px), _dip(t, px), _flow(t), _trend(t, px), _dealers(t),
                         _volume(t, hist), _volatility(t)) if r]
    tested = [r for r in reads if r.key in TESTED]
    score = round(100 * sum(r.score for r in tested) / 3) if len(tested) == 3 else 0
    bias = "bullish" if score >= 25 else "bearish" if score <= -25 else "neutral"

    vp = vix_percentile(t.vix)
    r14 = rsi(px)
    m50 = sma(px, 50)
    hi52 = max(px[-252:]) if px else None
    dd52 = t.spot / hi52 - 1.0 if hi52 else None
    fear_dip = vp is not None and r14 is not None and r14 < ADD_RSI and vp >= ADD_VIX
    calm = vp is not None and vp < CALM_VIX
    knife = calm and dd52 is not None and dd52 <= KNIFE_DD
    stretched = calm and m50 is not None and r14 is not None and 0.03 <= t.spot / m50 - 1.0 <= 0.15 and r14 > 65
    long = exposure >= 0
    if long:
        verdict = "ADD" if fear_dip else "CAUTION" if (knife or stretched) else "HOLD"
    else:
        verdict = "TRIM" if fear_dip else "HOLD"

    lv, em = levels(t, px)
    sup, res = _nearest(lv, t.spot, True), _nearest(lv, t.spot, False)
    m200 = sma(px, 200)
    stop = round(m200, 2) if (calm and m200 and long and t.spot > m200) else None
    add_at, target = ((sup["price"] if sup else None), (res["price"] if res else None)) if long else \
                     ((res["price"] if res else None), (sup["price"] if sup else None))

    def at(x):
        return f"{_px(x['price'])} ({x['label']})"
    if verdict == "ADD":
        head = "Add: dip during market fear" + (f", support {at(sup)}" if sup else "")
    elif verdict == "CAUTION":
        head = ("Don't add: stock-specific weakness in a calm market" if knife else "Don't add: stretched in a calm market")
    elif verdict == "TRIM":
        head = "Take profit on the puts: fear dip, rebounds are likely"
    elif long and score >= 50 and r14 is not None and r14 < ADD_RSI and vp is not None:
        lvl = vix_add_level(t.vix)
        head = "Hold: oversold, but the market isn't scared" + (f"; ADD if VIX closes ≥ {lvl:.1f}" if lvl else "")
    else:
        head = "Hold: no edge right now" + (f" · support {_px(sup['price'])}" if sup else "") + (f", resistance {_px(res['price'])}" if res else "")
    if vp is None or r14 is None:
        head += " (no VIX / history: verdict not tested)"

    return Signal(score, bias, verdict, "long" if long else "short", head, sup, res, stop, add_at, target,
                  [{"key": r.key, "score": round(r.score, 2), "weight": WEIGHTS[r.key], "value": r.value, "note": r.note,
                    "tested": r.key in TESTED} for r in reads], lv, em, _r(vp),
                  EVIDENCE["LEAN" if head.startswith("Hold: oversold") else verdict])


def _r(x: Optional[float]) -> Optional[float]:
    return None if x is None else round(x, 3)


def reasons(sig: Signal) -> List[str]:
    """Plain-language lines for the desk's ticket."""
    out = [sig.evidence] if sig.evidence else []
    if sig.support or sig.resistance:
        parts = []
        if sig.support:
            parts.append(f"support {_px(sig.support['price'])} ({sig.support['label']}, {sig.support['distance']:+.1%})")
        if sig.resistance:
            parts.append(f"resistance {_px(sig.resistance['price'])} ({sig.resistance['label']}, {sig.resistance['distance']:+.1%})")
        out.append("Levels: " + "; ".join(parts) + ".")
    if sig.stop:
        out.append(f"Risk line: a calm-market close under the 200-day average ({_px(sig.stop)}) has come before weaker returns.")
    elif sig.vix_pct is not None and sig.vix_pct >= ADD_VIX:
        out.append("No stop during market fear: closes under support in fear have rebounded (+1.8–2.7% vs holding over 20 days).")
    if sig.expected_move:
        out.append(f"Expected move from IV: ±{_px(sig.expected_move['day'])} today, ±{_px(sig.expected_move['week'])} this week.")
    out += [r["note"] for r in sig.reads if r["tested"]]
    out += [r["note"] + " (context, not in the verdict)" for r in sig.reads if not r["tested"]]
    return out
