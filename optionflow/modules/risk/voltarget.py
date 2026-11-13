"""optionflow/modules/risk/voltarget.py — volatility targeting on the synced book.

    exposure = σ_target / σ̂_forecast

σ̂ is a GARCH(1,1) forecast of tomorrow's variance, annualised:

    var[t+1] = ω + α·r[t]² + β·var[t],     ω = (1 − α − β)·long-run variance ("variance targeting")

α and β are fixed (no fitting, so no optimiser that can fail on a short or odd history); ω is set so the
forecast reverts to the sample variance. α + β = 0.95: a shock fades with a half-life of about 13 sessions.

For shares, exposure is delta dollars and the book's daily returns are Σ wᵢ·rᵢ (exact for shares). With any
option held, every leg is fully repriced on each past day instead (repricing.py): LEAPS vega, sold options'
gamma and theta, and the cap on a long option's loss all enter the forecast. Exposure (for the cap and the
table) is still measured in delta dollars, so shares and options count alike: Δ (lots) × 100 × spot. The portfolio's
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


VIX = "^VIX"


def vol_target(user_id: int, target: float = DEFAULT_TARGET, cap: float = DEFAULT_CAP,
               capital: Optional[float] = None) -> Dict[str, Any]:
    """Shares only: delta dollars × daily returns (exact for shares). Any option held: every leg repriced with
    Black-Scholes on each past day (repricing.py), so LEAPS vega, sold options' gamma and theta, and the cap on a
    long option's loss are in the forecast. The scale multiplies every position (contracts too), which scales a
    repriced P&L exactly, so the rule target ÷ forecast holds either way."""
    import numpy as np
    from optionflow.modules.risk import book
    from optionflow.modules.risk import repricing as rp
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
        row["own_exposure"] = exposure_for(target, f["forecast"], cap) if not h.get("has_options") else None
        if f["forecast"] is None and not row["error"]:
            row["error"] = f"Not enough price history for {sym}."
        legs = h.get("legs") or []
        opts = [leg for leg in legs if leg.get("kind") == "option"]
        row["long_contracts"] = sum(leg["quantity"] for leg in opts if (leg.get("quantity") or 0) > 0)
        row["short_contracts"] = -sum(leg["quantity"] for leg in opts if (leg.get("quantity") or 0) < 0)
        row["value"] = rp.value(legs, h["spot"]) if legs else None
        row["max_loss"] = rp.max_loss(legs, h["spot"]) if legs else None
        row["unlimited_loss"] = bool(legs) and row["max_loss"] is None
        rows.append(row)

    method = "repriced" if any(r.get("has_options") for r in rows) else "delta"
    vix_note = None
    gross = sum(abs(r["exposure"]) for r in rows)
    cap_base = capital or account_value or gross or 0.0
    syms = [r["symbol"] for r in rows if cap_base and r["symbol"] in closes]
    series = {s: closes[s] for s in syms}
    if method == "repriced" and syms:
        vix, err = book.safe_closes(VIX)
        if len(vix) > MIN_HISTORY:
            series[VIX] = vix
        else:
            vix_note = f"No VIX history{f' ({err})' if err else ''}: implied vol held flat in the replay."
    dates, rets = align(series)
    if VIX in series and len(dates) < MIN_HISTORY:          # VIX shortened the window too much: replay without it
        series.pop(VIX)
        vix_note = "VIX history too short: implied vol held flat in the replay."
        dates, rets = align(series)

    pnl: Dict[str, Any] = {}                                 # $ per day for each holding (today's book)
    if dates:
        if method == "delta":
            for s in syms:
                exp = next(r["exposure"] for r in rows if r["symbol"] == s)
                pnl[s] = exp * np.asarray(rets[s])            # exactly the previous weights × returns
        else:
            vr = rets.get(VIX)
            for r in rows:
                if r["symbol"] not in syms:
                    continue
                pnl[r["symbol"]] = rp.holding_pnl(r.get("legs") or [], r["spot"], rets[r["symbol"]], vr, r.get("atm_iv"))
    port_d = sum(pnl.values()) if pnl else np.zeros(0)
    port = list(np.asarray(port_d) / cap_base) if cap_base and len(dates) else []
    pf_f = garch_forecast(port)
    scale, capped = scale_book(target, pf_f["forecast"], gross, cap_base, cap)

    # Each holding's share of the book's variance, on the same daily P&L the forecast uses.
    shares: Dict[str, Optional[float]] = {}
    if pnl and len(dates) >= MIN_HISTORY:
        P = {s: np.asarray(v)[-YEAR:] for s, v in pnl.items()}
        tot = np.asarray(port_d)[-YEAR:]
        var = float(np.var(tot, ddof=1))
        for s, v in P.items():
            shares[s] = float(np.cov(v, tot, ddof=1)[0, 1] / var) if var > 0 else None
    tails = rp.tail(port_d) if len(dates) else {"worst_day": None, "loss_99": None}

    for r in rows:
        r["weight"] = r["exposure"] / cap_base if cap_base else None
        r["risk_share"] = shares.get(r["symbol"])
        p = pnl.get(r["symbol"])
        r["pnl_vol"] = float(np.std(p[-YEAR:], ddof=1) * math.sqrt(YEAR) / cap_base) if p is not None and cap_base and len(p) > 2 else None
        r.update({k: v for k, v in (rp.tail(p) if p is not None else {"worst_day": None, "loss_99": None}).items()})
        r.pop("legs", None)
        if scale is not None:
            r["suggested_exposure"] = r["exposure"] * scale
            r["change"] = r["suggested_exposure"] - r["exposure"]
            r["change_shares"] = r["change"] / r["spot"] if r["spot"] else None
            r["contracts_after"] = {"long": r["long_contracts"] * scale, "short": r["short_contracts"] * scale} if r.get("has_options") else None
        else:
            r["suggested_exposure"] = r["change"] = r["change_shares"] = r["contracts_after"] = None

    path = garch_path(port) if len(port) >= MIN_HISTORY else []
    chart = [{"date": d, "forecast": annual(v), "scale": scale_book(target, annual(v), gross, cap_base, cap)[0]}
             for d, v in zip(dates, path[:-1])]                 # path[i] is the forecast for dates[i]
    rows.sort(key=lambda r: -abs(r["exposure"]))
    unlimited = [r["symbol"] for r in rows if r.get("unlimited_loss")]
    limited = [r["max_loss"] for r in rows if r.get("max_loss") is not None]
    return {
        "as_of": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "target": target, "cap": cap, "capital": cap_base or None, "account_value": account_value,
        "capital_source": "input" if capital else "account" if account_value else "gross" if gross else None,
        "gross": gross, "net": sum(r["exposure"] for r in rows),
        "method": method, "vix_note": vix_note,
        "forecast": pf_f["forecast"], "long_run": pf_f["long_run"], "realized_20d": pf_f["realized_20d"],
        "scale": scale, "capped": capped,
        "max_scale": cap * cap_base / gross if gross and cap_base else None,
        "worst_day": tails["worst_day"], "loss_99": tails["loss_99"],
        "max_loss": None if unlimited else (sum(limited) if limited else None), "unlimited": unlimited,
        "sessions": len(dates), "holdings": rows, "chart": _thin(chart),
        "error": None if rows else "No positions synced yet.",
    }
