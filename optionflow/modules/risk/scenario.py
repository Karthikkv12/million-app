"""optionflow/modules/risk/scenario.py — payoff and scenario P&L of a set of legs, against the GEX walls.

Every option leg is fully revalued with Black-Scholes (risk.repricing.bs_price) on a grid of spot prices, at several
points in time and under IV crush / expansion; shares are linear. P&L is measured from now (today's model value at
the current spot and IV), so the curves answer "what happens from here"; `entry_offset` is today's open P&L against
the legs' average prices, which the page adds to show P&L since entry.

    value(S, t, iv×(1+shift)) − value(spot, 0, iv)        per leg × quantity × 100 (options) or × quantity (shares)

IV per option leg: the IV backed out of the cached chain's mid for that contract
(flow.gamma; the feed's IV when there is no usable mid), else the leg's own `iv`, else the chain's at-the-money IV, else DEFAULT_IV. The spot, walls, flip and king come from the cached GEX board.
Pure maths plus cache reads; the only possible fetch is get_gex for a symbol nobody has opened (one chain).
"""
from __future__ import annotations

import math
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Sequence

import numpy as np

from optionflow.modules.risk.repricing import MAX_IV, MIN_IV, bs_price

DEFAULT_IV = 0.35
MOVES = (-0.10, -0.075, -0.05, -0.025, 0.0, 0.025, 0.05, 0.075, 0.10)     # matrix rows: spot move
IV_SHIFTS = (-0.30, -0.15, 0.0, 0.15, 0.30)                                  # matrix columns: IV × (1 + shift)
POINTS = 81


def _dte(expiry: Optional[str], today: date) -> float:
    if not expiry:
        return 0.0
    try:
        return max((date.fromisoformat(expiry[:10]) - today).days, 0) + 0.5     # +½ day: expires at the close
    except ValueError:
        return 0.0


def implied_vol(price: float, S: float, K: float, T: float, call: bool) -> Optional[float]:
    """IV that reproduces `price` per share (bisection), or None when the price is outside the no-arbitrage range."""
    if price <= 0 or S <= 0 or K <= 0 or T <= 0:
        return None
    one = lambda v: float(bs_price(np.array([S]), K, np.array([T]), np.array([v]), call)[0])
    lo, hi = MIN_IV, MAX_IV
    if not (one(lo) - 1e-6 <= price <= one(hi)):
        return None
    for _ in range(60):
        mid = 0.5 * (lo + hi)
        if one(mid) < price:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def _chain_iv(symbol: str, spot: float, keys: Sequence[tuple]) -> tuple[Dict[tuple, float], Optional[float]]:
    """({key: iv} for `keys` found in the cached chain, ATM iv). Each IV is backed out of the contract's mid (so the
    model reproduces the quote; feed IVs can be stale or broken after hours) and falls back to the feed's IV."""
    try:
        from optionflow.modules.flow import gamma
        c = gamma._chains.get(symbol.upper())
    except Exception:
        return {}, None
    if c is None or c.rows is None or c.rows.empty:
        return {}, None
    df = c.rows
    S0 = c.spot or spot

    def iv_of(r) -> Optional[float]:
        mid, T = float(r["mid"] or 0.0), float(r["T"] or 0.0)
        got = implied_vol(mid, S0, float(r["strike"]), T, r["otype"] == "call") if mid > 0 and T > 0 else None
        feed = float(r["iv"]) if r["iv"] == r["iv"] and r["iv"] > 0 else None
        return got or feed

    want = set(keys)
    ivs: Dict[tuple, float] = {}
    for _, r in df.iterrows():
        k = (str(r["expiry"]), float(r["strike"]), str(r["otype"]))
        if k in want:
            v = iv_of(r)
            if v:
                ivs[k] = v
    atm = None
    near = df[df["T"] > 0]
    if not near.empty:
        first = sorted(near["expiry"].unique())[0]
        sub = near[near["expiry"] == first]
        sub = sub.iloc[(sub["strike"] - S0).abs().argsort()[:2]]
        vals = [v for v in (iv_of(r) for _, r in sub.iterrows()) if v]
        atm = float(np.mean(vals)) if vals else None
    return ivs, atm


def _leg_value(leg: Dict[str, Any], S: np.ndarray, days: float, iv_mult: float, today: date, iv_add: float = 0.0) -> np.ndarray:
    q = float(leg["quantity"])
    if leg["kind"] != "option":
        return q * S
    T = max(_dte(leg.get("expiry"), today) - days, 0.0) / 365.0
    iv = float(np.clip(leg["iv"] * iv_mult + iv_add, MIN_IV, MAX_IV))
    call = str(leg.get("otype", "")).lower().startswith("c")
    return q * 100.0 * bs_price(S, float(leg["strike"]), np.full_like(S, T), np.full_like(S, iv), call)


def _value(legs: Sequence[Dict[str, Any]], S: np.ndarray, days: float, iv_mult: float, today: date,
           iv_add: float = 0.0) -> np.ndarray:
    out = np.zeros_like(S, dtype=float)
    for leg in legs:
        out = out + _leg_value(leg, S, days, iv_mult, today, iv_add)
    return out


def _crossings(x: np.ndarray, y: np.ndarray) -> List[float]:
    out = []
    for i in range(len(y) - 1):
        a, b = y[i], y[i + 1]
        if a == 0:
            out.append(float(x[i]))
        elif a * b < 0:
            out.append(float(x[i] + (x[i + 1] - x[i]) * (-a) / (b - a)))
    return out


