"""optionflow/modules/flow/chain_stats.py — max pain, open interest by strike and ATM implied vol from one chain.

Pure functions over the chain rows the providers return (CHAIN_COLUMNS): no fetching, no caching.

Max pain (per expiry): the settlement price at which the open contracts are worth the least to their holders, i.e.
  pain(P) = Σ_calls OI × max(0, P − K) × 100  +  Σ_puts OI × max(0, K − P) × 100
minimised over the listed strikes P. Option sellers lose least there, so it is often read as a pin target into
expiry. It assumes every open contract is held long by customers, which is a convention, not a fact.

ATM IV:
- at one expiry: each side's IV interpolated linearly in strike at the spot, then the call and put values averaged
  (whichever sides have a usable quote, IV ≥ 0.5%);
- near: the nearest expiry at least NEAR_MIN_DAYS out (skips 0DTE, whose IV swings with the clock). An expiry
  dated today or earlier (ET calendar) is dropped outright: providers floor T for 0DTE (≈ 1/365), so T alone
  would let today's expiry through;
- 30-day: total variance (IV² × T) interpolated linearly in time between the expiries either side of 30 days, the
  VIX method; the nearest expiry's IV when 30 days is outside the listed range.
"""
from __future__ import annotations

import datetime as dt
import math
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

import pandas as pd

LOT = 100
MIN_IV = 0.005
NEAR_MIN_DAYS = 1.0
TARGET_DAYS = 30.0
ET = ZoneInfo("America/New_York")


def _expired(expiry: str, today: dt.date) -> bool:
    """True when `expiry` is an ISO date on or before `today` (ET); unparseable names are left to T."""
    try:
        return dt.date.fromisoformat(str(expiry)[:10]) <= today
    except ValueError:
        return False


def _rows(df: pd.DataFrame, expiry: Optional[str] = None) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame(columns=["strike", "expiry", "otype", "oi", "iv", "T"])
    return df[df["expiry"] == expiry] if expiry else df


def max_pain(df: pd.DataFrame, expiry: str) -> Optional[float]:
    """The max-pain strike of `expiry`, or None when it has no open interest."""
    d = _rows(df, expiry)
    oi = pd.to_numeric(d["oi"], errors="coerce").fillna(0.0)
    d = d.assign(oi=oi)[oi > 0]
    if d.empty:
        return None
    k = d["strike"].astype(float).to_numpy()
    w = d["oi"].astype(float).to_numpy()
    call = (d["otype"] == "call").to_numpy()
    best, best_pain = None, math.inf
    for p in sorted(set(k.tolist())):
        pain = float((w[call] * (p - k[call]).clip(min=0)).sum() + (w[~call] * (k[~call] - p).clip(min=0)).sum())
        if pain < best_pain:
            best, best_pain = p, pain
    return float(best) if best is not None else None


def open_interest(df: pd.DataFrame, expiry: Optional[str] = None) -> List[Dict[str, float]]:
    """[{strike, call_oi, put_oi}] by strike, ascending, for one expiry or every expiry together."""
    d = _rows(df, expiry)
    if d.empty:
        return []
    d = d.assign(oi=pd.to_numeric(d["oi"], errors="coerce").fillna(0.0).astype(float))
    t = d.groupby(["strike", "otype"])["oi"].sum().unstack(fill_value=0.0)
    for c in ("call", "put"):
        if c not in t.columns:
            t[c] = 0.0
    t = t[(t["call"] > 0) | (t["put"] > 0)].sort_index()
    return [{"strike": float(k), "call_oi": int(r["call"]), "put_oi": int(r["put"])} for k, r in t.iterrows()]


