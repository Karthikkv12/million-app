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

`outlook` reads the same map for the likely direction (up / down / sideways, as shares of 100), the
battleground strike (where call and put gamma are both large) and the ±1σ range to the expiry nearest 30 days.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

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


# ── Outlook: likely direction, battleground strike, expected range ────────────
BATTLE_BAND = 0.05           # the battleground is looked for within ±5% of the price
PIN_BAND = 0.005             # king within 0.5% of the price = pinned
RANGE_DTE = 30               # expected range: ±1σ to the expiry nearest this many days


def battleground(strikes: Sequence[float], call_gex: Sequence[float], put_gex: Sequence[float],
                 spot: float) -> Optional[float]:
    """The contested strike: where call gamma and put gamma are both large (the larger of the smaller side),
    within ±BATTLE_BAND of the price. None when no strike near the price carries both."""
    best, best_v = None, 0.0
    for k, c, p in zip(strikes, call_gex, put_gex):
        if abs(k / spot - 1.0) > BATTLE_BAND:
            continue
        v = min(abs(c or 0.0), abs(p or 0.0))
        if v > best_v or (v == best_v and best is not None and v > 0 and abs(k - spot) < abs(best - spot)):
            best, best_v = float(k), v
    return best if best_v > 0 else None


def _atm_iv(df: pd.DataFrame, expiry: str, spot: float) -> Optional[float]:
    sub = df[(df["expiry"] == expiry) & (df["iv"] >= bs.MIN_SIGMA)]
    if sub.empty:
        return None
    k = min(sub["strike"].unique(), key=lambda s: abs(float(s) - spot))
    ivs = [float(v) for v in sub[sub["strike"] == k]["iv"]]
    return sum(ivs) / len(ivs) if ivs else None


def outlook(df: pd.DataFrame, spot: float, *, strikes: Sequence[float] = (), call_gex: Sequence[float] = (),
            put_gex: Sequence[float] = (), net_gex: float = 0.0, zero_gamma: Optional[float] = None,
            call_wall: Optional[float] = None, put_wall: Optional[float] = None, king: Optional[float] = None,
            call_premium: float = 0.0, put_premium: float = 0.0) -> Optional[Dict[str, Any]]:
    """{direction: up|down|sideways, up, down, sideways (percent, sum 100), reasons, battleground,
    expected_low, expected_high, expected_dte, atm_iv}. A read of the dealer map, not a forecast."""
    if not spot or spot <= 0:
        return None
    up = down = side = 1.0
    why: List[str] = []
    long_gamma = (net_gex or 0.0) >= 0
    above = None if zero_gamma is None else spot >= zero_gamma

    if long_gamma:
        side += 3.0
        why.append("Long gamma: dealers sell rallies and buy dips, which holds price in a range.")
    else:
        why.append("Short gamma: dealers chase moves, so the break tends to run.")
    if above is not None:
        if above:
            up += 2.0 + (0.0 if long_gamma else 2.0)
            why.append(f"Above the flip {zero_gamma:g}: the supportive side of the map.")
        else:
            down += 2.0 + (0.0 if long_gamma else 2.0)
            why.append(f"Below the flip {zero_gamma:g}: dealers add to selling down here.")
    if king is not None:
        if abs(king / spot - 1.0) <= PIN_BAND:
            side += 2.0
            why.append(f"Sitting on the king {king:g}: the largest gamma strike pins price.")
        elif king > spot:
            up += 1.5 if long_gamma else 0.5
            why.append(f"The king {king:g} is above ({_pct(king, spot)}): a magnet upward.")
        else:
            down += 1.5 if long_gamma else 0.5
            why.append(f"The king {king:g} is below ({_pct(king, spot)}): a magnet downward.")
    if call_wall is not None and put_wall is not None:
        if spot > call_wall:
            if long_gamma:
                down += 1.0
                why.append(f"Through the call wall {call_wall:g} with long gamma: stretched, tends to fade back.")
            else:
                up += 1.0
                why.append(f"Through the call wall {call_wall:g} with short gamma: a breakout.")
        elif spot < put_wall:
            if long_gamma:
                up += 1.0
                why.append(f"Under the put wall {put_wall:g} with long gamma: stretched, tends to snap back.")
            else:
                down += 1.0
                why.append(f"Under the put wall {put_wall:g} with short gamma: a breakdown.")
        else:
            room_up, room_dn = call_wall - spot, spot - put_wall
            if room_up >= 2 * room_dn:
                up += 1.0
                why.append(f"Near the put wall {put_wall:g} (support), with room up to the call wall {call_wall:g}.")
            elif room_dn >= 2 * room_up:
                down += 1.0
                why.append(f"Near the call wall {call_wall:g} (resistance), with room down to the put wall {put_wall:g}.")
    total_prem = (call_premium or 0.0) + (put_premium or 0.0)
    if total_prem > 0:
        share = call_premium / total_prem
        if share >= 0.60:
            up += 1.0
            why.append(f"{share:.0%} of the option premium is in calls.")
        elif share <= 0.40:
            down += 1.0
            why.append(f"{1 - share:.0%} of the option premium is in puts.")

    tot = up + down + side
    pu, pd_ = int(round(up / tot * 100)), int(round(down / tot * 100))
    ps = 100 - pu - pd_
    direction = max((("sideways", ps), ("up", pu), ("down", pd_)), key=lambda x: x[1])[0]

    lo = hi = dte = iv = None
    if df is not None and not df.empty:
        dtes = {str(e): float(t) * 365.0 for e, t in df.groupby("expiry")["T"].first().items()}
        e = _pick_expiry(dtes, *SELL_DTE[:2], RANGE_DTE)
        iv = _atm_iv(df, e, spot) if e else None
        if iv:
            dte = int(round(dtes[e]))
            move = spot * iv * (dtes[e] / 365.0) ** 0.5
            lo, hi = round(spot - move, 2), round(spot + move, 2)
    return {"direction": direction, "up": pu, "down": pd_, "sideways": ps, "reasons": why,
            "battleground": battleground(strikes, call_gex, put_gex, spot),
            "expected_low": lo, "expected_high": hi, "expected_dte": dte, "atm_iv": round(iv, 4) if iv else None}