def scenario(symbol: str, legs: List[Dict[str, Any]], days: float = 0.0, range_pct: float = 0.15,
             spot: Optional[float] = None, today: Optional[date] = None) -> Dict[str, Any]:
    """Payoff curves (now, `days` ahead, at the nearest expiry), the move × IV matrix at `days`, and the GEX levels."""
    from optionflow.modules.flow import service
    sym = symbol.upper()
    today = today or datetime.now().date()
    g = None
    try:
        g = service.get_gex(sym)
    except Exception:
        g = service.cached_gex(sym)
    if g is not None and g.error:
        g = None
    spot = spot or (g.spot if g else None)
    if not spot or spot <= 0:
        return {"symbol": sym, "error": "No price for this ticker right now."}

    keys = [(str(l.get("expiry")), float(l.get("strike") or 0.0),
             "call" if str(l.get("otype", "")).lower().startswith("c") else "put") for l in legs if l["kind"] == "option"]
    ivs, atm = _chain_iv(sym, spot, keys)
    resolved: List[Dict[str, Any]] = []
    for leg in legs:
        leg = dict(leg)
        if leg["kind"] == "option":
            key = (str(leg.get("expiry")), float(leg.get("strike") or 0.0), "call" if str(leg.get("otype", "")).lower().startswith("c") else "put")
            leg["otype"] = key[2]
            given = leg.get("iv")
            leg["iv_source"] = "chain" if key in ivs else ("leg" if given else ("atm" if atm else "default"))
            iv = ivs.get(key) or given or atm or DEFAULT_IV
            leg["iv"] = float(min(MAX_IV, max(MIN_IV, iv)))
        resolved.append(leg)

    opt_dtes = [_dte(l.get("expiry"), today) for l in resolved if l["kind"] == "option"]
    expiry_days = max(min(opt_dtes) - 0.5, 0.0) if opt_dtes else None        # the nearest expiry's close
    days = float(min(max(days, 0.0), expiry_days if expiry_days is not None else days))

    lo, hi = spot * (1 - range_pct), spot * (1 + range_pct)
    S = np.linspace(lo, hi, POINTS)
    base = float(_value(resolved, np.array([spot]), 0.0, 1.0, today)[0])

    curves = [{"label": "Now", "days": 0.0, "pnl": (_value(resolved, S, 0.0, 1.0, today) - base).round(2).tolist()}]
    if days > 0 and (expiry_days is None or days < expiry_days):
        curves.append({"label": f"In {days:g}d", "days": days, "pnl": (_value(resolved, S, days, 1.0, today) - base).round(2).tolist()})
    if expiry_days is not None:
        exp_pnl = _value(resolved, S, expiry_days, 1.0, today) - base
        curves.append({"label": "At expiry", "days": expiry_days, "pnl": exp_pnl.round(2).tolist()})
    else:
        exp_pnl = curves[0]["pnl"]

    moves = np.array(MOVES)
    matrix = [[round(float(_value(resolved, np.array([spot * (1 + m)]), days, 1 + sh, today)[0] - base), 2)
               for sh in IV_SHIFTS] for m in moves]

    entry = 0.0
    for l in resolved:
        avg = l.get("avg_price")
        if avg is None:
            continue
        now_px = float(_leg_value({**l, "quantity": 1.0}, np.array([spot]), 0.0, 1.0, today)[0])
        entry += now_px * float(l["quantity"]) - float(avg) * float(l["quantity"]) * (100.0 if l["kind"] == "option" else 1.0)

    # position greeks now, by finite differences on the model value
    h = spot * 0.001
    v_up = float(_value(resolved, np.array([spot + h]), 0.0, 1.0, today)[0])
    v_dn = float(_value(resolved, np.array([spot - h]), 0.0, 1.0, today)[0])
    v_day = float(_value(resolved, np.array([spot]), 1.0, 1.0, today)[0])
    v_vol = float(_value(resolved, np.array([spot]), 0.0, 1.0, today, iv_add=0.01)[0])

    exp_arr = np.asarray(exp_pnl, float)
    return {
        "symbol": sym, "spot": spot, "days": days, "expiry_days": expiry_days, "range_pct": range_pct,
        "spots": S.round(4).tolist(), "curves": curves,
        "moves": list(MOVES), "iv_shifts": list(IV_SHIFTS), "matrix": matrix,
        "breakevens": _crossings(S, exp_arr + entry),
        "max_gain": round(float(exp_arr.max()), 2), "max_loss": round(float(exp_arr.min()), 2),
        "entry_offset": round(entry, 2),
        "delta": round((v_up - v_dn) / (2 * h), 4),                          # $ per $1 of spot = share-equivalents
        "gamma": round((v_up - 2 * base + v_dn) / (h * h), 6),
        "theta": round(v_day - base, 2), "vega": round(v_vol - base, 2),       # $ per day, $ per +1 vol point
        "legs": [{k: l.get(k) for k in ("kind", "quantity", "otype", "strike", "expiry", "iv", "iv_source", "avg_price")}
                 for l in resolved],
        "zero_gamma": g.zero_gamma if g else None, "call_wall": g.max_call_wall if g else None,
        "put_wall": g.max_put_wall if g else None, "king": g.max_gex_strike if g else None,
        "error": None,
    }
