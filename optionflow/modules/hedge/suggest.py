"""optionflow/modules/hedge/suggest.py — the delta-neutral indicator (pure, no I/O).

Units: delta and gamma in LOTS (100 shares = +1.00 delta). A short call with delta 0.70 is
-0.70 per contract; a short put with delta -0.30 is +0.30 per contract.

The engine
1. Net delta / gamma of the holding: shares/100 + Σ contracts × option delta.
2. Regime → target net delta per lot held:
   - bull (dealer GEX ≥ 0 and IV/HV < HIGH_VOL_RATIO): TARGET_BULL (+0.30)
   - high-vol / bear (GEX < 0 or IV/HV ≥ HIGH_VOL_RATIO): TARGET_NEUTRAL (0.00)
3. gap = target − net. Within ±BAND per lot → HOLD.
   - gap < 0 (too long): SELL_CALL on the weekly expiry, strike ≥ average cost (never lock a loss),
     only when the stock is above average cost AND (IV spike OR up ≥ RISE_TRIGGER over average).
     Strike = the one whose delta best matches the gap per contract, preferring the GEX king node.
     Needs uncovered lots; if none are left, BUY_PUT is suggested instead.
   - gap > 0 (too short, e.g. the short call went deep ITM): SELL_PUT, but never during an IV spike
     (protocol §4); prefer the put wall / support, delta sized to the gap.
   - otherwise WAIT, with the reason.
Note: a SHORT put ADDS delta. It brings the book back toward target only when net < target.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field, asdict
from typing import List, Optional

from optionflow.modules.hedge import bs

TARGET_BULL = 0.30
TARGET_NEUTRAL = 0.0
HIGH_VOL_RATIO = 1.30     # ATM IV / HV20 at or above this = high-vol regime
BAND = 0.15               # per lot: |gap| within this = on target
RISE_TRIGGER = 0.02       # stock ≥ 2% over average cost
MIN_DTE, MAX_DTE = 2, 9   # weekly runway; avoid 0–1 DTE gamma traps (protocol §3)
PUT_PULLBACK = 0.01       # ≥ 1% off the intraday high counts as a pullback
NEAR_LEVEL = 0.02         # within 2% of the put wall counts as "at support"


@dataclass
class Leg:
    kind: str                       # "stock" | "option"
    quantity: float                 # signed: shares, or contracts
    avg_price: Optional[float] = None
    otype: Optional[str] = None     # "call" | "put"
    strike: Optional[float] = None
    expiry: Optional[str] = None
    dte: Optional[float] = None
    iv: Optional[float] = None
    # filled by greeks()
    delta: float = 0.0              # per one long option, per share
    gamma: float = 0.0
    position_delta: float = 0.0     # lots
    position_gamma: float = 0.0     # lots per $1


@dataclass
class Quote:
    """One contract of the target weekly expiry."""
    strike: float
    otype: str
    iv: Optional[float]
    bid: Optional[float]
    ask: Optional[float]
    mid: Optional[float]
    dte: float
    expiry: str
    delta: float = 0.0              # filled by the engine at the current spot


@dataclass
class Context:
    symbol: str
    spot: float
    avg_cost: Optional[float]
    day_change: Optional[float] = None      # decimal, +0.02 = +2%
    day_high: Optional[float] = None
    atm_iv: Optional[float] = None
    hv20: Optional[float] = None
    iv_spike: bool = False
    iv_cooling: bool = False
    net_gex: Optional[float] = None
    king: Optional[float] = None
    put_wall: Optional[float] = None
    call_wall: Optional[float] = None


@dataclass
class Suggestion:
    action: str                     # SELL_CALL | SELL_PUT | BUY_PUT | HOLD | WAIT | TRACK
    headline: str
    reasons: List[str] = field(default_factory=list)
    strike: Optional[float] = None
    expiry: Optional[str] = None
    otype: Optional[str] = None
    contracts: int = 0
    option_delta: Optional[float] = None    # per contract, signed as held after the trade (lots)
    premium: Optional[float] = None         # mid, per share
    credit: Optional[float] = None          # $ total (+ received, − paid)
    net_delta_after: Optional[float] = None
    locked_gain: Optional[float] = None     # covered call: (strike − avg + premium) × shares if called
    warnings: List[str] = field(default_factory=list)


@dataclass
class Book:
    symbol: str
    shares: float
    avg_cost: Optional[float]
    lots: float
    net_delta: float
    net_gamma: float               # lots per $1 move
    dollar_gamma_1pct: float       # $ change in position delta-dollars per 1% move
    target_delta: float
    regime: str                    # "bull" | "high-vol"
    gap: float
    iv_hv: Optional[float]
    legs: List[Leg]
    suggestion: Suggestion

    def to_dict(self) -> dict:
        return asdict(self)


# ── Greeks ────────────────────────────────────────────────────────────────────
def greeks(legs: List[Leg], spot: float) -> None:
    for leg in legs:
        if leg.kind == "stock":
            leg.delta, leg.gamma = 1.0, 0.0
            leg.position_delta = leg.quantity / 100.0
            leg.position_gamma = 0.0
            continue
        T = bs.year_fraction(leg.dte or 0.0)
        leg.delta = bs.delta(spot, leg.strike or 0.0, T, leg.iv or 0.0, leg.otype or "call")
        leg.gamma = bs.gamma(spot, leg.strike or 0.0, T, leg.iv or 0.0)
        leg.position_delta = leg.quantity * leg.delta
        leg.position_gamma = leg.quantity * leg.gamma      # contracts × per-share gamma = lots per $1


def _r(x: Optional[float], n: int = 3) -> Optional[float]:
    return None if x is None or not math.isfinite(x) else round(x, n)


# ── Engine ────────────────────────────────────────────────────────────────────
def evaluate(ctx: Context, legs: List[Leg], weekly: List[Quote]) -> Book:
    spot = ctx.spot
    greeks(legs, spot)
    shares = sum(l.quantity for l in legs if l.kind == "stock")
    lots = shares / 100.0
    net = sum(l.position_delta for l in legs)
    ngam = sum(l.position_gamma for l in legs)
    dollar_gamma = ngam * 100.0 * spot * spot * 0.01      # Δ(delta-$) per 1% move
    iv_hv = (ctx.atm_iv / ctx.hv20) if ctx.atm_iv and ctx.hv20 else None
    high_vol = (ctx.net_gex is not None and ctx.net_gex < 0) or (iv_hv is not None and iv_hv >= HIGH_VOL_RATIO)
    regime = "high-vol" if high_vol else "bull"
    per_lot = TARGET_NEUTRAL if high_vol else TARGET_BULL
    full_lots = math.floor(shares / 100.0 + 1e-9)
    target = per_lot * full_lots
    gap = target - net

    for q in weekly:
        q.delta = bs.delta(spot, q.strike, bs.year_fraction(q.dte), q.iv or 0.0, q.otype)

    warnings = _gamma_warnings(legs)
    if full_lots < 1:
        s = Suggestion("TRACK", "Tracking only: no full 100-share lot held",
                       ["Suggestions are sized against 100-share lots."], warnings=warnings)
    elif abs(gap) <= BAND * full_lots:
        s = Suggestion("HOLD", f"On target: net delta {net:+.2f} vs {target:+.2f}",
                       [f"{regime} regime → target {per_lot:+.2f} per lot."], warnings=warnings)
    elif gap < 0:
        s = _reduce_delta(ctx, legs, weekly, net, target, full_lots, regime, warnings)
    else:
        s = _add_delta(ctx, weekly, net, target, regime, warnings)

    return Book(ctx.symbol, shares, ctx.avg_cost, lots, _r(net), _r(ngam, 5), _r(dollar_gamma, 2),
                _r(target), regime, _r(gap), _r(iv_hv), legs, s)


def _gamma_warnings(legs: List[Leg]) -> List[str]:
    out = []
    for l in legs:
        if l.kind == "option" and l.quantity < 0 and l.dte is not None and l.dte <= 1:
            out.append(f"Short {l.otype} {l.strike:g} expires in ≤1 day: gamma trap, manage actively.")
    return out


def _pick(cands: List[Quote], want: float, prefer: Optional[float], tol: float = 0.15) -> Optional[Quote]:
    """Quote whose |delta| is closest to `want`; the preferred strike wins if within `tol`."""
    if not cands:
        return None
    best = min(cands, key=lambda q: abs(abs(q.delta) - want))
    if prefer is not None:
        pref = [q for q in cands if abs(q.strike - prefer) < 1e-6]
        if pref and abs(abs(pref[0].delta) - want) <= tol:
            return pref[0]
    return best


def _reduce_delta(ctx: Context, legs: List[Leg], weekly: List[Quote], net: float, target: float,
                  full_lots: int, regime: str, warnings: List[str]) -> Suggestion:
    avg = ctx.avg_cost
    short_calls = -sum(l.quantity for l in legs if l.kind == "option" and l.otype == "call" and l.quantity < 0)
    free = int(full_lots - short_calls)
    need = net - target                         # delta to remove (> 0)
    reasons = [f"Net delta {net:+.2f} is above the {regime} target {target:+.2f}."]

    if free < 1:
        puts = [q for q in weekly if q.otype == "put" and q.strike <= ctx.spot and (q.ask or 0) > 0]
        n = max(1, round(need / 0.5))
        q = _pick(puts, min(need / n, 0.9), ctx.put_wall)
        if not q:
            return Suggestion("WAIT", "Too long, but every lot already has a covered call", reasons, warnings=warnings)
        return Suggestion("BUY_PUT", f"Buy {n} {q.strike:g}P {q.expiry} to cut delta",
                          reasons + ["All lots are already covered; a long put removes delta without naked calls."],
                          q.strike, q.expiry, "put", n, _r(q.delta), _r(q.mid, 2),
                          _r(-(q.mid or 0) * 100 * n, 2), _r(net + n * q.delta), warnings=warnings)

    if avg is None or ctx.spot <= avg:
        return Suggestion("WAIT", "Too long, but price is at/below average cost",
                          reasons + [f"Calls below your ${avg or 0:.2f} average would lock in a loss; wait for a rise or an IV spike."],
                          warnings=warnings)
    rise = ctx.spot / avg - 1.0
    if not (ctx.iv_spike or rise >= RISE_TRIGGER):
        return Suggestion("WAIT", f"Stock +{rise:.1%} over average; waiting for +{RISE_TRIGGER:.0%} or an IV spike",
                          reasons, warnings=warnings)

    hi = max(ctx.spot, ctx.king or ctx.spot)
    calls = [q for q in weekly if q.otype == "call" and avg <= q.strike <= hi and (q.bid or 0) > 0]
    if not calls:
        return Suggestion("WAIT", "No weekly call between average cost and spot/king has a bid", reasons, warnings=warnings)
    n = min(free, max(1, math.ceil(need - 1e-9)))
    want = min(max(need / n, 0.3), 0.95)
    q = _pick(calls, want, ctx.king)
    if ctx.iv_spike:
        reasons.append("ATM IV is spiking on an up-move: premium is inflated, harvest it now (protocol §1–2).")
    else:
        reasons.append(f"Stock is {rise:+.1%} over your average.")
    if ctx.king is not None and abs(q.strike - ctx.king) < 1e-6:
        reasons.append(f"Strike = GEX king node {ctx.king:g} (price tends to pin there into expiry).")
    reasons.append("Selling ITM/ATM calls caps the stock; the edge is the IV crush, not direction.")
    if abs(q.delta) < want - 0.1 and q.strike <= min(c.strike for c in calls) + 1e-6:
        reasons.append(f"Capped by your average: the deepest strike at/above ${avg:.2f} only removes Δ {q.delta:.2f} per contract.")
    prem = q.mid or q.bid or 0.0
    locked = ((q.strike - avg) + prem) * 100 * n
    return Suggestion("SELL_CALL", f"Sell {n} {q.strike:g}C {q.expiry} (Δ {q.delta:.2f})",
                      reasons, q.strike, q.expiry, "call", n, _r(-q.delta), _r(prem, 2),
                      _r(prem * 100 * n, 2), _r(net - n * q.delta), _r(locked, 2), warnings=warnings)


def _add_delta(ctx: Context, weekly: List[Quote], net: float, target: float, regime: str,
               warnings: List[str]) -> Suggestion:
    need = target - net
    reasons = [f"Net delta {net:+.2f} is below the {regime} target {target:+.2f} (a short put adds delta)."]
    if ctx.iv_spike:
        return Suggestion("WAIT", "Below target, but IV is spiking: don't sell puts into the spike",
                          reasons + ["Protocol §4: wait for the pullback and cooling IV."], warnings=warnings)
    pulled_back = (ctx.day_high and ctx.spot <= ctx.day_high * (1 - PUT_PULLBACK)) or (ctx.day_change is not None and ctx.day_change < 0)
    at_support = ctx.put_wall is not None and ctx.spot <= ctx.put_wall * (1 + NEAR_LEVEL)
    if not (pulled_back or at_support or ctx.iv_cooling):
        return Suggestion("WAIT", "Below target; waiting for a pullback toward support",
                          reasons, warnings=warnings)
    puts = [q for q in weekly if q.otype == "put" and q.strike <= ctx.spot and (q.bid or 0) > 0]
    if not puts:
        return Suggestion("WAIT", "No weekly put at/below spot has a bid", reasons, warnings=warnings)
    n = max(1, round(need / 0.35))
    q = _pick(puts, min(need / n, 0.5), ctx.put_wall)
    if pulled_back:
        reasons.append("Stock has pulled back; buying pressure is cooling.")
    if ctx.put_wall is not None and abs(q.strike - ctx.put_wall) < 1e-6:
        reasons.append(f"Strike = put wall {ctx.put_wall:g} (dealer support).")
    reasons.append(f"Cash-secured: needs ${q.strike * 100 * n:,.0f} set aside; assignment adds shares at a discount.")
    prem = q.mid or q.bid or 0.0
    return Suggestion("SELL_PUT", f"Sell {n} {q.strike:g}P {q.expiry} (Δ {q.delta:.2f})",
                      reasons, q.strike, q.expiry, "put", n, _r(-q.delta), _r(prem, 2),
                      _r(prem * 100 * n, 2), _r(net - n * q.delta), warnings=warnings)


def pick_weekly(expiries_dte: List[tuple]) -> Optional[str]:
    """Nearest expiry with MIN_DTE ≤ dte ≤ MAX_DTE, else the nearest with dte ≥ MIN_DTE."""
    ok = sorted((d, e) for e, d in expiries_dte if MIN_DTE <= d <= MAX_DTE)
    if ok:
        return ok[0][1]
    later = sorted((d, e) for e, d in expiries_dte if d >= MIN_DTE)
    return later[0][1] if later else None
