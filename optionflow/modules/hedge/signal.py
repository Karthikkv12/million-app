"""optionflow/modules/hedge/signal.py — a tested Add / Hold / Don't add read for ANY holding (or none), with prices.

Every holding gets it (owner, T-91): shares, long calls / puts, covered calls, spreads, mixed books, read for the
book's net side; a ticker you don't hold gets the same read as a buy decision (Buy / Wait / Don't buy yet). Pure, no I/O.

What it is built on (re-tested 2026-11-14, scripts/backtest_signal/{review,rebuild,compare,probs}.py, see
docs/hedge-signal-review.md: 148 US stocks and ETFs, 1995-01 → 2026-11, 827,847 symbol-days; every threshold chosen on
1995–2014, read once on 2015–2026):

  The pattern: WHY a stock is down decides what comes next. Dips while the whole market is scared rebound; dips in a
  calm market are about the stock and don't. Strength is not a sell (no trend / momentum / volume bucket predicted a fall).

  Fear score = clip((VIX percentile − 0.5) / 0.5, 0, 1)^1.5 × clip((50 − RSI14) / 30, 0, 1); cutoff SCORE_CUT (the
  1995–2014 92.5th percentile, i.e. as often as the old RSI < 40 & VIX ≥ 80th rule). 2015–2026: +3.45% vs holding over
  60 days (t 2.48), +1.22% over 20 (t 3.51); the old rule +3.41% (t 1.78).
    ADD      fear score ≥ SCORE_CUT. Add in thirds: ≤ 3 tranches ≥ 10 trading days apart (cut the 2008 / 2022 hit from
             −9.3% / −8.3% to −1.9% / −1.9% of the overlay; a "pause after 2 losses" rule made 2008 worse).
    CAUTION  VIX percentile < CALM_VIX and (≥ 10% under the 52-week high, or 3–15% over the 50-day with RSI > 65):
             don't add (−1.3% vs holding over 60 days, t −2.7); not a sell signal.
    HOLD     otherwise. LEAN (oversold without enough fear) is a coin flip.
  Long puts: on ADD days TRIM (take profit): held puts lost 7.9–11.1% of value vs an average day over 60 days.
  The 1.2× IV gate is gone: re-chosen on 1995–2014 alone it picks no gate (it was hindsight). IV is shown as context.

Options: the edge survives theta, IV and costs on 365-day 0.80Δ calls over 20 days (t 3.2, passes a 28-test
correction); the 60-day option result (t 1.9) does not pass it. Rolling to escape time decay did NOT pay: a
delta-matched roll broke even before costs and lost ~4% of the position's value after costs at every days-left from 90
to 365, so legs only flag ROLL inside EXPIRY_ROLL days (expiry mechanics, not an edge).

Plan (prices, not just a stamp): the close that would make it ADD at today's VIX, the VIX close that would at today's
price, support / resistance, the exit line (a calm-market close under the 200-day: −1.65% vs holding over 60 days,
t −2.75), what clears a CAUTION, and the covered-call adjustment (fear dip: 0.15Δ beat 0.30Δ by +0.33% of the stock a
month, t 3.9; calm weakness: going closer to the money did not pay).

Levels: the dealer walls, max pain, the 20 / 50 / 200-day averages, the 20-day high and low, the 1-day / 1-week
expected move. Flow / dealer reads are context only (no history to test them).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence

WEIGHTS = {"fear": 1, "momentum": 1, "dip": 1, "flow": 0, "trend": 0, "dealers": 0, "volume": 0, "volatility": 0}
TESTED = {"fear", "momentum", "dip"}       # the only reads in the verdict / score
ADD_RSI, ADD_VIX = 40.0, 0.80
CALM_VIX, KNIFE_DD = 0.60, -0.10
SCORE_CUT = 0.283            # ADD: fear score ≥ this (chosen on 1995–2014)
TRANCHES, TRANCHE_GAP = 3, 10       # add in thirds, ≥ 10 trading days apart
EXPIRY_ROLL, EXPIRY_WARN = 30, 60   # days left: roll or close / heads-up (expiry mechanics; time decay alone didn't pay)
EXIT_DROP_60 = -0.0165              # calm close under the 200-day → 60-day excess (2015–2026, t −2.75)
ADD_MIN_DTE, ADD_DELTA, ADD_HOLD_DAYS = 365, 0.80, 60
DECAY_DAYS = 28              # 20 trading days ≈ 28 calendar days
# 30-day IV model: log IV30 = c0 + c1·log HV20 + c2·log HV60 + c3·log HV252 + c4·log(VIX / its 1-year median)
IV_COEF = (-0.14097195906371088, 0.2540721934391069, 0.09742051640355423, 0.4790064141745925, 0.3558036079608121)
IV_NORMAL_DAYS, IV_NORMAL_MIN = 1260, 252
TERM_KAPPA = 2.25            # /yr: long-dated IV = normal + (IV30 − normal)·g(T)/g(1/12), g(T) = (1 − e^{−κT})/(κT)
# Backtest evidence per case (2015–2026, unseen when the rules were set).
EVIDENCE = {
    "ADD": "Backtest (fear score, 2015–2026, unseen): +3.5% vs holding over 60 trading days (t 2.5), +1.2% over 20 "
           "(t 3.5); 365-day 0.80Δ calls +3.5% of premium vs an average day over 20 days after costs (t 3.2). Up only "
           "~6 times in 10: the edge is the big rebounds. Failed in long bear markets (2008, 2022): add in thirds.",
    "LEAN": "Backtest: oversold WITHOUT enough market fear had no edge (2015–2026: −0.2% vs holding over 60 days, 90% "
            "range −1.4% to +1.1%; 31,547 cases). The edge appears once the VIX joins in.",
    "CAUTION": "Backtest: −0.4% vs holding over 20 days and −1.3% over 60 (t −2.7, 2015–2026): don't add, but it is "
               "not a sell.",
    "HOLD": "Backtest: no edge either way on these days (most days).",
    "TRIM": "Backtest: on fear-dip days held puts lost 7.9% (365-day) to 11.1% (180-day) of their value vs an average "
            "day over 60 trading days (2015–2026): stocks tend to rebound.",
    "ROLL": "Expiry, not decay: rolling early to escape time decay lost ~4% of the position to costs at every days-left "
            "tested (90–365). Inside 30 days, decide: roll to 365+ days or close.",
}
# Probabilities per case, 2015–2026 (unseen when the rules were set); scripts/backtest_signal/probs.py.
# p_up_N: stock up after N trading days · p_beat_N: beat simply holding it · p_option_profit_60: a 365-day 0.80Δ call
# (stress costs) made money over 60 days · edge_60 / edge_lo / edge_hi: mean 60-day excess and its 90% range
# (month-cluster bootstrap) · p_edge_positive: share of bootstrap draws with a positive mean edge.
PROBS: Dict[str, Dict[str, Any]] = {
    "ADD": {"cases": 28555, "months": 82, "p_up_20": 0.609, "p_up_60": 0.662, "p_beat_20": 0.546, "p_beat_60": 0.558, "p_option_profit_60": 0.542, "edge_60": 0.0363, "edge_lo": 0.0063, "edge_hi": 0.0663, "p_edge_positive": 0.98},
    "LEAN": {"cases": 31547, "months": 139, "p_up_20": 0.579, "p_up_60": 0.608, "p_beat_20": 0.501, "p_beat_60": 0.483, "p_option_profit_60": 0.475, "edge_60": -0.0015, "edge_lo": -0.0143, "edge_hi": 0.0111, "p_edge_positive": 0.428},
    "CAUTION": {"cases": 132653, "months": 117, "p_up_20": 0.549, "p_up_60": 0.579, "p_beat_20": 0.474, "p_beat_60": 0.461, "p_option_profit_60": 0.456, "edge_60": -0.0121, "edge_lo": -0.025, "edge_hi": 0.0005, "p_edge_positive": 0.057},
    "HOLD": {"cases": 178248, "months": 140, "p_up_20": 0.576, "p_up_60": 0.61, "p_beat_20": 0.495, "p_beat_60": 0.478, "p_option_profit_60": 0.476, "edge_60": 0.0035, "edge_lo": -0.0087, "edge_hi": 0.0158, "p_edge_positive": 0.671},
    "TRIM": {"cases": 28555, "months": 82, "p_up_20": 0.609, "p_up_60": 0.662, "p_beat_20": 0.546, "p_beat_60": 0.558, "p_option_profit_60": 0.542, "edge_60": 0.0363, "edge_lo": 0.0058, "edge_hi": 0.0652, "p_edge_positive": 0.977},
}
# Held 365-day 0.80Δ calls by their P&L (scripts/backtest_signal/holdsim.py + pnl_risk.py: 39,294 simulated positions,
# checked monthly; this table is 2015–2026). Next 60 trading days, in shares of the ORIGINAL premium: p_lose_25_paid =
# lost more than 25% of what was paid, p5_paid = the worst 1 in 20. stock_excess_60 / t_stock: the stock vs holding it,
# by the position's P&L — never significant (|t| < 1.2): P&L does not predict the stock, so it never moves the verdict.
PNL_RISK: List[Dict[str, Any]] = [
    {"lo": -1.0, "hi": -0.5, "label": "<-50%", "cases": 12952, "p_lose_25_paid": 0.116, "p_gain_25_paid": 0.205, "p5_paid": -0.318, "median_paid": -0.029, "time_value": 0.899, "stock_excess_60": 0.0066, "t_stock": -0.21},
    {"lo": -0.5, "hi": -0.25, "label": "-50/-25", "cases": 16347, "p_lose_25_paid": 0.226, "p_gain_25_paid": 0.321, "p5_paid": -0.478, "median_paid": 0.025, "time_value": 0.464, "stock_excess_60": 0.0062, "t_stock": -0.13},
    {"lo": -0.25, "hi": 0, "label": "-25/0", "cases": 23019, "p_lose_25_paid": 0.248, "p_gain_25_paid": 0.351, "p5_paid": -0.57, "median_paid": 0.052, "time_value": 0.245, "stock_excess_60": -0.0006, "t_stock": -0.43},
    {"lo": 0, "hi": 0.25, "label": "0/+25", "cases": 22451, "p_lose_25_paid": 0.253, "p_gain_25_paid": 0.382, "p5_paid": -0.658, "median_paid": 0.085, "time_value": 0.137, "stock_excess_60": -0.0029, "t_stock": -0.57},
    {"lo": 0.25, "hi": 0.5, "label": "+25/+50", "cases": 16157, "p_lose_25_paid": 0.262, "p_gain_25_paid": 0.403, "p5_paid": -0.759, "median_paid": 0.102, "time_value": 0.08, "stock_excess_60": -0.0067, "t_stock": -1.14},
    {"lo": 0.5, "hi": 1.0, "label": "+50/+100", "cases": 16978, "p_lose_25_paid": 0.27, "p_gain_25_paid": 0.43, "p5_paid": -0.909, "median_paid": 0.126, "time_value": 0.046, "stock_excess_60": -0.0052, "t_stock": -0.9},
    {"lo": 1.0, "hi": 2.0, "label": "+100/+200", "cases": 9225, "p_lose_25_paid": 0.293, "p_gain_25_paid": 0.464, "p5_paid": -1.093, "median_paid": 0.173, "time_value": 0.023, "stock_excess_60": 0.0003, "t_stock": 0.67},
    {"lo": 2.0, "hi": 99, "label": ">+200%", "cases": 2501, "p_lose_25_paid": 0.363, "p_gain_25_paid": 0.499, "p5_paid": -2.291, "median_paid": 0.249, "time_value": 0.009, "stock_excess_60": -0.0134, "t_stock": 0.21},
]
PNL_BIG_GAIN, PNL_DEEP_LOSS = 1.0, -0.5
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
    dates: Sequence[str] = ()                # dates of `closes` (YYYY-MM-DD); aligns the VIX for the IV model
    vix_dates: Sequence[str] = ()
    legs: Sequence[Dict[str, Any]] = ()      # held options: otype, strike, expiry, dte, iv, mark, quantity, avg_price
    shares: float = 0.0                      # shares held, with their average cost
    held: bool = True                        # False: a ticker you don't hold (Buy / Wait / Don't buy yet)
    symbol: str = ""
    avg_cost: Optional[float] = None
    rate: float = 0.045


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
    iv_model: Optional[float] = None         # modelled 30-day IV now (the backtest's)
    iv_normal: Optional[float] = None        # its 5-year average
    iv_ratio: Optional[float] = None
    legs: List[Dict[str, Any]] = field(default_factory=list)   # per held option: dte, iv, theta, decay, roll
    probability: Optional[Dict[str, Any]] = None               # PROBS for this setup (`case`), from the backtest
    pnl: Optional[Dict[str, Any]] = None                       # the holding's P&L and its tested risk (never the verdict)
    fear_score: Optional[float] = None                         # 0 … 1; ADD at ≥ SCORE_CUT
    plan: Optional[Dict[str, Any]] = None                      # prices: buy / add trigger, VIX trigger, upside, exit line


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


# ── options: IV model and per-leg time decay ─────────────────────────────────
def iv_model(closes: Sequence[float], vix: Sequence[float], dates: Sequence[str] = (),
             vix_dates: Sequence[str] = ()) -> tuple:
    """(IV30 now, its 5-year normal, ratio) from the backtest's IV model, or (None, None, None) without history."""
    try:
        import numpy as np
        import pandas as pd
    except ImportError:                                    # pragma: no cover
        return None, None, None
    c = pd.Series([float(x) for x in closes], dtype=float)
    v = pd.Series([float(x) for x in vix], dtype=float)
    if len(c) < IV_NORMAL_MIN + 252 or len(v) < 252:
        return None, None, None
    vrel = v / v.rolling(252).median()
    if dates and vix_dates and len(dates) == len(c) and len(vix_dates) == len(v):
        vrel = pd.Series(vrel.values, index=list(vix_dates)).groupby(level=0).last()
        vrel = vrel.reindex(sorted(set(vrel.index) | set(dates))).ffill().reindex(list(dates)).reset_index(drop=True)
    else:                                                  # no dates: align the tails
        vrel = pd.Series(vrel.values[-len(c):] if len(v) >= len(c) else
                         np.concatenate([np.full(len(c) - len(v), np.nan), vrel.values]))
    lr = np.log(c).diff()
    hv = {n: lr.rolling(n).std() * math.sqrt(252) for n in (20, 60, 252)}
    a = IV_COEF
    iv = np.exp(a[0] + a[1] * np.log(hv[20]) + a[2] * np.log(hv[60]) + a[3] * np.log(hv[252]) + a[4] * np.log(vrel))
    normal = iv.rolling(IV_NORMAL_DAYS, min_periods=IV_NORMAL_MIN).mean()
    now, base = iv.iloc[-1], normal.iloc[-1]
    if not (now == now and base == base and base > 0):
        return None, None, None
    return float(now), float(base), float(now / base)


