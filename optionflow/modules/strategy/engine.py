"""optionflow/modules/strategy/engine.py — contract picking and the desk's action for each strategy (pure, no I/O).

Called by the hedge desk (hedge.suggest.evaluate → decide) for a holding, with its legs, average cost and live chain.

Quotes carry delta already (filled by the caller at the current spot). Premiums are mids per share.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

from optionflow.modules.hedge.suggest import (Context, Leg, Quote, Suggestion, _r, _round_up, _short, PUT_PULLBACK)
from optionflow.modules.strategy.catalog import Rules, get


def pulled_back(ctx: Context) -> bool:
    """A red day, ≥1% off today's high, or IV cooling."""
    return bool((ctx.day_high and ctx.spot <= ctx.day_high * (1 - PUT_PULLBACK))
                or (ctx.day_change is not None and ctx.day_change < 0) or ctx.iv_cooling)


def annual_yield(premium: float, capital: float, dte: float) -> Optional[float]:
    """Premium ÷ capital, annualised (simple)."""
    if capital <= 0 or premium <= 0:
        return None
    return premium / capital * 365.0 / max(dte, 1.0)


def _mid(q: Quote) -> float:
    return q.mid or q.bid or 0.0


def pick(quotes: List[Quote], otype: str, spot: float, rules: Rules, min_strike: Optional[float] = None) -> Optional[Quote]:
    """The out-of-the-money contract in the DTE window whose |delta| is closest to the middle of the delta band."""
    target = (rules.delta_min + rules.delta_max) / 2
    ok = [q for q in quotes
          if q.otype == otype and rules.dte_min <= q.dte <= rules.dte_max and _mid(q) > 0
          and (q.strike > spot if otype == "call" else q.strike < spot)
          and (min_strike is None or q.strike >= min_strike - 1e-9)
          and rules.delta_min - 1e-9 <= abs(q.delta) <= rules.delta_max + 1e-9]
    if not ok:
        return None
    mid_dte = (rules.dte_min + rules.dte_max) / 2
    return min(ok, key=lambda q: (round(abs(abs(q.delta) - target), 3), abs(q.dte - mid_dte), q.strike))


def put_spread(quotes: List[Quote], short: Quote, spot: float, rules: Rules) -> Optional[Quote]:
    """The long put: same expiry, the highest strike at least `spread_width_pct` of spot below the short."""
    floor = short.strike - rules.spread_width_pct * spot
    longs = [q for q in quotes if q.otype == "put" and q.expiry == short.expiry and q.strike <= floor + 1e-9 and _mid(q) > 0]
    return max(longs, key=lambda q: q.strike) if longs else None


@dataclass
class Spread:
    short: Quote
    long: Quote
    credit: float          # per share
    width: float
    max_loss: float        # per share
    yield_ann: Optional[float]


def build_spread(quotes: List[Quote], spot: float, rules: Rules, long_quotes: Optional[List[Quote]] = None) -> tuple:
    """(Spread or None, why-not). The short comes from `quotes`; the long from `long_quotes` (default the same)."""
    short = pick(quotes, "put", spot, rules)
    if short is None:
        return None, f"No put {rules.delta_min:.2f}–{rules.delta_max:.2f}Δ, {rules.dte_min}–{rules.dte_max} days out."
    long = put_spread(long_quotes if long_quotes is not None else quotes, short, spot, rules)
    if long is None:
        return None, f"No lower put ~{rules.spread_width_pct:.0%} under the {short.strike:g} strike in {short.expiry}."
    width = short.strike - long.strike
    credit = _mid(short) - _mid(long)
    if width <= 0 or credit <= 0:
        return None, "The spread pays nothing."
    if credit < rules.min_credit_ratio * width:
        return None, (f"{short.strike:g}/{long.strike:g}P pays ${credit:.2f}, under {rules.min_credit_ratio:.0%} "
                      f"of the ${width:g} width (${rules.min_credit_ratio * width:.2f}).")
    loss = width - credit
    return Spread(short, long, credit, width, loss, annual_yield(credit, loss, short.dte)), ""


