"""optionflow/modules/flow/ideas.py — four trade ideas from the dealer map (pure, no I/O).

One contract each for BUY_CALL, SELL_CALL, BUY_PUT and SELL_PUT, picked from the same chain the GEX board is
computed from, so every idea is a listed strike and expiry with a live mid:

- SELL_CALL at the call wall (dealers sell into it) and SELL_PUT at the put wall (dealers buy into it), in the
  expiry nearest 30 days. A wall that is behind the price, or too close / too far to pay sensibly
  (|delta| outside WALL_DELTA), is replaced by the ~0.25-delta strike.
- BUY_CALL at the first strike at/above the price and BUY_PUT at the first at/below it, in the expiry nearest
  45 days (time for the move), aiming at the call wall / put wall.
- `fit` says how the idea sits with the gamma regime: long gamma (moves fade) favours the sells; short gamma
  (moves run) favours the buy on the price's side of the flip and goes against the sell on that side.

These are levels-based ideas for the board, not the desk's actions (those follow the owner's strategy).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import pandas as pd

from optionflow.modules.hedge import bs

SELL_DTE = (14, 45, 30)      # window and target, days
BUY_DTE = (30, 60, 45)
MIN_DTE = 5                  # never suggest the 0–4 DTE gamma trap
SELL_DELTA = 0.25            # fallback short strike
WALL_DELTA = (0.08, 0.40)    # a wall is sold only when its |delta| is in this band

ACTIONS = ("BUY_CALL", "SELL_CALL", "BUY_PUT", "SELL_PUT")


def _pick_expiry(dtes: Dict[str, float], lo: int, hi: int, target: int) -> Optional[str]:
    """The expiry nearest `target` days inside [lo, hi]; else the nearest to it with ≥ MIN_DTE days; else the last."""
    inside = [e for e, d in dtes.items() if lo <= d <= hi]
    pool = inside or [e for e, d in dtes.items() if d >= MIN_DTE]
    if not pool:
        return max(dtes, key=lambda e: dtes[e]) if dtes else None
    return min(pool, key=lambda e: (abs(dtes[e] - target), e))


def _contracts(df: pd.DataFrame, expiry: str, otype: str, spot: float) -> List[Dict[str, float]]:
    sub = df[(df["expiry"] == expiry) & (df["otype"] == otype)]
    out = []
    for r in sub.itertuples(index=False):
        mid, iv, T = float(r.mid or 0.0), float(r.iv or 0.0), float(r.T or 0.0)
        if mid <= 0 or iv < bs.MIN_SIGMA or T <= 0:
            continue
        out.append({"strike": float(r.strike), "mid": mid, "delta": bs.delta(spot, float(r.strike), T, iv, otype)})
    return sorted(out, key=lambda c: c["strike"])


def _pct(level: float, spot: float) -> str:
    return f"{(level / spot - 1) * 100:+.1f}%"


def _fit(action: str, long_gamma: bool, above_flip: bool) -> str:
    if long_gamma:
        return "favored" if action.startswith("SELL") else "against"
    side = "CALL" if above_flip else "PUT"                 # the way a short-gamma move runs
    if action == f"BUY_{side}":
        return "favored"
    if action == f"SELL_{side}":
        return "against"
    return "neutral"


def trade_ideas(df: pd.DataFrame, spot: float, *, net_gex: float = 0.0, zero_gamma: Optional[float] = None,
                call_wall: Optional[float] = None, put_wall: Optional[float] = None,
                king: Optional[float] = None) -> List[Dict[str, Any]]:
    """Up to four ideas (one per action, in ACTIONS order); an action with no usable contract is left out."""
    if df is None or df.empty or not spot or spot <= 0:
        return []
    dtes = {str(e): float(t) * 365.0 for e, t in df.groupby("expiry")["T"].first().items()}
    sell_exp, buy_exp = _pick_expiry(dtes, *SELL_DTE), _pick_expiry(dtes, *BUY_DTE)
    long_gamma = (net_gex or 0.0) >= 0
    above_flip = zero_gamma is None or spot >= zero_gamma

    def idea(action: str, expiry: str, c: Dict[str, float], reason: str, target: Optional[float] = None) -> Dict[str, Any]:
        otype = "call" if action.endswith("CALL") else "put"
        sign = 1 if otype == "call" else -1
        fit = _fit(action, long_gamma, above_flip)
        return {"action": action, "otype": otype, "strike": c["strike"], "expiry": expiry,
                "dte": int(round(dtes[expiry])), "premium": round(c["mid"], 2), "delta": round(c["delta"], 3),
                "breakeven": round(c["strike"] + sign * c["mid"], 2), "target": target, "fit": fit,
                "reason": reason}

    def sell(otype: str, wall: Optional[float]) -> Optional[Dict[str, Any]]:
        if not sell_exp:
            return None
        cs = [c for c in _contracts(df, sell_exp, otype, spot) if (c["strike"] > spot if otype == "call" else c["strike"] < spot)]
        if not cs:
            return None
        name = "call wall" if otype == "call" else "put wall"
        does = "dealers sell into it" if otype == "call" else "dealers buy into it"
        at = next((c for c in cs if wall is not None and abs(c["strike"] - wall) < 1e-6), None)
        if at and WALL_DELTA[0] <= abs(at["delta"]) <= WALL_DELTA[1]:
            return idea(f"SELL_{otype.upper()}", sell_exp, at, f"At the {name} ({_pct(at['strike'], spot)}): {does}.")
        c = min(cs, key=lambda c: (abs(abs(c["delta"]) - SELL_DELTA), abs(c["strike"] - spot)))
        if wall is None:
            note = f"No {name}; the {abs(c['delta']):.2f}Δ strike."
        elif (wall <= spot) if otype == "call" else (wall >= spot):
            note = f"Price is through the {name} {wall:g}; the {abs(c['delta']):.2f}Δ strike instead."
        else:
            note = (f"The {name} {wall:g} is too {'close' if at and abs(at['delta']) > WALL_DELTA[1] else 'far'} "
                    f"to sell; the {abs(c['delta']):.2f}Δ strike instead.")
        return idea(f"SELL_{otype.upper()}", sell_exp, c, note)

    def buy(otype: str, wall: Optional[float]) -> Optional[Dict[str, Any]]:
        if not buy_exp:
            return None
        cs = _contracts(df, buy_exp, otype, spot)
        side = [c for c in cs if (c["strike"] >= spot if otype == "call" else c["strike"] <= spot)]
        if not side:
            return None
        c = side[0] if otype == "call" else side[-1]
        name = "call wall" if otype == "call" else "put wall"
        beyond = (lambda lvl: lvl is not None and lvl > c["strike"]) if otype == "call" else (lambda lvl: lvl is not None and lvl < c["strike"])
        target, label = (wall, name) if beyond(wall) else (king, "king") if beyond(king) else (None, "")
        if target is not None:
            reason = f"At the money, aiming at the {label} {target:g} ({_pct(target, spot)})."
        elif wall is None:
            reason = "At the money."
        elif (wall < spot) if otype == "call" else (wall > spot):
            reason = f"At the money; price is already through the {name} {wall:g}."
        else:
            reason = f"At the money, right at the {name} {wall:g}: little room before it."
        return idea(f"BUY_{otype.upper()}", buy_exp, c, reason, target)

    out = [buy("call", call_wall), sell("call", call_wall), buy("put", put_wall), sell("put", put_wall)]
    return [i for i in out if i]