def _side_iv(d: pd.DataFrame, spot: float) -> Optional[float]:
    """One side's IV at `spot`, interpolated linearly between the strikes either side of it."""
    d = d[pd.to_numeric(d["iv"], errors="coerce").fillna(0.0) >= MIN_IV]
    if d.empty:
        return None
    s = d.groupby("strike")["iv"].mean().sort_index()
    ks, vs = s.index.to_numpy(dtype=float), s.to_numpy(dtype=float)
    if spot <= ks[0]:
        return float(vs[0]) if ks[0] - spot <= spot * 0.05 else None
    if spot >= ks[-1]:
        return float(vs[-1]) if spot - ks[-1] <= spot * 0.05 else None
    i = int((ks < spot).sum())
    k0, k1, v0, v1 = ks[i - 1], ks[i], vs[i - 1], vs[i]
    return float(v0 + (v1 - v0) * (spot - k0) / (k1 - k0))


def atm_iv_at(df: pd.DataFrame, spot: float, expiry: str) -> Optional[float]:
    d = _rows(df, expiry)
    if d.empty or not spot or spot <= 0:
        return None
    vals = [v for v in (_side_iv(d[d["otype"] == o], spot) for o in ("call", "put")) if v is not None]
    return sum(vals) / len(vals) if vals else None


def _term(df: pd.DataFrame, spot: float, today: Optional[dt.date] = None) -> List[tuple]:
    """[(days, atm iv, expiry)] for every expiry after today (ET) with a usable ATM IV, nearest first."""
    if df is None or df.empty:
        return []
    today = today or dt.datetime.now(ET).date()
    out = []
    for exp, g in df.groupby("expiry"):
        if _expired(str(exp), today):
            continue
        T = pd.to_numeric(g["T"], errors="coerce").dropna()
        if T.empty or float(T.iloc[0]) <= 0:
            continue
        iv = atm_iv_at(g, spot, str(exp))
        if iv is not None:
            out.append((float(T.iloc[0]) * 365.0, iv, str(exp)))
    return sorted(out)


def atm_iv(df: pd.DataFrame, spot: float, today: Optional[dt.date] = None) -> Dict[str, Any]:
    """{near, near_expiry, d30}: ATM IV (decimals) of the nearest expiry ≥ NEAR_MIN_DAYS out and at a constant 30 days."""
    term = _term(df, spot, today)
    out: Dict[str, Any] = {"near": None, "near_expiry": None, "d30": None}
    if not term:
        return out
    near = next((t for t in term if t[0] >= NEAR_MIN_DAYS), term[-1])
    out["near"], out["near_expiry"] = round(near[1], 4), near[2]
    below = [t for t in term if t[0] <= TARGET_DAYS]
    above = [t for t in term if t[0] > TARGET_DAYS]
    if below and above:
        (d0, v0, _), (d1, v1, _) = below[-1], above[0]
        w0, w1 = v0 * v0 * d0, v1 * v1 * d1                    # total variance × 365
        var = w0 + (w1 - w0) * (TARGET_DAYS - d0) / (d1 - d0)
        out["d30"] = round(math.sqrt(max(var, 0.0) / TARGET_DAYS), 4)
    else:
        out["d30"] = round((below[-1] if below else above[0])[1], 4)
    return out


def summary(df: pd.DataFrame, spot: float, expiry: Optional[str] = None) -> Dict[str, Any]:
    """Open interest by strike and max pain for `expiry` (default: the nearest), plus max pain for every expiry."""
    expiries = sorted(df["expiry"].unique().tolist()) if df is not None and not df.empty else []
    pick = expiry if expiry in expiries else (expiries[0] if expiries else None)
    rows = open_interest(df, pick) if pick else []
    c, p = sum(r["call_oi"] for r in rows), sum(r["put_oi"] for r in rows)
    return {
        "spot": round(spot, 2) if spot else None,
        "expiries": expiries,
        "expiry": pick,
        "max_pain": max_pain(df, pick) if pick else None,
        "rows": rows,
        "call_oi": c,
        "put_oi": p,
        "put_call_ratio": round(p / c, 3) if c else None,
        "max_pain_by_expiry": [{"expiry": e, "max_pain": max_pain(df, e)} for e in expiries],
    }