# ── Desk: the action for one holding ──────────────────────────────────────────
def decide(ctx: Context, legs: List[Leg], quotes: List[Quote], net: float, shares: float, full_lots: int,
           warnings: List[str], rules: Rules) -> Suggestion:
    key = rules.key
    name = get(key).name
    calls_on, puts_on = _short(legs, "call"), _short(legs, "put")
    where = f"Net delta {net:+.2f}" + (f" ({net / full_lots:+.2f} per lot)" if full_lots else "")

    if key == "covered_call":
        if full_lots < 1:
            return _round_up(ctx, shares, net, warnings)
        return _call_side(ctx, quotes, net, full_lots - calls_on, calls_on, where, warnings, rules, name)
    if key == "wheel":
        if full_lots >= 1:
            return _call_side(ctx, quotes, net, full_lots - calls_on, calls_on, where, warnings, rules, name)
        return _put_side(ctx, quotes, net, 1 - puts_on, puts_on, where, warnings, rules, name)
    if key == "leaps":
        return _leaps_side(ctx, legs, quotes, net, where, warnings, rules, name)
    if key == "diagonal":
        return _diagonal(ctx, legs, quotes, net, full_lots, calls_on, where, warnings, rules, name)
    if key in ("cash_secured_put", "put_credit_spread"):
        return _put_side(ctx, quotes, net, max(1, full_lots) - puts_on, puts_on, where, warnings, rules, name)
    return Suggestion("TRACK", f"Unknown strategy {key!r}", [where], warnings=warnings)


def _call_side(ctx, quotes, net, free, calls_on, where, warnings, rules: Rules, name) -> Suggestion:
    spot, avg = ctx.spot, ctx.avg_cost
    if free <= 0:
        return Suggestion("HOLD", f"Every lot has a call on ({calls_on})",
                          [where, f"{name}: let the calls work; buy back at {rules.take_profit:.0%} of the premium."], warnings=warnings)
    floor = avg if (rules.calls_above_avg and avg) else None
    q = pick(quotes, "call", spot, rules, floor)
    if q is None:
        why = [where, f"{name}: a {rules.delta_min:.2f}–{rules.delta_max:.2f}Δ call {rules.dte_min}–{rules.dte_max} days out"
               + (f", at or above your ${avg:,.2f} average" if floor else "") + "."]
        if floor and spot < avg:
            why.append(f"The stock is {spot / avg - 1:+.1%} vs your average: calls that far up pay too little. Wait for a rally.")
        return Suggestion("WAIT", "No call fits the rules right now", why, warnings=warnings)
    prem = _mid(q)
    y = annual_yield(prem, spot, q.dte)
    if y is None or y < rules.min_yield:
        return Suggestion("WAIT", f"{q.strike:g}C {q.expiry} pays too little: {(y or 0):.0%}/yr < {rules.min_yield:.0%}",
                          [where, f"${prem:.2f}/sh on a ${spot:,.2f} stock over {q.dte:.0f} days.",
                           "Wait for a rally or an IV pop."], warnings=warnings)
    n = free
    reasons = [f"{name}: {n} uncovered lot{'s' * (n != 1)}.",
               f"{q.strike:g} is {q.strike / spot - 1:+.1%} over the price, Δ {q.delta:.2f}, {q.dte:.0f} days: "
               f"${prem:.2f}/sh = {y:.0%}/yr on the shares."]
    if ctx.avg_cost:
        reasons.append(f"If called, the shares go at {q.strike:g} vs your ${ctx.avg_cost:,.2f} average, plus the premium.")
    reasons.append(f"Buy back at {rules.take_profit:.0%} of the premium.")
    locked = ((q.strike - ctx.avg_cost) + prem) * 100 * n if ctx.avg_cost else None
    s = Suggestion("SELL_CALL", f"Sell {n} {q.strike:g}C {q.expiry} (Δ {q.delta:.2f}, {y:.0%}/yr)", reasons,
                   q.strike, q.expiry, "call", n, _r(-q.delta), _r(prem, 2), _r(prem * 100 * n, 2),
                   _r(net - n * q.delta), _r(locked, 2) if locked is not None else None, warnings=warnings)
    s.yield_ann = _r(y, 4)
    return s