def iv_at(iv30: float, normal: float, days: float) -> float:
    """The backtest's term structure: IV for an option `days` out from the 30-day IV and its long-run normal."""
    def g(T: float) -> float:
        return (1 - math.exp(-TERM_KAPPA * T)) / (TERM_KAPPA * T)
    return normal + (iv30 - normal) * g(max(days, 30) / 365) / g(1 / 12)


def leg_decay(spot: float, leg: Dict[str, Any], iv_fallback: Optional[float], r: float,
              model: Optional[tuple] = None) -> Optional[Dict[str, Any]]:
    """Time decay of one held option at today's price and IV: share of its value lost per 20 trading days, $/day.
    IV: the contract's own, else `model` (IV30, normal) at the contract's time left, else `iv_fallback` (ATM)."""
    from optionflow.modules.hedge import bs
    k, dte, ot = leg.get("strike"), leg.get("dte"), leg.get("otype")
    src = "chain"
    iv = leg.get("iv") if (leg.get("iv") or 0) > bs.MIN_SIGMA else None
    if iv is None and model and model[0] and model[1] and dte is not None:
        iv, src = iv_at(model[0], model[1], dte), "model"
    if iv is None:
        iv, src = iv_fallback, "atm"
    if not k or dte is None or not ot or not iv:
        return None
    T = bs.year_fraction(dte)
    p0 = bs.price(spot, k, T, iv, ot, r)
    if p0 <= 0:
        return None
    p20 = bs.price(spot, k, bs.year_fraction(dte - DECAY_DAYS), iv, ot, r)
    p1 = bs.price(spot, k, bs.year_fraction(dte - 1), iv, ot, r)
    intrinsic = max(spot - k, 0.0) if ot == "call" else max(k - spot, 0.0)
    q = abs(leg.get("quantity") or 1)
    decay = 1.0 - p20 / p0
    return {"label": f"{k:g}{'C' if ot == 'call' else 'P'} {leg.get('expiry') or ''}".strip(), "dte": round(dte),
            "iv": round(iv, 4), "delta": round(bs.delta(spot, k, T, iv, ot, r), 3), "value": round(p0, 2),
            "extrinsic_pct": round(max(p0 - intrinsic, 0.0) / p0, 3), "theta_day": round((p0 - p1) * 100 * q, 2),
            "decay_20d": round(decay, 4), "roll": dte <= EXPIRY_ROLL, "warn": EXPIRY_ROLL < dte <= EXPIRY_WARN,
            "iv_source": src}


