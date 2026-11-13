"""optionflow/modules/risk/factors.py — factor exposure of the synced book (Arbitrage Pricing Theory).

    rᵢ = αᵢ + Σₖ βᵢₖ·fₖ + εᵢ          (one regression per holding, daily log returns, last year)

Factors are ETF return series built so they overlap as little as possible:

    market  SPY                the broad US market
    tech    QQQ − SPY          tech / growth tilt beyond the market
    size    IWM − SPY          small companies beyond the market
    rates   TLT                long Treasuries: positive beta = you gain when long-term rates fall

The book is Σ wᵢ·rᵢ with wᵢ = delta dollars ÷ capital, so its betas are Σ wᵢ·βᵢₖ (OLS is linear) and read as
"% of capital per 1% factor move". Its variance splits into each factor's part, βₖ·(Fβ)ₖ with F the factor
covariance, plus specific risk (what no factor explains, which diversification shrinks). The hedge for a factor
is the ETF leg(s) that take its beta to zero: each factor ETF loads on its own factor only, by construction.

Pure maths first (regress, decompose), then the service.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence

import numpy as np

logger = logging.getLogger("optionflow.risk.factors")

YEAR = 252
WINDOW = YEAR                    # returns per regression
MIN_HISTORY = 60

FACTORS: List[Dict[str, Any]] = [
    {"key": "market", "label": "Market", "etf": "SPY", "minus": None,
     "about": "The whole US market (S&P 500)."},
    {"key": "tech", "label": "Tech vs market", "etf": "QQQ", "minus": "SPY",
     "about": "Nasdaq-100 minus the S&P 500: how much more you ride tech / growth than the market does."},
    {"key": "size", "label": "Small vs large", "etf": "IWM", "minus": "SPY",
     "about": "Russell 2000 minus the S&P 500: small companies beyond the market."},
    {"key": "rates", "label": "Rates (bonds)", "etf": "TLT", "minus": None,
     "about": "20+ year Treasuries. Positive beta: you gain when long-term rates fall; negative: you gain when they rise."},
]
FACTOR_ETFS = sorted({f["etf"] for f in FACTORS} | {f["minus"] for f in FACTORS if f["minus"]})


# ── Maths ─────────────────────────────────────────────────────────────────────
def regress(y: Sequence[float], X: np.ndarray) -> Dict[str, Any]:
    """OLS of y on the columns of X with an intercept. betas, r2, residual and total vol (annualised)."""
    yv = np.asarray(y, dtype=float)
    A = np.column_stack([np.ones(len(yv)), X])
    coef, *_ = np.linalg.lstsq(A, yv, rcond=None)
    resid = yv - A @ coef
    tot = float(np.var(yv, ddof=1)) if len(yv) > 1 else 0.0
    res = float(np.var(resid, ddof=X.shape[1] + 1)) if len(yv) > X.shape[1] + 1 else 0.0
    return {"alpha": float(coef[0]), "betas": [float(b) for b in coef[1:]],
            "r2": max(0.0, 1.0 - res / tot) if tot > 0 else None,
            "vol": float(np.sqrt(tot * YEAR)), "specific_vol": float(np.sqrt(res * YEAR)), "resid_var": res}


def decompose(betas: Sequence[float], F: np.ndarray, resid_var: float) -> Dict[str, Any]:
    """Annualised variance of a return with these factor betas: each factor's part (sums with specific to the
    total) and specific. F is the daily factor covariance."""
    b = np.asarray(betas, dtype=float)
    Fb = F @ b
    parts = [float(b[k] * Fb[k] * YEAR) for k in range(len(b))]
    specific = float(resid_var * YEAR)
    total = sum(parts) + specific
    return {"parts": parts, "specific": specific, "total": total,
            "shares": [p / total for p in parts] if total > 0 else [None] * len(parts),
            "specific_share": specific / total if total > 0 else None,
            "vol": float(np.sqrt(total)) if total > 0 else None}


def factor_returns(etf_rets: Dict[str, List[float]]) -> np.ndarray:
    """Columns in FACTORS order: the ETF's return, minus its base where it has one."""
    cols = []
    for f in FACTORS:
        r = np.asarray(etf_rets[f["etf"]], dtype=float)
        if f["minus"]:
            r = r - np.asarray(etf_rets[f["minus"]], dtype=float)
        cols.append(r)
    return np.column_stack(cols)


def hedge_legs(key: str, dollar_beta: float, prices: Dict[str, float]) -> List[Dict[str, Any]]:
    """ETF trades that take this factor's beta to zero. dollar_beta: $ the book makes per +1 (100%) factor move."""
    f = next(x for x in FACTORS if x["key"] == key)
    legs = [{"symbol": f["etf"], "dollars": -dollar_beta}]
    if f["minus"]:
        legs.append({"symbol": f["minus"], "dollars": dollar_beta})
    for leg in legs:
        px = prices.get(leg["symbol"])
        leg["shares"] = leg["dollars"] / px if px else None
    return legs