def _put_side(ctx, quotes, net, free, puts_on, where, warnings, rules: Rules, name) -> Suggestion:
    spot = ctx.spot
    spread = rules.key == "put_credit_spread"
    if free <= 0:
        return Suggestion("HOLD", f"{puts_on} put{'s' * (puts_on != 1)} on: let {'them' if puts_on != 1 else 'it'} work",
                          [where, f"{name}: buy back at {rules.take_profit:.0%} of the credit."], warnings=warnings)
    if rules.require_pullback and not pulled_back(ctx):
        return Suggestion("WAIT", "Waiting for a pullback to sell a put",
                          [where, f"{name}: a red day or ≥1% off today's high."], warnings=warnings)
    if spread:
        sp, why = build_spread(quotes, spot, rules)
        if sp is None:
            return Suggestion("WAIT", "No put spread fits the rules right now", [where, why], warnings=warnings)
        if sp.yield_ann is None or sp.yield_ann < rules.min_yield:
            return Suggestion("WAIT", f"{sp.short.strike:g}/{sp.long.strike:g}P pays too little: {(sp.yield_ann or 0):.0%}/yr on risk",
                              [where, f"Minimum {rules.min_yield:.0%}/yr on the max loss."], warnings=warnings)
        q, n = sp.short, 1
        d_after = net - n * (sp.short.delta - sp.long.delta)
        s = Suggestion("SELL_PUT", f"Sell 1 {q.strike:g}/{sp.long.strike:g}P spread {q.expiry} for ${sp.credit:.2f} "
                       f"({sp.credit / sp.max_loss:.0%} on risk)",
                       ["Pulled back." if pulled_back(ctx) else "Rules allow a put now.",
                        f"Sell the {q.strike:g}P (Δ {q.delta:.2f}) and buy the {sp.long.strike:g}P, {q.dte:.0f} days.",
                        f"Credit ${sp.credit:.2f} on a ${sp.width:g} width; max loss ${sp.max_loss * 100:,.0f}: "
                        f"{sp.credit / sp.max_loss:.0%} on risk this trade ({sp.yield_ann:.0%}/yr).",
                        f"Close at {rules.take_profit:.0%} of the credit."],
                       q.strike, q.expiry, "put", n, _r(-q.delta), _r(sp.credit, 2), _r(sp.credit * 100, 2),
                       _r(d_after), warnings=warnings)
        s.long_strike, s.yield_ann, s.max_loss = sp.long.strike, _r(sp.yield_ann, 4), _r(sp.max_loss * 100, 2)
        s.collateral = _r(sp.max_loss * 100, 2)
        return s
    q = pick(quotes, "put", spot, rules)
    if q is None:
        return Suggestion("WAIT", "No put fits the rules right now",
                          [where, f"{name}: a {rules.delta_min:.2f}–{rules.delta_max:.2f}Δ put {rules.dte_min}–{rules.dte_max} days out."],
                          warnings=warnings)
    prem = _mid(q)
    y = annual_yield(prem, q.strike, q.dte)
    if y is None or y < rules.min_yield:
        return Suggestion("WAIT", f"{q.strike:g}P {q.expiry} pays too little: {(y or 0):.0%}/yr < {rules.min_yield:.0%}",
                          [where, f"${prem:.2f}/sh on the ${q.strike:g} strike over {q.dte:.0f} days."], warnings=warnings)
    n = 1
    s = Suggestion("SELL_PUT", f"Sell 1 {q.strike:g}P {q.expiry} (Δ {q.delta:.2f}, {y:.0%}/yr)",
                   ["Pulled back." if pulled_back(ctx) else "Rules allow a put now.",
                    f"{q.strike:g} is {1 - q.strike / spot:.1%} under the price, {q.dte:.0f} days: ${prem:.2f}/sh = {y:.0%}/yr on the cash.",
                    f"If assigned you own 100 more at {q.strike - prem:,.2f} net.",
                    f"Cash-secured: ${q.strike * 100:,.0f} set aside. Buy back at {rules.take_profit:.0%}."],
                   q.strike, q.expiry, "put", n, _r(-q.delta), _r(prem, 2), _r(prem * 100, 2),
                   _r(net - n * q.delta), new_avg=_r(q.strike - prem, 2), warnings=warnings)
    s.yield_ann, s.collateral = _r(y, 4), _r(q.strike * 100, 2)
    return s


# ── LEAPS and diagonals ───────────────────────────────────────────────────────
def long_calls(legs: List[Leg], min_dte: float = 0.0) -> List[Leg]:
    """Calls held long with at least `min_dte` days left."""
    return [l for l in legs if l.kind == "option" and l.otype == "call" and l.quantity > 0 and (l.dte or 0.0) >= min_dte]


