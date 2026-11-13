"""optionflow/modules/risk/voltarget.py — volatility targeting on the synced book.

    exposure = σ_target / σ̂_forecast

σ̂ is a GARCH(1,1) forecast of tomorrow's variance, annualised:

    var[t+1] = ω + α·r[t]² + β·var[t],     ω = (1 − α − β)·long-run variance ("variance targeting")

α and β are fixed (no fitting, so no optimiser that can fail on a short or odd history); ω is set so the
forecast reverts to the sample variance. α + β = 0.95: a shock fades with a half-life of about 13 sessions.

Exposure is measured in delta dollars, so shares and options count alike: Δ (lots) × 100 × spot. The portfolio's
forecast is GARCH run on the daily returns of TODAY's book replayed over the history (Σ wᵢ·rᵢ, wᵢ = delta dollars
÷ capital), which keeps the correlation between holdings. The scale for the whole book is target ÷ forecast, cut
so gross delta dollars stay within `cap` × capital; every holding is scaled by the same factor.

Pure maths first (garch_forecast, scale_book), then the service that feeds it the books and the daily bars.
"""
from __future__ import annotations

import logging
import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

logger = logging.getLogger("optionflow.risk.voltarget")

ALPHA, BETA = 0.10, 0.85         # GARCH(1,1) reaction and persistence
YEAR = 252                       # sessions a year
MIN_HISTORY = 60                 # fewer daily returns than this: no forecast
HISTORY_DAYS = 3 * YEAR          # returns used for the long-run variance and the portfolio replay
CHART_DAYS = YEAR                # points in the forecast-vs-target chart
DEFAULT_TARGET, DEFAULT_CAP = 0.15, 1.0


# ── Maths ─────────────────────────────────────────────────────────────────────
def log_returns(closes: Sequence[float]) -> List[float]:
    return [math.log(b / a) for a, b in zip(closes, closes[1:]) if a and b and a > 0 and b > 0]


def garch_path(returns: Sequence[float], alpha: float = ALPHA, beta: float = BETA) -> List[float]:
    """Daily variance forecasts: out[t] is the forecast for day t made with returns up to t−1; the last item
    (len(returns)+1 items in all) is the forecast for the next session. Starts at the long-run variance."""
    if len(returns) < 2:
        return []
    n = len(returns)
    mean = sum(returns) / n
    long_run = sum((r - mean) ** 2 for r in returns) / (n - 1)
    omega = (1.0 - alpha - beta) * long_run
    var = long_run
    out = [var]
    for r in returns:
        var = omega + alpha * r * r + beta * var
        out.append(var)
    return out


def annual(var_daily: Optional[float]) -> Optional[float]:
    return math.sqrt(var_daily * YEAR) if var_daily is not None and var_daily >= 0 else None


def garch_forecast(returns: Sequence[float]) -> Dict[str, Optional[float]]:
    """{"forecast", "long_run", "realized_20d"}: annualised vols (decimals); None without MIN_HISTORY returns."""
    if len(returns) < MIN_HISTORY:
        return {"forecast": None, "long_run": None, "realized_20d": None}
    path = garch_path(returns)
    last = returns[-20:]
    m = sum(last) / len(last)
    rv = math.sqrt(sum((r - m) ** 2 for r in last) / (len(last) - 1) * YEAR)
    return {"forecast": annual(path[-1]), "long_run": annual(path[0]), "realized_20d": rv}


def exposure_for(target: float, forecast: Optional[float], cap: float) -> Optional[float]:
    """The reel's rule: target / forecast, capped (1.0 = never more than all-in)."""
    if not forecast or forecast <= 0:
        return None
    return min(cap, target / forecast)


def scale_book(target: float, forecast: Optional[float], gross: float, capital: float, cap: float) -> Tuple[Optional[float], bool]:
    """(scale for every holding, capped?). Scale = target / forecast, cut so gross ≤ cap × capital."""
    if not forecast or forecast <= 0 or capital <= 0:
        return None, False
    raw = target / forecast
    if gross > 0 and raw * gross > cap * capital:
        return cap * capital / gross, True
    return raw, False


def align(series: Dict[str, Dict[str, float]], days: int = HISTORY_DAYS) -> Tuple[List[str], Dict[str, List[float]]]:
    from optionflow.modules.risk.book import align as _align
    return _align(series, days)