def position_pnl(t: Tape, pairs: List[tuple]) -> Optional[Dict[str, Any]]:
    """The holding's P&L and, for long options, the backtest's 60-day risk for that P&L. Shares or long options.
    `pairs`: (held leg, its leg_decay or None); a leg's value is its quote, else the model's."""
    opts = []
    for raw, d in pairs:
        q, cost = raw.get("quantity") or 0, raw.get("avg_price")
        if q <= 0 or not cost:
            continue
        value = raw.get("mark") if (raw.get("mark") or 0) > 0 else (d["value"] if d else None)
        if value is not None:
            opts.append((q, cost, value))
    if opts:
        paid = sum(q * c for q, c, _ in opts)
        now = sum(q * v for q, _, v in opts)
        pct = now / paid - 1.0
        row = next((r for r in PNL_RISK if r["lo"] < pct <= r["hi"]), PNL_RISK[0] if pct <= -1 else PNL_RISK[-1])
        if pct >= PNL_BIG_GAIN:
            note = (f"Up {pct:.0%} on what you paid. Your P&L doesn't predict the stock (tested), but at this size a bad 60 days "
                    f"has given back a lot: {row['p_lose_25_paid']:.0%} of such positions lost more than 25% of the original premium, "
                    f"the worst 1 in 20 lost {-row['p5_paid']:.0%} of it. Taking some off is a risk choice, not an edge; "
                    "same-delta rolls lost to holding after costs.")
        elif pct <= PNL_DEEP_LOSS:
            note = (f"Down {-pct:.0%} on what you paid. About {row['time_value']:.0%} of what's left is time value, which decays; "
                    "your P&L doesn't predict the stock, and fear-dip adds still worked at this P&L.")
        else:
            note = (f"{'Up' if pct >= 0 else 'Down'} {abs(pct):.0%} on what you paid. Your P&L doesn't predict the stock (tested); "
                    f"next 60 days at this P&L: {row['p_gain_25_paid']:.0%} gained and {row['p_lose_25_paid']:.0%} lost more than 25% "
                    "of the original premium.")
        return {"kind": "options", "pct": round(pct, 4), "dollars": round((now - paid) * 100, 2), "cost": round(paid * 100, 2),
                "bucket": row["label"], "p_lose_25_paid": row["p_lose_25_paid"], "p_gain_25_paid": row["p_gain_25_paid"],
                "p5_paid": row["p5_paid"], "cases": row["cases"], "note": note}
    if t.shares > 0 and t.avg_cost:
        pct = t.spot / t.avg_cost - 1.0
        return {"kind": "shares", "pct": round(pct, 4), "dollars": round((t.spot - t.avg_cost) * t.shares, 2),
                "cost": round(t.avg_cost * t.shares, 2), "bucket": None, "p_lose_25_paid": None, "p_gain_25_paid": None,
                "p5_paid": None, "cases": None,
                "note": f"{'Up' if pct >= 0 else 'Down'} {abs(pct):.0%} vs your average {t.avg_cost:,.2f}. Gains or losses since you "
                        "bought didn't predict the stock in the backtest, so they don't change the verdict."}
    return None


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
    fs = fear_score(vp, r14)
    m50, m200 = sma(px, 50), sma(px, 200)
    hi52 = max(px[-252:]) if px else None
    dd52 = t.spot / hi52 - 1.0 if hi52 else None
    fear_dip = fs is not None and fs >= SCORE_CUT
    calm = vp is not None and vp < CALM_VIX
    knife = calm and dd52 is not None and dd52 <= KNIFE_DD
    stretched = calm and m50 is not None and r14 is not None and 0.03 <= t.spot / m50 - 1.0 <= 0.15 and r14 > 65
    long = exposure >= 0
    iv_now, iv_norm, ivr = iv_model(px, t.vix, list(t.dates) + ([] if t.today_bar else ["9999-12-31"]) if t.dates else (),
                                    t.vix_dates)
    live_ratio = (t.atm_iv / iv_norm) if (t.atm_iv and iv_norm) else None
    iv_ratio = min(ivr, live_ratio) if (ivr is not None and live_ratio is not None) else ivr      # context only
    longs = [l for l in t.legs if (l.get("quantity") or 0) > 0]           # decay / P&L: only what you own
    pairs = [(l, leg_decay(t.spot, l, t.atm_iv, t.rate, (iv_now, iv_norm))) for l in longs]
    legs = [d for _, d in pairs if d]
    expiring = [d for d in legs if d["roll"]]
    if long:
        verdict = "ADD" if fear_dip else "CAUTION" if (knife or stretched) else "HOLD"
    else:
        verdict = "TRIM" if fear_dip else "HOLD"
    lean = long and verdict == "HOLD" and r14 is not None and r14 < ADD_RSI and vp is not None
    case = ("TRIM" if verdict == "TRIM" else "ADD" if verdict == "ADD" else "CAUTION" if verdict == "CAUTION"
            else "LEAN" if lean else "HOLD")
    if expiring and verdict != "TRIM":
        verdict = "ROLL"

    lv, em = levels(t, px)
    sup, res = _nearest(lv, t.spot, True), _nearest(lv, t.spot, False)
    stop = round(m200, 2) if (calm and m200 and long and t.held and t.spot > m200) else None
    add_at, target = ((sup["price"] if sup else None), (res["price"] if res else None)) if long else \
                     ((res["price"] if res else None), (sup["price"] if sup else None))
    pl = plan(t, px, vp, r14, fs, case, long, sup, res, m200, calm, hi52, knife, stretched, legs)
    if pl.get("buy_below") is not None:
        add_at = pl["buy_below"]

    buy, held = (not t.held), t.held
    trig = pl.get("trigger_text")
    if verdict == "ROLL":
        worst = min(expiring, key=lambda d: d["dte"])
        head = f"Roll or close the {worst['label']}: {worst['dte']} days left (expiry, not decay); roll to {ADD_MIN_DTE}+ days"
        if fear_dip:
            head += " (fear dip: a good moment to roll and add)"
    elif verdict == "ADD":
        head = (f"{'Buy' if buy else 'Add'}: fear dip (score {fs:.2f} ≥ {SCORE_CUT:.2f}); a third now, the next ≥ {TRANCHE_GAP} "
                f"trading days later if it holds; calls {ADD_MIN_DTE}+ days ~{ADD_DELTA:.2f}Δ, hold {ADD_HOLD_DAYS}+ trading days")
    elif verdict == "CAUTION":
        why = "stock-specific weakness in a calm market" if knife else "stretched in a calm market"
        head = f"{'Don’t buy yet' if buy else 'Don’t add'}: {why}" + (f"; clears {pl['clears_text']}" if pl.get("clears_text") else "")
    elif verdict == "TRIM":
        head = "Take profit on the puts: fear dip, rebounds are likely"
    elif lean:
        head = (f"{'Wait' if buy else 'Hold'}: oversold (RSI {r14:.0f}) but the market isn't scared enough "
                f"(VIX {vp:.0%} pct)") + (f". {'Buy' if buy else 'Add'} {trig}" if trig else "")
    elif not long:
        head = "Hold the puts: no fear dip" + (f" · take profit {trig}" if trig else "")
    else:
        head = (f"{'Wait' if buy else 'Hold'}: no edge right now") + (f". {'Buy' if buy else 'Add'} {trig}" if trig else "")
    if vp is None or r14 is None:
        head += " (no VIX / history: verdict not tested)"

    return Signal(score, bias, verdict, "long" if long else "short", head, sup, res, stop, add_at, target,
                  [{"key": r.key, "score": round(r.score, 2), "weight": WEIGHTS[r.key], "value": r.value, "note": r.note,
                    "tested": r.key in TESTED} for r in reads], lv, em, _r(vp),
                  EVIDENCE[case if verdict != "ROLL" else "ROLL"],
                  _r(iv_now), _r(iv_norm), _r(iv_ratio), legs,
                  dict(PROBS[case], case=case) if (vp is not None and r14 is not None) else None,
                  position_pnl(t, pairs), _r(fs), pl)