def pick_long(quotes: List[Quote], spot: float, rules: Rules) -> Optional[Quote]:
    """The in-the-money call in the long window whose delta is closest to the middle of the long band;
    ties go to the expiry nearest the middle of the window."""
    target = (rules.long_delta_min + rules.long_delta_max) / 2
    ok = [q for q in quotes
          if q.otype == "call" and rules.long_dte_min <= q.dte <= rules.long_dte_max and _mid(q) > 0 and q.strike < spot
          and rules.long_delta_min - 1e-9 <= q.delta <= rules.long_delta_max + 1e-9]
    if not ok:
        return None
    mid_dte = (rules.long_dte_min + rules.long_dte_max) / 2
    return min(ok, key=lambda q: (round(abs(q.delta - target), 2), abs(q.dte - mid_dte), -q.strike))


def _months(dte: float) -> str:
    return f"{dte / 30.4:.0f} months"


def _buy_long(ctx, quotes, net, where, warnings, rules: Rules, name, n: int = 1, roll: Optional[Leg] = None,
              lead: Optional[str] = None) -> Suggestion:
    """BUY_CALL for the long leg (or WAIT with the reason). `roll`: the call it replaces."""
    spot = ctx.spot
    band = (f"{rules.long_delta_min:.2f}–{rules.long_delta_max:.2f}Δ call "
            f"{rules.long_dte_min / 30.4:.0f}–{rules.long_dte_max / 30.4:.0f} months out")
    if roll is None and rules.require_pullback and not pulled_back(ctx):
        return Suggestion("WAIT", "Waiting for a pullback to buy the long call",
                          [where, f"{name}: a red day or ≥1% off today's high."], warnings=warnings)
    q = pick_long(quotes, spot, rules)
    if q is None:
        far = any(x.otype == "call" and rules.long_dte_min <= x.dte <= rules.long_dte_max for x in quotes)
        why = ("None of the listed long-dated calls is in that delta band with a live quote." if far
               else "No quoted expiry that far out for this stock right now.")
        head = (f"Roll the {roll.strike:g}C {roll.expiry}: {roll.dte:.0f} days left, but no call fits to roll into"
                if roll else "No long call fits the rules right now")
        return Suggestion("WAIT", head, [where, f"{name}: a {band}.", why], warnings=warnings)
    prem = _mid(q)
    extrinsic = max(prem - max(spot - q.strike, 0.0), 0.0)
    cost = prem * 100 * n
    reasons = [lead] if lead else []
    reasons += [f"{q.strike:g} is {1 - q.strike / spot:.1%} in the money, Δ {q.delta:.2f}, {q.dte:.0f} days ({_months(q.dte)}).",
                f"${prem:,.2f}/sh = ${prem * 100:,.0f} per contract, {prem / spot:.0%} of 100 shares (${spot * 100:,.0f}).",
                f"Time value ${extrinsic:,.2f}/sh ({extrinsic / spot:.1%} of the price); break-even {q.strike + prem:,.2f} "
                f"({(q.strike + prem) / spot - 1:+.1%}). Max loss is the ${cost:,.0f} paid.",
                f"Roll it once it has under {rules.roll_dte} days."]
    if roll is not None:
        head = f"Roll {n} {roll.strike:g}C {roll.expiry} into the {q.strike:g}C {q.expiry} (Δ {q.delta:.2f})"
        d_after = net + n * (q.delta - roll.delta)
    else:
        head = f"Buy {n} {q.strike:g}C {q.expiry} (Δ {q.delta:.2f}, {_months(q.dte)})"
        d_after = net + n * q.delta
    s = Suggestion("BUY_CALL", head, reasons, q.strike, q.expiry, "call", n, _r(q.delta), _r(prem, 2), _r(-cost, 2),
                   _r(d_after), warnings=warnings)
    s.collateral = s.max_loss = _r(cost, 2)
    return s


def _held(legs: List[Leg]) -> str:
    return ", ".join(f"{l.quantity:g}× {l.strike:g}C {l.expiry}" for l in legs)


def _leaps_side(ctx, legs, quotes, net, where, warnings, rules: Rules, name) -> Suggestion:
    held = long_calls(legs, 1.0)
    if not held:
        return _buy_long(ctx, quotes, net, where, warnings, rules, name,
                         lead=f"{name}: no long call on {ctx.symbol} yet.")
    due = min(held, key=lambda l: l.dte or 0.0)
    if (due.dte or 0.0) < rules.roll_dte:
        return _buy_long(ctx, quotes, net, where, warnings, rules, name, n=int(round(due.quantity)) or 1, roll=due,
                         lead=f"{name}: the {due.strike:g}C has {due.dte:.0f} days left, under your {rules.roll_dte}-day roll line. "
                              "Sell it and buy this one.")
    return Suggestion("HOLD", f"Long call on: {_held(held)}",
                      [where, f"{name}: nearest expiry in {due.dte:.0f} days; roll under {rules.roll_dte}."], warnings=warnings)