def risk_shares(weights: Dict[str, float], rets: Dict[str, List[float]]) -> Dict[str, Optional[float]]:
    """Each holding's share of portfolio variance (sums to 1): wᵢ·(Σw)ᵢ / w'Σw on the last year of returns."""
    syms = [s for s in weights if s in rets and len(rets[s]) >= MIN_HISTORY]
    if not syms:
        return {}
    n = min(len(rets[s]) for s in syms)
    n = min(n, YEAR)
    r = {s: rets[s][-n:] for s in syms}
    mean = {s: sum(r[s]) / n for s in syms}
    cov = {(a, b): sum((x - mean[a]) * (y - mean[b]) for x, y in zip(r[a], r[b])) / (n - 1) for a in syms for b in syms}
    marg = {a: sum(cov[(a, b)] * weights[b] for b in syms) for a in syms}
    total = sum(weights[a] * marg[a] for a in syms)
    if total <= 0:
        return {s: None for s in syms}
    return {a: weights[a] * marg[a] / total for a in syms}


# ── Service ───────────────────────────────────────────────────────────────────
def _thin(points: List[Dict[str, Any]], n: int = CHART_DAYS) -> List[Dict[str, Any]]:
    return points[-n:]


def vol_target(user_id: int, target: float = DEFAULT_TARGET, cap: float = DEFAULT_CAP,
               capital: Optional[float] = None) -> Dict[str, Any]:
    from optionflow.modules.risk import book
    account_value = book.capital(user_id)
    rows: List[Dict[str, Any]] = []
    closes: Dict[str, Dict[str, float]] = {}
    for h in book.holdings(user_id):
        sym = h["symbol"]
        row: Dict[str, Any] = {**h, "error": None}
        c, err = book.safe_closes(sym)
        row["error"] = err
        if len(c) > MIN_HISTORY:
            closes[sym] = c
        f = garch_forecast(log_returns([c[d] for d in sorted(c)][-(HISTORY_DAYS + 1):]))
        row.update(f)
        row["own_exposure"] = exposure_for(target, f["forecast"], cap)
        if f["forecast"] is None and not row["error"]:
            row["error"] = f"Not enough price history for {sym}."
        rows.append(row)

    gross = sum(abs(r["exposure"]) for r in rows)
    cap_base = capital or account_value or gross or 0.0
    weights = {r["symbol"]: r["exposure"] / cap_base for r in rows if cap_base and r["symbol"] in closes}
    dates, rets = align({s: closes[s] for s in weights})
    port = [sum(weights[s] * rets[s][i] for s in weights) for i in range(len(dates))] if dates else []
    pf_f = garch_forecast(port)
    scale, capped = scale_book(target, pf_f["forecast"], gross, cap_base, cap)
    shares = risk_shares(weights, rets) if dates else {}

    for r in rows:
        r["weight"] = r["exposure"] / cap_base if cap_base else None
        r["risk_share"] = shares.get(r["symbol"])
        if scale is not None:
            r["suggested_exposure"] = r["exposure"] * scale
            r["change"] = r["suggested_exposure"] - r["exposure"]
            r["change_shares"] = r["change"] / r["spot"] if r["spot"] else None
        else:
            r["suggested_exposure"] = r["change"] = r["change_shares"] = None

    path = garch_path(port) if len(port) >= MIN_HISTORY else []
    chart = [{"date": d, "forecast": annual(v), "scale": scale_book(target, annual(v), gross, cap_base, cap)[0]}
             for d, v in zip(dates, path[:-1])]                 # path[i] is the forecast for dates[i]
    rows.sort(key=lambda r: -abs(r["exposure"]))
    return {
        "as_of": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "target": target, "cap": cap, "capital": cap_base or None, "account_value": account_value,
        "capital_source": "input" if capital else "account" if account_value else "gross" if gross else None,
        "gross": gross, "net": sum(r["exposure"] for r in rows),
        "forecast": pf_f["forecast"], "long_run": pf_f["long_run"], "realized_20d": pf_f["realized_20d"],
        "scale": scale, "capped": capped,
        "max_scale": cap * cap_base / gross if gross and cap_base else None,
        "sessions": len(dates), "holdings": rows, "chart": _thin(chart),
        "error": None if rows else "No positions synced yet.",
    }