def fear_score(vp: Optional[float], r14: Optional[float]) -> Optional[float]:
    """0 … 1: market fear (VIX percentile over its median) × how oversold the stock is (RSI under 50)."""
    if vp is None or r14 is None:
        return None
    return _clip((vp - 0.5) / 0.5, 0.0, 1.0) ** 1.5 * _clip((50.0 - r14) / 30.0, 0.0, 1.0)


def vix_at_pct(vix: Sequence[float], p: float) -> Optional[float]:
    """About the VIX close that would rank at percentile `p` of the last year."""
    v = sorted(float(x) for x in list(vix)[-252:] if _ok(x))
    if len(v) < 126 or not 0 < p <= 1:
        return None
    return v[min(len(v) - 1, max(0, math.ceil(p * len(v)) - 1))]


def price_for_rsi(prior: Sequence[float], target: float, spot: float) -> Optional[float]:
    """The highest close today that puts RSI(14) at or under `target` (`prior`: closes before today). None if out of reach."""
    now = rsi(list(prior) + [spot])
    if now is None:
        return None
    if now <= target:
        return spot
    lo, hi = spot * 0.3, spot
    if (rsi(list(prior) + [lo]) or 100) > target:
        return None
    for _ in range(40):
        mid = (lo + hi) / 2
        if (rsi(list(prior) + [mid]) or 100) <= target:
            lo = mid
        else:
            hi = mid
    return lo