def _diagonal(ctx, legs, quotes, net, full_lots, calls_on, where, warnings, rules: Rules, name) -> Suggestion:
    spot = ctx.spot
    anchors = long_calls(legs, rules.dte_max + 1)            # long calls that outlive any short the rules can sell
    if not anchors:
        return _buy_long(ctx, quotes, net, where, warnings, rules, name,
                         lead=f"{name}: buy the long call first; the short calls are sold against it.")
    due = min(anchors, key=lambda l: l.dte or 0.0)
    if (due.dte or 0.0) < rules.roll_dte:
        return _buy_long(ctx, quotes, net, where, warnings, rules, name, n=int(round(due.quantity)) or 1, roll=due,
                         lead=f"{name}: the long {due.strike:g}C has {due.dte:.0f} days left, under your {rules.roll_dte}-day roll line.")
    n_long = int(round(sum(l.quantity for l in anchors)))
    free = n_long - max(0, calls_on - full_lots)             # short calls beyond the share lots sit on the long calls
    if free <= 0:
        return Suggestion("HOLD", f"Every long call has a short call on it ({n_long})",
                          [where, f"{name}: let the short calls work; buy back at {rules.take_profit:.0%} of the premium."],
                          warnings=warnings)
    # Never sell below the long call's break-even: if assigned, the diagonal must still close at a gain.
    anchor = max(anchors, key=lambda l: (l.strike or 0.0) + (l.avg_price or 0.0))
    floor = (anchor.strike or 0.0) + (anchor.avg_price or 0.0)
    q = pick(quotes, "call", spot, rules, floor)
    if q is None:
        why = [where, f"{name}: a {rules.delta_min:.2f}–{rules.delta_max:.2f}Δ call {rules.dte_min}–{rules.dte_max} days out, "
               f"at or above {floor:,.2f} (the long {anchor.strike:g}C's break-even)."]
        if floor > spot:
            why.append(f"The price is {spot / floor - 1:+.1%} vs that break-even: calls that far up pay too little. Wait for a rally.")
        return Suggestion("WAIT", "No short call fits the rules right now", why, warnings=warnings)
    prem = _mid(q)
    capital = anchor.avg_price or anchor.mark or spot        # what the long call ties up, per share
    y = annual_yield(prem, capital, q.dte)
    if y is None or y < rules.min_yield:
        return Suggestion("WAIT", f"{q.strike:g}C {q.expiry} pays too little: {(y or 0):.0%}/yr < {rules.min_yield:.0%}",
                          [where, f"${prem:.2f}/sh on a ${capital:,.2f} long call over {q.dte:.0f} days.",
                           "Wait for a rally or an IV pop."], warnings=warnings)
    n = free
    reasons = [f"{name}: {n} long call{'s' * (n != 1)} with nothing sold against {'them' if n != 1 else 'it'} ({_held(anchors)}).",
               f"{q.strike:g} is {q.strike / spot - 1:+.1%} over the price, Δ {q.delta:.2f}, {q.dte:.0f} days: "
               f"${prem:.2f}/sh = {y:.0%}/yr on the ${capital:,.2f} long call."]
    locked = None
    if anchor.avg_price:
        locked = (q.strike - floor + prem) * 100 * n
        reasons.append(f"If assigned, the spread closes at {q.strike:g} − {anchor.strike:g} = ${q.strike - anchor.strike:,.2f} "
                       f"vs ${anchor.avg_price:,.2f} paid, plus the premium.")
    reasons.append(f"Buy back at {rules.take_profit:.0%} of the premium.")
    s = Suggestion("SELL_CALL", f"Sell {n} {q.strike:g}C {q.expiry} against the {anchor.strike:g}C (Δ {q.delta:.2f}, {y:.0%}/yr)",
                   reasons, q.strike, q.expiry, "call", n, _r(-q.delta), _r(prem, 2), _r(prem * 100 * n, 2),
                   _r(net - n * q.delta), _r(locked, 2) if locked is not None else None, warnings=warnings)
    s.yield_ann = _r(y, 4)
    return s
