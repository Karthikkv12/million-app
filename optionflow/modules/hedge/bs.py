"""optionflow/modules/hedge/bs.py — Black-Scholes Greeks and volatility math (pure, no I/O).

Conventions
- Option delta/gamma are per share for ONE long option (call delta in [0, 1], put in [-1, 0]).
- Position delta is expressed in "lots": 100 shares = +1.00. A short call with delta 0.70
  contributes -0.70 per contract. This is the unit the owner uses ("my delta is +1").
"""
from __future__ import annotations

import math
from typing import Optional, Sequence

R_DEFAULT = 0.045
MIN_SIGMA = 0.005          # below this a feed IV is a placeholder, not a quote (same floor as flow.gamma)


def _pdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def _cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _d1(S: float, K: float, T: float, r: float, sigma: float) -> Optional[float]:
    if S <= 0 or K <= 0 or T <= 0 or sigma < MIN_SIGMA:
        return None
    return (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * math.sqrt(T))


def delta(S: float, K: float, T: float, sigma: float, otype: str, r: float = R_DEFAULT) -> float:
    """Delta of one long option. At/after expiry (or no usable IV) it falls back to intrinsic: 1/0 or -1/0."""
    call = otype.lower().startswith("c")
    d1 = _d1(S, K, T, r, sigma)
    if d1 is None:
        itm = S > K if call else S < K
        return (1.0 if call else -1.0) if itm else 0.0
    return _cdf(d1) if call else _cdf(d1) - 1.0


def gamma(S: float, K: float, T: float, sigma: float, r: float = R_DEFAULT) -> float:
    """Gamma of one long option per share (same for calls and puts); 0 without a usable IV."""
    d1 = _d1(S, K, T, r, sigma)
    if d1 is None:
        return 0.0
    return _pdf(d1) / (S * sigma * math.sqrt(T))


def year_fraction(days: float) -> float:
    return max(days, 0.0) / 365.0


def historical_vol(closes: Sequence[float], window: int = 20) -> Optional[float]:
    """Annualised close-to-close volatility over the last `window` daily returns (decimal, 0.30 = 30%)."""
    px = [float(c) for c in closes if c and c > 0]
    if len(px) < window + 1:
        return None
    rets = [math.log(px[i] / px[i - 1]) for i in range(len(px) - window, len(px))]
    mean = sum(rets) / len(rets)
    var = sum((x - mean) ** 2 for x in rets) / (len(rets) - 1)
    return math.sqrt(var) * math.sqrt(252.0)