def plan(t: Tape, px: List[float], vp: Optional[float], r14: Optional[float], fs: Optional[float], case: str, long: bool,
         sup: Optional[Dict[str, Any]], res: Optional[Dict[str, Any]], m200: Optional[float], calm: bool,
         hi52: Optional[float], knife: bool, stretched: bool, legs: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Prices for the decision: when it would turn ADD (by price, by VIX), the upside, the exit line, what clears a
    CAUTION, and the covered-call adjustment. `lines`: the plain-language plan, held or not."""
    out: Dict[str, Any] = {"lines": []}
    L = out["lines"]
    buy = not t.held
    verb = "Buy" if buy else "Add"
    if vp is None or r14 is None or fs is None:
        return out
    fv = _clip((vp - 0.5) / 0.5, 0.0, 1.0) ** 1.5
    fr = _clip((50.0 - r14) / 30.0, 0.0, 1.0)
    parts = []
    if case not in ("ADD", "TRIM"):
        if fv >= SCORE_CUT:                                      # price alone can get there at today's VIX
            need_rsi = 50.0 - 30.0 * (SCORE_CUT / fv)
            p = price_for_rsi(px[:-1], need_rsi, t.spot)
            if p and p < t.spot:
                out.update(buy_below=round(p, 2), buy_rsi=round(need_rsi, 1))
                parts.append(f"if {t.symbol or 'it'} closes ≤ {_px(p)} ({p / t.spot - 1:+.1%}, RSI ≤ {need_rsi:.0f}) with the VIX where it is")
        if fr > 0:
            need_p = 0.5 + 0.5 * (SCORE_CUT / fr) ** (2 / 3)
            vx = vix_at_pct(t.vix, need_p) if need_p <= 1 else None
            if vx and t.vix and vx > float(t.vix[-1]):
                out.update(vix_trigger=round(vx, 2), vix_pct_needed=round(need_p, 3))
                parts.append(f"if the VIX closes ≥ {vx:.1f} (now {float(t.vix[-1]):.1f}) with the price here")
        if parts:
            out["trigger_text"] = " or ".join(parts)
        elif fr == 0:
            out["trigger_text"] = f"once RSI is under 50 (now {r14:.0f}) and the VIX is above its median"
    if not long:                                                 # long puts / net short
        L.append("Take profit on the puts if " + (out.get("trigger_text") or "a fear dip comes") + ": on fear dips held puts lost "
                 "7.9–11.1% of value vs an average day over 60 days (2015–2026).")
        return out
    if case == "ADD":
        L.append(f"{verb} in thirds: one third now, the next ≥ {TRANCHE_GAP} trading days later only if the signal is still on, at most "
                 f"{TRANCHES}. In 2008 and 2022 this kept the loss to about a fifth of going in all at once.")
    elif out.get("trigger_text"):
        L.append(f"{verb} signal {out['trigger_text']}.")
    if sup:
        L.append(f"Nearest support {_px(sup['price'])} ({sup['label']}, {sup['distance']:+.1%})"
                 + (": a level, not a tested buy point." if case != "ADD" else "."))
    if case == "CAUTION":
        clears = []
        if knife and hi52:
            clears.append(f"above {_px(hi52 * (1 + KNIFE_DD))} (within 10% of the 52-week high)")
        if stretched:
            clears.append("once RSI cools under 65")
        lvl = vix_at_pct(t.vix, CALM_VIX)
        if lvl:
            clears.append(f"or if the VIX closes ≥ {lvl:.1f} (market no longer calm)")
        out["clears_text"] = " ".join(clears)
        L.append(f"{'Don’t buy yet' if buy else 'Don’t add'}: clears {out['clears_text']}.")
    if t.held:
        if res:
            out["upside"] = res["price"]
            L.append(f"Upside: resistance {_px(res['price'])} ({res['label']}, {res['distance']:+.1%}). Hold through it: strength "
                     "didn't predict falls in the backtest, so there is no tested sell price; trimming there is a risk choice.")
        if m200 and calm and t.spot > m200:
            out["exit_below"] = round(m200, 2)
            L.append(f"Exit line: a close under the 200-day ({_px(m200)}, {m200 / t.spot - 1:+.1%}) while the market is calm came "
                     f"before {EXIT_DROP_60:+.1%} vs holding over 60 days (t −2.8). Weak edge: a reason to cut, not a crash call.")
        elif m200 and calm:
            out["exit_below"] = round(m200, 2)
            L.append(f"Under the 200-day ({_px(m200)}) in a calm market: such days ran −1.5% vs holding over 60 days (t −2.5). "
                     f"Reclaiming {_px(m200)} clears it.")
        elif m200 and vp >= ADD_VIX:
            L.append(f"No exit on breaks while the market is scared: closes under the 200-day ({_px(m200)}) during fear came "
                     "before +3.6% vs holding over 60 days.")
        elif m200:
            L.append(f"Exit line: the 200-day ({_px(m200)}, {m200 / t.spot - 1:+.1%}) once the market calms (VIX under its 60th pct).")
        shorts = [l for l in t.legs if (l.get("quantity") or 0) < 0 and l.get("otype") == "call"]
        if t.shares > 0 or shorts:
            if case == "ADD" or (vp >= ADD_VIX and r14 < ADD_RSI):
                out["covered_call"] = "0.15"
                L.append("Covered calls: on a fear dip sell 0.15Δ instead of 0.30Δ (+0.33% of the stock a month, t 3.9) or skip "
                         "the month (+0.23%, t 2.8); 0.50Δ cost −0.85%.")
            elif case == "CAUTION":
                out["covered_call"] = "0.30"
                L.append("Covered calls: keep 0.30Δ or further; going closer to the money (0.50Δ) paid −0.24% a month vs 0.30Δ "
                         "in calm weakness (t −1.8).")
            else:
                out["covered_call"] = "0.30"
                L.append("Covered calls: 0.30Δ as usual; 0.50Δ ran −0.39% of the stock a month vs 0.30Δ across all days.")
        if legs:
            L.append("Long calls: time decay alone is not a reason to roll (same-delta rolls lost ~4% of the position to costs "
                     f"at every days-left 90–365); decide inside {EXPIRY_ROLL} days of expiry.")
    return out


def _r(x: Optional[float]) -> Optional[float]:
    return None if x is None else round(x, 3)


def reasons(sig: Signal) -> List[str]:
    """Plain-language lines for the desk's ticket: the plan (prices) first, then the odds and the reads."""
    out = list((sig.plan or {}).get("lines") or [])
    if sig.evidence:
        out.append(sig.evidence)
    p = sig.probability
    if p:
        if sig.side == "long":
            out.insert(0, f"Odds (2015–2026, unseen): stock up in 60 days {p['p_up_60']:.0%}, beats holding {p['p_beat_60']:.0%}"
                          + (f", a 365-day call profits {p['p_option_profit_60']:.0%}" if p.get("p_option_profit_60") is not None else "")
                          + f"; chance the average edge is above zero {p['p_edge_positive']:.0%} "
                          f"(avg {p['edge_60']:+.1%}, 90% range {p['edge_lo']:+.1%} to {p['edge_hi']:+.1%}).")
        else:
            out.insert(0, f"Odds (2015–2026, unseen): stock up in 60 days {p['p_up_60']:.0%} (bad for the puts); "
                          f"chance that tilt is real {p['p_edge_positive']:.0%}.")
    if sig.fear_score is not None:
        out.append(f"Fear score {sig.fear_score:.2f} (ADD at ≥ {SCORE_CUT:.2f}): VIX percentile × how oversold the stock is.")
    if sig.pnl:
        out.append(sig.pnl["note"])
    if sig.iv_ratio is not None:
        out.append(f"Stock IV {sig.iv_ratio:.2f}× its 5-year normal ({sig.iv_normal:.0%}; model now {sig.iv_model:.0%}). "
                   "Context only: an IV gate chosen on 1995–2014 data added nothing.")
    for d in sig.legs:
        tag = " → roll or close" if d["roll"] else " → expiry within 60 days" if d["warn"] else ""
        out.append(f"{d['label']}: {d['dte']} days left, IV {d['iv']:.0%}{' (model: no quote)' if d['iv_source'] == 'model' else ''}, Δ {d['delta']:.2f}, "
                   f"{d['extrinsic_pct']:.0%} time value; loses {d['decay_20d']:.1%} per 20 trading days "
                   f"(${abs(d['theta_day']):,.0f}/day){tag}.")
    if sig.support or sig.resistance:
        parts = []
        if sig.support:
            parts.append(f"support {_px(sig.support['price'])} ({sig.support['label']}, {sig.support['distance']:+.1%})")
        if sig.resistance:
            parts.append(f"resistance {_px(sig.resistance['price'])} ({sig.resistance['label']}, {sig.resistance['distance']:+.1%})")
        out.append("Levels: " + "; ".join(parts) + ".")
    if sig.expected_move:
        out.append(f"Expected move from IV: ±{_px(sig.expected_move['day'])} today, ±{_px(sig.expected_move['week'])} this week.")
    out += [r["note"] for r in sig.reads if r["tested"]]
    out += [r["note"] + " (context, not in the verdict)" for r in sig.reads if not r["tested"]]
    return out
