"""optionflow/modules/hedge/suggest.py — the wheel-on-spikes indicator (pure, no I/O).

Units: delta and gamma in LOTS (100 shares = +1.00 delta). A short call with delta 0.70 is
-0.70 per contract; a short put with delta -0.30 is +0.30 per contract.

The owner's playbook (2026-11-08): only ever SELL a call, SELL a put, or BUY stock. Never buy options.
1. Net delta / gamma of the holding: shares/100 + Σ contracts × option delta. Always shown, whatever
   legs are on, so you see the real exposure.
2. Reference = +1.00 per full lot (the stock alone). The book is NOT kept delta-neutral: the trades keep
   it near +1 per lot while the premium is harvested.
3. Spike (stock ≥ RISE_TRIGGER over average, or an ATM IV spike on an up-move), with uncovered lots
   → SELL_CALL in the money, at the strike closest to the average cost from above (never below it).
   That captures the spike: if called, the shares go at or above average plus the premium.
4. Pullback (≥ PUT_PULLBACK off the day's high, a red day, or IV cooling), never during an IV spike,
   with put capacity left → SELL_PUT at the highest strike BELOW the average cost (and at/below spot).
   If both legs are assigned, the shares are sold at ≥ average and bought back below it.
5. An odd lot below 100 shares → BUY_STOCK to round it up to a full lot when the price is at/below
   the average (lowers the average, and the lot can then be worked with calls and puts).
6. Otherwise HOLD (everything worked) or WAIT (with the reason).

Units (owner, 2026-11-08): shares covered by short calls and those calls are ONE unit (300 sh + 3 short calls),
the rest of the shares are a second unit (500 sh + 3 calls → 300 covered + 200 uncovered), short puts a third.
Each unit's delta is reported next to the total.

Buy-backs (owner, 2026-11-09): every short option is checked against its live mid every second. Buying it back is
flagged when most of the premium is already captured: ≥ TAKE_PROFIT (80 %) at any time, or ≥ EARLY_PROFIT (50 %) with
≥ EARLY_MIN_DTE days left (the rest of the premium isn't worth the risk and the time). Closing frees the lot (call)
or the cash (put) for the next spike / pullback. A leg worth ≤ $0.05 with ≤ 1.5 days left is left to expire. A call suggestion covers the whole uncovered unit at once
(200 sh → 2 calls), and it then joins the covered unit.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field, asdict
from typing import List, Optional

from optionflow.modules.hedge import bs

REFERENCE_PER_LOT = 1.0  # the stock alone: what the book is measured against (not a neutral target)
HIGH_VOL_RATIO = 1.30     # ATM IV / HV20 at or above this = high-vol regime (shown, informs reasons)
BAND = 0.15               # per lot: |net − reference| within this counts as "near +1"
RISE_TRIGGER = 0.02       # stock ≥ 2% over average cost
CALL_OTM_SLACK = 0.03     # no ITM strike ≥ average: an ATM/OTM strike within 3% of spot is still OK
MIN_PUT_YIELD = 0.002     # a put must pay ≥ 0.2% of its strike (and ≥ $0.05/sh), or it isn't worth the cash it ties up
MIN_PUT_PREMIUM = 0.05
TAKE_PROFIT = 0.80        # buy back once 80 % of the credit is captured
EARLY_PROFIT = 0.50       # … or 50 % with at least EARLY_MIN_DTE days left
EARLY_MIN_DTE = 3.0
LET_EXPIRE_MARK = 0.05    # worth ≤ $0.05/sh with ≤ 1.5 days left: let it expire, don't pay to close
LET_EXPIRE_DTE = 1.5
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
    mark: Optional[float] = None    # live mid per share (options), from the chain
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
    action: str                     # SELL_CALL | SELL_PUT | BUY_CALL | BUY_STOCK | HOLD | WAIT | TRACK
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
    shares: int = 0                         # BUY_STOCK: shares to buy
    new_avg: Optional[float] = None         # BUY_STOCK: average cost after the buy; SELL_PUT: if assigned
    warnings: List[str] = field(default_factory=list)
    # Set by the strategy engine (strategy module); None for the spike wheel.
    long_strike: Optional[float] = None     # put credit spread: the put bought below the short
    yield_ann: Optional[float] = None       # premium ÷ capital at work, annualised
    collateral: Optional[float] = None      # $ tied up: cash for a put, max loss for a spread, the debit of a long call
    max_loss: Optional[float] = None        # $ (spreads, long calls)


@dataclass
class Close:
    """A short option worth buying back now."""
    otype: str
    strike: float
    expiry: str
    contracts: int
    dte: Optional[float]
    sold_at: float                  # premium received per share
    mark: float                     # live mid per share
    profit_pct: float               # share of the credit captured
    cost: float                     # $ to buy back
    kept: float                     # $ profit kept
    headline: str
    reasons: List[str] = field(default_factory=list)


@dataclass
class Unit:
    kind: str                       # "covered" | "uncovered" | "puts" | "other"
    label: str                      # e.g. "300 sh + 3 short calls"
    shares: float
    contracts: float                # signed option contracts in the unit
    delta: float                    # lots
    per_lot: Optional[float]        # delta per 100 shares in the unit (None without full lots)


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
    units: List[Unit] = field(default_factory=list)
    closes: List[Close] = field(default_factory=list)
    strategy: str = "spike_wheel"           # the owner's strategy that produced `suggestion` (strategy module)
    signal: Optional[dict] = None           # long options only: levels + directional read (hedge.signal)

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
def evaluate(ctx: Context, legs: List[Leg], weekly: List[Quote], strategy=None,
             chain: Optional[List[Quote]] = None, tape=None) -> Book:
    """`strategy`: a strategy.catalog.Rules; None or "spike_wheel" runs the playbook below on `weekly`.
    Any other strategy picks from `chain` (every expiry the desk has), via strategy.engine."""
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
    full_lots = math.floor(shares / 100.0 + 1e-9)
    target = REFERENCE_PER_LOT * full_lots
    gap = target - net

    for q in weekly:
        q.delta = bs.delta(spot, q.strike, bs.year_fraction(q.dte), q.iv or 0.0, q.otype)

    warnings = _gamma_warnings(legs)
    key = getattr(strategy, "key", None) or "spike_wheel"
    sig = None
    if is_long_options_only(legs):                    # long calls / puts held as stock: no strategy, just the exposure
        sig = _stock_signal(ctx, net, tape, legs)
        s, closes, key = _as_long_stock(legs, net, spot, warnings, sig), [], LONG_STOCK
    elif key == "spike_wheel":
        s = _decide(ctx, legs, weekly, net, shares, full_lots, regime, warnings)
        closes = buybacks(legs)
    else:
        from optionflow.modules.strategy.engine import decide
        quotes = [q for q in (chain if chain is not None else weekly)
                  if strategy.in_window(q.dte)]                       # only what the rules can pick
        for q in quotes:
            q.delta = bs.delta(spot, q.strike, bs.year_fraction(q.dte), q.iv or 0.0, q.otype)
        s = decide(ctx, legs, quotes, net, shares, full_lots, warnings, strategy)
        closes = buybacks(legs, strategy.take_profit, strategy.early_profit)
    return Book(ctx.symbol, shares, ctx.avg_cost, lots, _r(net), _r(ngam, 5), _r(dollar_gamma, 2),
                _r(target), regime, _r(gap), _r(iv_hv), legs, s, units(legs), closes, key,
                asdict(sig) if sig is not None else None)


LONG_STOCK = "long_stock"   # Book.strategy for a holding of long options only (owner, 2026-11-13)


def is_long_options_only(legs: List[Leg]) -> bool:
    """No shares and nothing sold: every leg is a long call (LEAPS) or a long put. The owner holds these as
    stock exposure (calls long, puts short), not as a strategy, so the desk suggests nothing for them."""
    opts = [l for l in legs if l.kind == "option"]
    return bool(opts) and len(opts) == len(legs) and all(l.otype in ("call", "put") and l.quantity > 0 for l in opts)


def _plural(n: float, word: str) -> str:
    return f"{n:g} long {word}{'s' * (n != 1)}"


def _stock_signal(ctx: Context, net: float, tape=None, legs: Optional[List[Leg]] = None):
    """hedge.signal for a holding tracked as stock. `tape`: a signal.Tape with history / flow (service); without
    one, a Tape from the context alone (dealer levels and IV, no history)."""
    from optionflow.modules.hedge import signal as sg
    t = tape or sg.Tape(ctx.spot)
    t.spot = ctx.spot
    for k in ("day_change", "atm_iv", "hv20", "net_gex", "put_wall", "call_wall", "king"):
        if getattr(t, k) is None:
            setattr(t, k, getattr(ctx, k))
    t.iv_spike, t.iv_cooling = t.iv_spike or ctx.iv_spike, t.iv_cooling or ctx.iv_cooling
    if not t.legs and legs:
        t.legs = [{"otype": l.otype, "strike": l.strike, "expiry": l.expiry, "dte": l.dte, "iv": l.iv, "mark": l.mark,
                   "quantity": l.quantity, "avg_price": l.avg_price} for l in legs if l.kind == "option"]
    return sg.evaluate(t, net)


def stock_signal(ctx: Context, exposure: float, tape=None, legs: Optional[List[Leg]] = None):
    """The hedge.signal read for any ticker (stock page): `exposure` > 0 reads it for a long position."""
    return _stock_signal(ctx, exposure, tape, legs)


def _as_long_stock(legs: List[Leg], net: float, spot: float, warnings: List[str], sig=None) -> Suggestion:
    calls = sum(l.quantity for l in legs if l.otype == "call")
    puts = sum(l.quantity for l in legs if l.otype == "put")
    eq = net * 100.0
    held = " + ".join(_plural(n, w) for n, w in ((calls, "call"), (puts, "put")) if n)
    side = "long" if eq >= 0 else "short"
    via = "calls and puts" if calls and puts else "calls" if calls else "puts"
    reasons = [f"{held}, nothing sold: tracked as {side} stock, no strategy.",
               f"Moves like ~{eq:+,.0f} shares (Δ {net:+.2f}), ${abs(eq) * spot:,.0f} of {side} exposure."]
    near = min(legs, key=lambda l: l.dte if l.dte is not None else 1e9)
    if near.dte is not None:
        reasons.append(f"Nearest expiry {near.strike:g}{'C' if near.otype == 'call' else 'P'} {near.expiry}, {near.dte:.0f} days left.")
    if sig is None:
        return Suggestion("TRACK", f"{side.capitalize()} stock via {via}: ~{eq:+,.0f} sh", reasons, warnings=warnings)
    from optionflow.modules.hedge import signal as sg
    return Suggestion("TRACK", sig.headline, sg.reasons(sig) + reasons, warnings=warnings)


def buybacks(legs: List[Leg], take_profit: float = TAKE_PROFIT, early_profit: float = EARLY_PROFIT) -> List[Close]:
    out: List[Close] = []
    for l in legs:
        if l.kind != "option" or l.quantity >= 0 or not l.avg_price or l.mark is None or l.strike is None or not l.expiry:
            continue
        dte = l.dte if l.dte is not None else 99.0
        if l.mark <= LET_EXPIRE_MARK and dte <= LET_EXPIRE_DTE:
            continue                                         # let it expire worthless
        profit = 1.0 - l.mark / l.avg_price
        if profit >= take_profit:
            why = f"{profit:.0%} of the premium is in; the last {1 - profit:.0%} isn't worth the risk."
        elif profit >= early_profit and dte >= EARLY_MIN_DTE:
            why = f"{profit:.0%} of the premium is in with {dte:.0f} days still to go: take it early."
        else:
            continue
        n = int(round(-l.quantity))
        cost, kept = l.mark * 100 * n, (l.avg_price - l.mark) * 100 * n
        c = "C" if l.otype == "call" else "P"
        frees = ("Frees the shares for the next call on a spike." if l.otype == "call"
                 else "Frees the cash for the next put on a pullback.")
        out.append(Close(l.otype or "", l.strike, l.expiry, n, _r(dte, 2), _r(l.avg_price, 2), _r(l.mark, 2), _r(profit, 3),
                         _r(cost, 2), _r(kept, 2),
                         f"Buy back {n} {l.strike:g}{c} {l.expiry} at ~${l.mark:.2f} (sold ${l.avg_price:.2f})",
                         [why, f"Costs ${cost:,.0f} to close; you keep ${kept:,.0f}.", frees]))
    return out


def units(legs: List[Leg]) -> List[Unit]:
    """Split a holding into covered (shares + their short calls), uncovered shares, short puts, other options."""
    shares = sum(l.quantity for l in legs if l.kind == "stock")
    calls = [l for l in legs if l.kind == "option" and l.otype == "call" and l.quantity < 0]
    puts = [l for l in legs if l.kind == "option" and l.otype == "put" and l.quantity < 0]
    other = [l for l in legs if l.kind == "option" and l.quantity > 0]
    n_calls = -sum(l.quantity for l in calls)
    covered = min(max(shares, 0.0), n_calls * 100.0)
    out: List[Unit] = []
    per = lambda d, sh: _r(d / (sh / 100.0)) if sh >= 100 else None          # noqa: E731
    if calls:
        d = covered / 100.0 + sum(l.position_delta for l in calls)
        naked = n_calls * 100.0 - covered
        label = f"{covered:g} sh + {n_calls:g} short call{'s' * (n_calls != 1)}" + (f" ({naked / 100:g} uncovered)" if naked > 0 else "")
        out.append(Unit("covered", label, covered, -n_calls, _r(d), per(d, covered)))
    free = shares - covered
    if free > 0:
        out.append(Unit("uncovered", f"{free:g} sh, no call", free, 0, _r(free / 100.0), per(free / 100.0, free)))
    if puts:
        n = -sum(l.quantity for l in puts)
        d = sum(l.position_delta for l in puts)
        out.append(Unit("puts", f"{n:g} short put{'s' * (n != 1)} ({n * 100:g} sh if assigned)", 0, -n, _r(d), None))
    if other:
        n = sum(l.quantity for l in other)
        out.append(Unit("other", f"{n:g} long option{'s' * (n != 1)}", 0, n, _r(sum(l.position_delta for l in other)), None))
    return out


def _gamma_warnings(legs: List[Leg]) -> List[str]:
    out = []
    for l in legs:
        if l.kind == "option" and l.quantity < 0 and l.dte is not None and l.dte <= 1:
            out.append(f"Short {l.otype} {l.strike:g} expires in ≤1 day: gamma trap, manage actively.")
    return out


def _short(legs: List[Leg], otype: str) -> int:
    return int(round(-sum(l.quantity for l in legs if l.kind == "option" and l.otype == otype and l.quantity < 0)))


def _decide(ctx: Context, legs: List[Leg], weekly: List[Quote], net: float, shares: float, full_lots: int,
            regime: str, warnings: List[str]) -> Suggestion:
    spot, avg = ctx.spot, ctx.avg_cost
    calls_on, puts_on = _short(legs, "call"), _short(legs, "put")
    free_calls = max(0, full_lots - calls_on)
    free_puts = max(0, full_lots - puts_on)
    where = f"Net delta {net:+.2f} ({net / full_lots:+.2f} per lot)" if full_lots else f"Net delta {net:+.2f}"

    if full_lots < 1:
        return _round_up(ctx, shares, net, warnings)
    if avg is None:
        return Suggestion("TRACK", "No average cost synced: can't place strikes around it", [where], warnings=warnings)

    rise = spot / avg - 1.0
    spiking = ctx.iv_spike or rise >= RISE_TRIGGER
    pulled_back = bool((ctx.day_high and spot <= ctx.day_high * (1 - PUT_PULLBACK))
                       or (ctx.day_change is not None and ctx.day_change < 0) or ctx.iv_cooling)

    # 1) Spike → sell an ITM call near the average.
    if spot > avg and spiking and free_calls >= 1:
        s = _sell_call(ctx, weekly, net, free_calls, rise, regime, warnings)
        if s:
            return s
    # 2) Pullback → sell a put below the average (never into an IV spike).
    if pulled_back and not ctx.iv_spike and free_puts >= 1:
        n = min(free_puts, calls_on) if calls_on else 1
        s = _sell_put(ctx, weekly, net, n, calls_on, warnings)
        if s:
            return s

    # 3) Nothing to place: say why.
    reasons = [where + f" vs +{REFERENCE_PER_LOT:.2f} per lot for the stock alone."]
    if free_calls == 0 and free_puts == 0:
        return Suggestion("HOLD", f"Fully worked: {calls_on} call{'s' * (calls_on != 1)} and {puts_on} put{'s' * (puts_on != 1)} on",
                          reasons + ["Every lot has a short call and a short put. Let them work or expire."], warnings=warnings)
    if ctx.iv_spike and free_calls == 0:
        return Suggestion("WAIT", "IV is spiking and every lot is covered: don't sell puts into the spike",
                          reasons + ["Wait for the pullback and cooling IV, then sell a put below your average."], warnings=warnings)
    if spot <= avg and free_calls >= 1 and not pulled_back:
        return Suggestion("WAIT", f"At/below your ${avg:,.2f} average: no call (it would lock a loss)",
                          reasons + ["Calls below your average would lock in a loss; wait for a rise or an IV spike, "
                                     "or a pullback day to sell a put below the average."], warnings=warnings)
    if spot > avg and free_calls >= 1 and not spiking:
        return Suggestion("WAIT", f"Stock {rise:+.1%} over average; waiting for +{RISE_TRIGGER:.0%} or an IV spike",
                          reasons + ["The call is sold into strength: in the money, as close to your average as the chain allows."],
                          warnings=warnings)
    if free_puts >= 1 and not pulled_back:
        return Suggestion("WAIT", "Call side done; waiting for a pullback to sell a put below average",
                          reasons + ["A red day or ≥1% off today's high, with IV not spiking."], warnings=warnings)
    return Suggestion("WAIT", "No strike fits right now", reasons, warnings=warnings)


def _sell_call(ctx: Context, weekly: List[Quote], net: float, free: int, rise: float, regime: str,
               warnings: List[str]) -> Optional[Suggestion]:
    avg, spot = ctx.avg_cost or 0.0, ctx.spot
    calls = sorted((q for q in weekly if q.otype == "call" and q.strike >= avg - 1e-9 and (q.bid or 0) > 0),
                   key=lambda q: q.strike)
    itm = [q for q in calls if q.strike <= spot]
    q = itm[0] if itm else next((c for c in calls if c.strike <= spot * (1 + CALL_OTM_SLACK)), None)
    if q is None:
        return None
    n = free
    prem = q.mid or q.bid or 0.0
    reasons = [f"Stock is {rise:+.1%} over your ${avg:,.2f} average." if rise > 0 else "Stock is above your average."]
    reasons.append(f"Covers the uncovered unit in one go: {n * 100} sh → {n} call{'s' * (n != 1)}; it then joins the covered unit.")
    if ctx.iv_spike:
        reasons.append("ATM IV is spiking on the up-move: premium is inflated, sell it now.")
    reasons.append(f"Strike {q.strike:g} is {'in the money and ' if q.strike <= spot else ''}the closest to your average "
                   "from above: if called, the shares go at or above average plus the premium.")
    reasons.append(f"Then wait for a pullback and sell a put below ${avg:,.2f} to buy the shares back cheaper.")
    if regime == "high-vol":
        reasons.append("High-vol regime: premium is rich, the call pays more than usual.")
    locked = ((q.strike - avg) + prem) * 100 * n
    return Suggestion("SELL_CALL", f"Sell {n} {q.strike:g}C {q.expiry} near your average (Δ {q.delta:.2f})",
                      reasons, q.strike, q.expiry, "call", n, _r(-q.delta), _r(prem, 2),
                      _r(prem * 100 * n, 2), _r(net - n * q.delta), _r(locked, 2), warnings=warnings)


def _sell_put(ctx: Context, weekly: List[Quote], net: float, n: int, calls_on: int,
              warnings: List[str]) -> Optional[Suggestion]:
    avg, spot = ctx.avg_cost or 0.0, ctx.spot
    puts = [q for q in weekly if q.otype == "put" and q.strike < avg - 1e-9 and q.strike <= spot and (q.bid or 0) > 0]
    if not puts:
        return None
    q = max(puts, key=lambda p: p.strike)
    prem = q.mid or q.bid or 0.0
    floor = max(MIN_PUT_PREMIUM, MIN_PUT_YIELD * q.strike)
    if prem < floor:
        return Suggestion("WAIT", f"Put below average pays too little: {q.strike:g}P ${prem:.2f} < ${floor:.2f}",
                          [f"The highest strike below your ${avg:,.2f} average is {q.strike:g}, {1 - q.strike / spot:.0%} under the price.",
                           f"It pays ${prem:.2f}/sh; the floor is {MIN_PUT_YIELD:.1%} of the strike (min ${MIN_PUT_PREMIUM:.2f}). "
                           "Wait for a deeper pullback toward your average."], warnings=warnings)
    reasons = ["Stock has pulled back and IV isn't spiking."]
    reasons.append(f"Strike {q.strike:g} is the highest below your ${avg:,.2f} average: if assigned, the shares come in "
                   f"at {q.strike - prem:,.2f} net of premium, under your average.")
    if calls_on:
        reasons.append(f"Pairs with your {calls_on} short call{'s' * (calls_on != 1)}: if both are assigned you sold above "
                       "average and bought back below it.")
    else:
        reasons.append("No call is on yet: assignment adds 100 shares per contract, below your average.")
    if ctx.put_wall is not None and abs(q.strike - ctx.put_wall) < 1e-6:
        reasons.append(f"Strike = put wall {ctx.put_wall:g} (dealer support).")
    reasons.append(f"Cash-secured: needs ${q.strike * 100 * n:,.0f} set aside.")
    return Suggestion("SELL_PUT", f"Sell {n} {q.strike:g}P {q.expiry} below your average (Δ {q.delta:.2f})",
                      reasons, q.strike, q.expiry, "put", n, _r(-q.delta), _r(prem, 2),
                      _r(prem * 100 * n, 2), _r(net - n * q.delta), new_avg=_r(q.strike - prem, 2), warnings=warnings)


def _round_up(ctx: Context, shares: float, net: float, warnings: List[str]) -> Suggestion:
    if shares <= 0:
        return Suggestion("TRACK", "Options only: no shares to work", [f"Net delta {net:+.2f}."], warnings=warnings)
    need = int(100 - (shares % 100))
    avg = ctx.avg_cost
    reasons = [f"{shares:g} shares: calls and puts are sized in 100-share lots."]
    if avg is not None and ctx.spot <= avg:
        new_avg = (avg * shares + ctx.spot * need) / (shares + need)
        return Suggestion("BUY_STOCK", f"Buy {need} shares to round up to a full lot",
                          reasons + [f"Price is at/below your ${avg:,.2f} average: buying lowers it to ${new_avg:,.2f}."],
                          contracts=0, credit=_r(-ctx.spot * need, 2), net_delta_after=_r(net + need / 100.0),
                          shares=need, new_avg=_r(new_avg, 2), warnings=warnings)
    return Suggestion("TRACK", f"Odd lot: waiting for a dip under your average to buy {need} more",
                      reasons, warnings=warnings)


def pick_weekly(expiries_dte: List[tuple]) -> Optional[str]:
    """Nearest expiry with MIN_DTE ≤ dte ≤ MAX_DTE, else the nearest with dte ≥ MIN_DTE."""
    ok = sorted((d, e) for e, d in expiries_dte if MIN_DTE <= d <= MAX_DTE)
    if ok:
        return ok[0][1]
    later = sorted((d, e) for e, d in expiries_dte if d >= MIN_DTE)
    return later[0][1] if later else None
