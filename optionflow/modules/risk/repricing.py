"""optionflow/modules/risk/repricing.py — what each position would have made or lost on every past day, by full
revaluation (pure maths, no I/O).

Shares are linear, so delta dollars are exact for them. Options are not: a LEAPS also moves with implied vol
(vega), a long option can't lose more than it's worth, sold options lose faster as the stock runs at them
(negative gamma) and earn time decay (theta). So every option leg is repriced with Black-Scholes on each
historical day's move, holding today's book fixed:

    S₁ = S₀ · e^r                                   r: that day's log return of the stock
    σ₁ = σ₀ · (1 + β_iv · (VIX₁/VIX₀ − 1))          implied vol follows the market's fear gauge (sticky ratio)
    T₁ = T₀ − 1/252                                   one trading day of time decay
    P&L = contracts × 100 × (BS(S₁, σ₁, T₁) − BS(S₀, σ₀, T₀))

Signs follow the position: a sold option has negative contracts, so it gains theta and loses on big moves.
β_iv = 1 by default (a stock's IV moves in proportion to VIX); clipped so IV stays in [MIN_IV, MAX_IV].

Also: max_loss, the most a holding can lose if every leg is held to its expiry (None = unlimited, i.e. more
calls sold than the shares and long calls cover), and tail(), the worst replayed day and the 1-in-100 day loss.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence

import numpy as np

R = 0.045                 # risk-free rate, the same as hedge.bs.R_DEFAULT
DAY = 1.0 / 252.0         # one trading day, in years
MIN_IV, MAX_IV = 0.03, 5.0
IV_BETA = 1.0


def _ncdf(x: np.ndarray) -> np.ndarray:
    from math import erf
    return 0.5 * (1.0 + np.vectorize(erf)(x / math.sqrt(2.0)))


def bs_price(S: np.ndarray, K: float, T: np.ndarray, sigma: np.ndarray, call: bool, r: float = R) -> np.ndarray:
    """Black-Scholes price per share, vectorised over S / T / sigma. T ≤ 0 → intrinsic value."""
    S, T, sigma = np.broadcast_arrays(np.asarray(S, float), np.asarray(T, float), np.asarray(sigma, float))
    intrinsic = np.maximum(S - K, 0.0) if call else np.maximum(K - S, 0.0)
    live = (T > 0) & (sigma > 0) & (S > 0)
    out = intrinsic.astype(float).copy()
    if live.any():
        s, t, v = S[live], T[live], sigma[live]
        sq = v * np.sqrt(t)
        d1 = (np.log(s / K) + (r + 0.5 * v * v) * t) / sq
        d2 = d1 - sq
        disc = K * np.exp(-r * t)
        out[live] = s * _ncdf(d1) - disc * _ncdf(d2) if call else disc * _ncdf(-d2) - s * _ncdf(-d1)
    return out


def leg_iv(leg: Dict[str, Any], fallback: Optional[float]) -> Optional[float]:
    iv = leg.get("iv") or fallback
    return float(min(MAX_IV, max(MIN_IV, iv))) if iv else None


def leg_pnl(leg: Dict[str, Any], spot: float, rets: Sequence[float], vix_rets: Optional[Sequence[float]],
            fallback_iv: Optional[float] = None) -> np.ndarray:
    """$ P&L of one leg on each historical day (today's leg, that day's moves)."""
    r = np.asarray(rets, float)
    q = float(leg.get("quantity") or 0.0)
    if leg.get("kind") != "option":
        return q * spot * (np.exp(r) - 1.0)
    iv0 = leg_iv(leg, fallback_iv)
    K = float(leg.get("strike") or 0.0)
    T0 = max(float(leg.get("dte") or 0.0), 0.0) / 365.0
    call = (leg.get("otype") or "").lower().startswith("c")
    if not K or iv0 is None:                          # no usable IV: fall back to the leg's delta
        return q * 100.0 * float(leg.get("delta") or 0.0) * spot * (np.exp(r) - 1.0)
    if vix_rets is not None:
        iv1 = iv0 * (1.0 + IV_BETA * (np.exp(np.asarray(vix_rets, float)) - 1.0))
        iv1 = np.clip(iv1, MIN_IV, MAX_IV)
    else:
        iv1 = np.full_like(r, iv0)
    v0 = float(bs_price(np.array([spot]), K, np.array([T0]), np.array([iv0]), call)[0])
    v1 = bs_price(spot * np.exp(r), K, np.full_like(r, max(T0 - DAY, 0.0)), iv1, call)
    return q * 100.0 * (v1 - v0)


def holding_pnl(legs: List[Dict[str, Any]], spot: float, rets: Sequence[float], vix_rets: Optional[Sequence[float]],
                fallback_iv: Optional[float] = None) -> np.ndarray:
    out = np.zeros(len(rets))
    for leg in legs:
        out += leg_pnl(leg, spot, rets, vix_rets, fallback_iv)
    return out


def value(legs: List[Dict[str, Any]], spot: float) -> float:
    """What the holding is worth now: shares at spot, options at their mark (sold options count negative)."""
    v = 0.0
    for leg in legs:
        q = float(leg.get("quantity") or 0.0)
        if leg.get("kind") != "option":
            v += q * spot
        else:
            v += q * 100.0 * float(leg.get("mark") or 0.0)
    return v


def max_loss(legs: List[Dict[str, Any]], spot: float) -> Optional[float]:
    """The most this holding can lose from today if every leg is held to its expiry (≥ 0), or None when the loss
    is unlimited: above the highest strike, more calls are sold than the shares and long calls cover."""
    slope = 0.0                                    # $ per $1 of stock price far above every strike
    strikes = {0.0}
    for leg in legs:
        q = float(leg.get("quantity") or 0.0)
        if leg.get("kind") != "option":
            slope += q
        else:
            strikes.add(float(leg.get("strike") or 0.0))
            if (leg.get("otype") or "").lower().startswith("c"):
                slope += q * 100.0
    if slope < -1e-9:
        return None
    now = value(legs, spot)

    def at(S: float) -> float:                     # value of every leg at its own expiry with the stock at S
        v = 0.0
        for leg in legs:
            q = float(leg.get("quantity") or 0.0)
            if leg.get("kind") != "option":
                v += q * S
            else:
                K = float(leg.get("strike") or 0.0)
                call = (leg.get("otype") or "").lower().startswith("c")
                v += q * 100.0 * (max(S - K, 0.0) if call else max(K - S, 0.0))
        return v

    worst = min(at(S) for S in strikes | {max(strikes) * 2 + spot})
    return max(0.0, now - worst)


def tail(pnl: Sequence[float]) -> Dict[str, Optional[float]]:
    """Worst replayed day and the 1-in-100 day loss (99th percentile), as positive $ losses."""
    p = np.asarray(pnl, float)
    if len(p) < 20:
        return {"worst_day": None, "loss_99": None}
    return {"worst_day": float(max(0.0, -p.min())), "loss_99": float(max(0.0, -np.percentile(p, 1)))}
