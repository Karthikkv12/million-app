"""optionflow/modules/strategy/engine.py — contract picking and the desk's action for each strategy (pure, no I/O).

Used two ways:
- the hedge desk (hedge.suggest.evaluate → decide) for a holding, with its legs, average cost and live chain;
- the scanner (strategy.scanner) for any stock, with `pick` / `put_spread` on that stock's chain.

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
