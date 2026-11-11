"""optionflow/modules/strategy/catalog.py — the strategies the hedge desk can run (pure data).

Each strategy has rules (`Rules`) with defaults; the owner can override any of them (PUT /strategy), and the
engine (strategy.engine) picks contracts for the desk's holdings with them.

spike_wheel is the desk's original playbook (hedge.suggest): calls in the money near the average on spikes, puts
below the average on pullbacks. It ignores the delta / DTE rules (it has its own); only take-profit applies to it
through hedge.suggest's constants.

leaps and diagonal buy a long-dated call (the `long_*` rules); the desk fetches those far expiries only for them.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, fields, replace
from typing import Any, Dict, List, Optional

DEFAULT_KEY = "spike_wheel"
LONG_KEYS = ("leaps", "diagonal")    # strategies that hold a long-dated call


@dataclass(frozen=True)
class Rules:
    key: str = DEFAULT_KEY
    delta_min: float = 0.20          # |delta| of the short leg
    delta_max: float = 0.35
    dte_min: int = 21
    dte_max: int = 45
    min_yield: float = 0.12          # annualised premium ÷ capital at work (put: strike, call: spot, spread: max loss)
    take_profit: float = 0.50        # buy back once this share of the credit is captured …
    early_profit: float = 0.50       # … or this share with ≥ 3 days left (spike wheel: 0.80 / 0.50)
    require_pullback: bool = False   # only open puts on a pullback (red day, ≥1% off the high, IV cooling)
    calls_above_avg: bool = True     # never sell a call below the average cost (it would lock a loss)
    spread_width_pct: float = 0.05   # put credit spread: long strike ≈ this far below the short (of spot)
    min_credit_ratio: float = 0.20   # put credit spread: credit ≥ this share of the width
    long_delta_min: float = 0.70     # LEAPS / diagonal: delta of the long call (deep in the money)
    long_delta_max: float = 0.85
    long_dte_min: int = 270          # … and how far out it is bought
    long_dte_max: int = 730
    roll_dte: int = 90               # roll the long call once it has fewer days than this

    @property
    def uses_leaps(self) -> bool:
        return self.key in LONG_KEYS

    def in_window(self, dte: float) -> bool:
        """Can the rules pick a contract this many days out (short leg, or the long call for LEAPS strategies)?"""
        return (self.dte_min <= dte <= self.dte_max) or (self.uses_leaps and self.long_dte_min <= dte <= self.long_dte_max)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# Bounds for every overridable rule: (min, max). Booleans are just bool.
BOUNDS: Dict[str, tuple] = {
    "delta_min": (0.05, 0.60), "delta_max": (0.05, 0.80), "dte_min": (0, 120), "dte_max": (1, 180),
    "min_yield": (0.0, 2.0), "take_profit": (0.10, 1.0), "early_profit": (0.10, 1.0),
    "spread_width_pct": (0.01, 0.25), "min_credit_ratio": (0.05, 0.60),
    "long_delta_min": (0.50, 0.95), "long_delta_max": (0.50, 0.98), "long_dte_min": (90, 900), "long_dte_max": (120, 1100),
    "roll_dte": (30, 365),
}
INTS = ("dte_min", "dte_max", "long_dte_min", "long_dte_max", "roll_dte")
PAIRS = (("delta_min", "delta_max"), ("dte_min", "dte_max"), ("long_delta_min", "long_delta_max"), ("long_dte_min", "long_dte_max"))
BOOLS = ("require_pullback", "calls_above_avg")


@dataclass(frozen=True)
class Strategy:
    key: str
    name: str
    summary: str
    steps: List[List[str]]           # [[title, text], …] for the desk's "How it works"
    sides: str                       # "put" | "call" | "both": which legs it opens
    buys_options: bool
    rules: Rules


CATALOG: Dict[str, Strategy] = {s.key: s for s in [
    Strategy(
        "spike_wheel", "Spike wheel",
        "Harvest premium around stock you hold: calls in the money near your average on spikes, puts below your average on pullbacks.",
        [["Sells into spikes", "When the stock is ≥2% over your average or IV spikes, an in-the-money call at the strike closest to your average. If called, you sell at or above average plus the premium."],
         ["Sells puts on pullbacks", "On a red day or a dip off the high, a weekly put below your average. Assigned on both? You sold above average and bought back below it."],
         ["Rounds up odd lots", "Under 100 shares and at/below your average: buy the rest of the lot."],
         ["Buys back early", "80% of the premium in, or 50% with 3+ days left: close it and free the lot or the cash."]],
        "both", False,
        Rules("spike_wheel", 0.20, 0.40, 2, 9, 0.10, 0.80, 0.50, True, True)),
    Strategy(
        "wheel", "The wheel",
        "Sell cash-secured puts until assigned, then covered calls at or above your cost until called away. Repeat.",
        [["Puts until assigned", "No shares yet: sell a 0.20–0.35Δ put 3–6 weeks out on a stock you'd own."],
         ["Calls once you hold", "After assignment, sell a 0.20–0.35Δ call at or above your average, 3–6 weeks out."],
         ["Take 50%", "Buy back at half the premium and sell the next one."],
         ["Called away", "Shares go at a profit; start again with puts."]],
        "both", False,
        Rules("wheel")),
    Strategy(
        "covered_call", "Covered calls",
        "Only sell out-of-the-money calls on shares you hold, at or above your average. No puts.",
        [["One call per 100 shares", "Sell a 0.20–0.35Δ call 3–6 weeks out, at or above your average and above the price."],
         ["Skip thin premium", "If it pays under your minimum yield, wait for a rally or an IV pop."],
         ["Take 50%", "Buy back at half the premium and sell the next one."],
         ["Odd lots", "Under 100 shares and at/below your average: buy the rest of the lot."]],
        "call", False,
        Rules("covered_call", require_pullback=False)),
    Strategy(
        "cash_secured_put", "Cash-secured puts",
        "Only sell out-of-the-money puts, on pullbacks, with the cash to buy the shares. No calls.",
        [["Wait for a pullback", "A red day or a dip off the high, with IV above realized."],
         ["Sell a 0.20–0.35Δ put", "3–6 weeks out, below the price; the cash for 100 shares is set aside."],
         ["Take 50%", "Buy back at half the premium."],
         ["Assigned?", "You own the stock below today's price; switch to the wheel or covered calls."]],
        "put", False,
        Rules("cash_secured_put", require_pullback=True)),
    Strategy(
        "put_credit_spread", "Put credit spreads",
        "On pullbacks, sell a put and buy a lower one: defined risk, less cash than a cash-secured put. Buys an option.",
        [["Wait for a pullback", "A red day or a dip off the high, with IV above realized."],
         ["Sell a 0.20–0.35Δ put", "3–6 weeks out, and buy a put ~5% lower in the same expiry."],
         ["Credit ≥ 20% of the width", "Max loss = width − credit, known up front."],
         ["Take 50%", "Close the spread at half the credit."]],
        "put", True,
        Rules("put_credit_spread", 0.20, 0.35, 21, 45, 0.20, require_pullback=True)),
    Strategy(
        "leaps", "LEAPS calls",
        "Buy a deep in-the-money call 9–24 months out instead of 100 shares: most of the move for a fraction of the cash. Buys an option.",
        [["Buy a 0.70–0.85Δ call", "9–24 months out, in the money, so little of the price is time value."],
         ["One per stock", "It moves like 70–85 shares; the most you can lose is what you paid."],
         ["Roll under 90 days", "Sell it and buy the next one out before time decay speeds up."],
         ["No short legs", "Nothing is sold against it. Pick Diagonals to sell calls on it."]],
        "call", True,
        Rules("leaps", min_yield=0.0, require_pullback=False, calls_above_avg=False)),
    Strategy(
        "diagonal", "Diagonals",
        "A covered call with a LEAPS call in place of the shares: hold a deep in-the-money call 9–24 months out and sell 3–6 week calls against it. Buys an option.",
        [["Buy the long call first", "A 0.70–0.85Δ call 9–24 months out: the leg the short calls are written against."],
         ["Sell a 0.20–0.35Δ call", "3–6 weeks out, above the long call's break-even (its strike + what you paid), one per long call."],
         ["Take 50%", "Buy the short call back at half the premium and sell the next one."],
         ["Roll the long under 90 days", "Move it out before time decay speeds up."]],
        "call", True,
        Rules("diagonal", require_pullback=False, calls_above_avg=False)),
]}


def get(key: Optional[str]) -> Strategy:
    return CATALOG.get(key or DEFAULT_KEY) or CATALOG[DEFAULT_KEY]


def rules_for(key: Optional[str], overrides: Optional[Dict[str, Any]] = None) -> Rules:
    """The strategy's default rules with the owner's overrides applied (bad values are ignored)."""
    r = replace(get(key).rules, **clean_overrides(overrides))
    for a, b in PAIRS:
        if getattr(r, a) > getattr(r, b):
            r = replace(r, **{a: getattr(r, b), b: getattr(r, a)})
    return r


def clean_overrides(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Only known, in-range rules survive; delta/DTE pairs are put in order."""
    out: Dict[str, Any] = {}
    names = {f.name for f in fields(Rules)}
    for k, v in (raw or {}).items():
        if k not in names or k == "key" or v is None:
            continue
        if k in BOOLS:
            if isinstance(v, bool):
                out[k] = v
            continue
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            continue
        lo, hi = BOUNDS[k]
        x = min(max(float(v), lo), hi)
        out[k] = int(round(x)) if k in INTS else round(x, 4)
    for a, b in PAIRS:
        if a in out and b in out and out[a] > out[b]:
            out[a], out[b] = out[b], out[a]
    return out


def describe() -> List[Dict[str, Any]]:
    return [{"key": s.key, "name": s.name, "summary": s.summary, "steps": s.steps, "sides": s.sides,
             "buys_options": s.buys_options, "defaults": s.rules.to_dict()} for s in CATALOG.values()]
