"""optionflow/modules/strategy/filters.py — the scanner's filters (owner-set), their defaults and bounds (pure)."""
from __future__ import annotations

import re
from typing import Any, Dict

# key: (default, min, max). Percentages are decimals (0.05 = 5%).
NUMBERS: Dict[str, tuple] = {
    "min_price": (20.0, 1.0, 5000.0),
    "max_price": (1000.0, 1.0, 10000.0),
    "pullback_min": (0.03, 0.0, 0.5),       # off the 20-day high
    "pullback_max": (0.20, 0.01, 0.9),
    "rsi_max": (55.0, 10.0, 100.0),         # 14-day RSI: ≤ this = not overbought
    "min_iv": (0.20, 0.0, 3.0),             # ATM IV
    "min_iv_hv": (1.0, 0.0, 5.0),           # ATM IV ÷ 20-day realized
    "min_iv_pctile": (0.0, 0.0, 1.0),       # ATM IV inside the 1-year range of 20-day realized vol
    "min_oi": (100.0, 0.0, 100000.0),       # open interest on the short leg
    "max_spread_pct": (0.15, 0.01, 1.0),    # bid/ask spread ÷ mid on the short leg
    "max_collateral": (0.0, 0.0, 10_000_000.0),   # $ per contract (put: strike × 100, spread: max loss); 0 = any
    "interval_min": (15.0, 5.0, 240.0),     # background scan cadence while the market is open
    "max_results": (20.0, 1.0, 100.0),
}
BOOLS: Dict[str, bool] = {
    "above_sma200": True,                   # only uptrends: price over the 200-day average
    "skip_earnings": True,                  # skip when earnings fall before the expiry
    "use_default_universe": True,           # ~120 liquid optionable stocks and ETFs
    "use_watchlists": False,                # plus every symbol on the user's watchlists
}
MAX_SYMBOLS = 200
_SYM = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")


def defaults() -> Dict[str, Any]:
    return {**{k: v[0] for k, v in NUMBERS.items()}, **BOOLS, "symbols": []}


def clean_filters(raw: Dict[str, Any] | None) -> Dict[str, Any]:
    out = defaults()
    for k, (_d, lo, hi) in NUMBERS.items():
        v = (raw or {}).get(k)
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            out[k] = round(min(max(float(v), lo), hi), 4)
    for k in BOOLS:
        v = (raw or {}).get(k)
        if isinstance(v, bool):
            out[k] = v
    syms = (raw or {}).get("symbols") or []
    if isinstance(syms, str):
        syms = re.split(r"[\s,]+", syms)
    seen: list = []
    for x in syms if isinstance(syms, list) else []:
        t = str(x).strip().upper()
        if _SYM.match(t) and t not in seen:
            seen.append(t)
    out["symbols"] = seen[:MAX_SYMBOLS]
    for a, b in (("min_price", "max_price"), ("pullback_min", "pullback_max")):
        if out[a] > out[b]:
            out[a], out[b] = out[b], out[a]
    out["interval_min"] = int(round(out["interval_min"]))
    out["max_results"] = int(round(out["max_results"]))
    return out