# ── Service ───────────────────────────────────────────────────────────────────
def factors(user_id: int, capital: Optional[float] = None) -> Dict[str, Any]:
    from optionflow.modules.risk import book
    rows = book.holdings(user_id)
    account_value = book.capital(user_id)
    meta = [{k: f[k] for k in ("key", "label", "etf", "minus", "about")} for f in FACTORS]
    base = {"as_of": datetime.now(timezone.utc).isoformat(timespec="seconds"), "factors": meta,
            "capital": None, "account_value": account_value, "capital_source": None, "gross": 0.0, "net": 0.0,
            "sessions": 0, "book": None, "holdings": [], "error": None}
    if not rows:
        return {**base, "error": "No positions synced yet."}

    etf_closes = {}
    for e in FACTOR_ETFS:
        c, err = book.safe_closes(e)
        if len(c) <= MIN_HISTORY:
            return {**base, "error": f"No price history for the {e} factor right now{f' ({err})' if err else ''}."}
        etf_closes[e] = c
    prices = {e: c[max(c)] for e, c in etf_closes.items()}

    gross = sum(abs(r["exposure"]) for r in rows)
    cap_base = capital or account_value or gross
    hold_closes: Dict[str, Dict[str, float]] = {}
    for r in rows:
        c, err = book.safe_closes(r["symbol"])
        r.update({"weight": r["exposure"] / cap_base if cap_base else None, "error": err, "betas": None,
                  "r2": None, "vol": None, "specific_vol": None, "dollar_betas": None, "risk_share": None})
        if len(c) > MIN_HISTORY:
            hold_closes[r["symbol"]] = c
        elif not err:
            r["error"] = f"Not enough price history for {r['symbol']}."

    # One window shared by the factors and every holding with history, so the book adds up exactly.
    series = {**{f"etf:{e}": c for e, c in etf_closes.items()}, **hold_closes}
    dates, rets = book.align(series, WINDOW)
    if len(dates) < MIN_HISTORY:
        return {**base, "capital": cap_base, "gross": gross, "holdings": rows,
                "error": "Not enough shared price history across your holdings and the factor ETFs."}
    X = factor_returns({e: rets[f"etf:{e}"] for e in etf_closes})
    F = np.cov(X, rowvar=False, ddof=1)

    book_ret = np.zeros(len(dates))
    for r in rows:
        if r["symbol"] not in hold_closes:
            continue
        fit = regress(rets[r["symbol"]], X)
        r.update({"betas": dict(zip([f["key"] for f in FACTORS], fit["betas"])), "r2": fit["r2"],
                  "vol": fit["vol"], "specific_vol": fit["specific_vol"]})
        r["dollar_betas"] = {k: b * r["exposure"] / 100.0 for k, b in r["betas"].items()}     # $ per 1% factor move
        if cap_base:
            book_ret += (r["exposure"] / cap_base) * np.asarray(rets[r["symbol"]])

    fit = regress(book_ret, X)
    dec = decompose(fit["betas"], F, fit["resid_var"])
    book_factors = []
    for k, f in enumerate(FACTORS):
        beta = fit["betas"][k]
        dollar = beta * cap_base / 100.0 if cap_base else None                  # $ per 1% factor move
        book_factors.append({
            "key": f["key"], "beta": beta, "dollar_per_pct": dollar,
            "factor_vol": float(np.sqrt(F[k, k] * YEAR)),
            "risk": dec["parts"][k], "risk_share": dec["shares"][k],
            "hedge": hedge_legs(f["key"], dollar * 100.0, prices) if dollar is not None else [],
        })

    # Each holding's share of the book's variance, through its factor betas and its own specific risk.
    if dec["total"] > 0 and cap_base:
        bb = np.asarray(fit["betas"])
        for r in rows:
            if r["betas"] is None:
                continue
            w = r["exposure"] / cap_base
            bi = np.array([r["betas"][f["key"]] for f in FACTORS])
            spec = (r["specific_vol"] ** 2) * w * w            # own specific risk (cross terms are small)
            r["risk_share"] = float((w * bi @ F @ bb * YEAR + spec) / dec["total"])

    rows.sort(key=lambda r: -abs(r["exposure"]))
    return {
        **base, "capital": cap_base, "capital_source": "input" if capital else "account" if account_value else "gross",
        "gross": gross, "net": sum(r["exposure"] for r in rows), "sessions": len(dates),
        "window": {"start": dates[0], "end": dates[-1]}, "prices": prices,
        "book": {"factors": book_factors, "r2": fit["r2"], "vol": dec["vol"], "specific": dec["specific"],
                 "specific_share": dec["specific_share"], "factor_share": (1 - dec["specific_share"]) if dec["specific_share"] is not None else None},
        "holdings": rows,
    }
