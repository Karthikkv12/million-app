"""
Gamma Exposure (GEX) calculations.

Dealer GEX model:
  - For calls:  dealer is SHORT gamma  → GEX contribution = -Gamma × OI × 100 × Spot
  - For puts:   dealer is LONG gamma   → GEX contribution = +Gamma × OI × 100 × Spot
  Net GEX > 0  →  dealers long gamma  → they sell rallies / buy dips  → mean-reverting market
  Net GEX < 0  →  dealers short gamma → they buy rallies / sell dips  → trending / volatile market
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List, Optional
import warnings

import pandas as pd

# ---------------------------------------------------------------------------
# Black-Scholes helpers (pure Python – no heavy deps)
# ---------------------------------------------------------------------------

def _norm_cdf(x: float) -> float:
    """Approximate CDF of the standard normal using the Abramowitz & Stegun method."""
    t = 1.0 / (1.0 + 0.2316419 * abs(x))
    poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
    p = 1.0 - (1.0 / math.sqrt(2 * math.pi)) * math.exp(-0.5 * x * x) * poly
    return p if x >= 0 else 1.0 - p


def _norm_pdf(x: float) -> float:
    return (1.0 / math.sqrt(2 * math.pi)) * math.exp(-0.5 * x * x)


def bs_gamma(S: float, K: float, T: float, r: float, sigma: float) -> float:
    """Black-Scholes gamma for a European option (same for calls and puts)."""
    if T <= 0 or sigma <= 0 or S <= 0 or K <= 0:
        return 0.0
    try:
        d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
        return _norm_pdf(d1) / (S * sigma * math.sqrt(T))
    except Exception:
        return 0.0


# ---------------------------------------------------------------------------
# Data containers
# ---------------------------------------------------------------------------

@dataclass
class OptionRow:
    strike: float
    expiry: str          # YYYY-MM-DD string
    otype: str           # "call" or "put"
    oi: int
    iv: float            # implied vol as decimal (0.25 = 25%)
    mid: float           # mid price
    gamma: Optional[float] = None   # computed or from chain


@dataclass
class GEXResult:
    symbol: str
    spot: float
    expiries: List[str]
    # per-strike aggregates (all expiries combined)
    strikes: List[float] = field(default_factory=list)
    gex_by_strike: List[float] = field(default_factory=list)   # in $ (notional)
    call_gex_by_strike: List[float] = field(default_factory=list)
    put_gex_by_strike: List[float] = field(default_factory=list)
    # heatmap: rows=expiries, cols=strikes, values=GEX
    heatmap_expiries: List[str] = field(default_factory=list)
    heatmap_strikes: List[float] = field(default_factory=list)
    heatmap_values: List[List[float]] = field(default_factory=list)  # shape: [len(expiries)][len(strikes)]
    # key levels
    zero_gamma: Optional[float] = None
    max_call_wall: Optional[float] = None
    max_put_wall: Optional[float] = None
    max_gex_strike: Optional[float] = None
    net_gex: float = 0.0
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Fetch + compute
# ---------------------------------------------------------------------------

def _fetch_chain_yfinance(symbol: str) -> tuple[float, pd.DataFrame]:
    """Fetch options chain using yfinance. Returns (spot_price, options_df)."""
    import yfinance as yf  # imported late so module loads without yfinance

    ticker = yf.Ticker(symbol.upper())

    # Current price
    info = ticker.fast_info
    spot = float(getattr(info, "last_price", None) or getattr(info, "regularMarketPrice", None) or 0.0)
    if spot <= 0:
        # fallback
        hist = ticker.history(period="1d", progress=False)
        if not hist.empty:
            spot = float(hist["Close"].iloc[-1])

    expiries = ticker.options
    if not expiries:
        return spot, pd.DataFrame()

    rows: list[dict] = []
    today = pd.Timestamp.today().normalize()
    for exp in expiries:
        exp_dt = pd.to_datetime(exp)
        T_days = (exp_dt - today).days
        if T_days <= 0:
            continue
        T = T_days / 365.0
        try:
            chain = ticker.option_chain(exp)
        except Exception:
            continue

        for otype, df in [("call", chain.calls), ("put", chain.puts)]:
            if df is None or df.empty:
                continue
            for _, opt in df.iterrows():
                try:
                    strike_raw = opt.get("strike", 0)
                    strike = float(strike_raw) if strike_raw is not None and not (isinstance(strike_raw, float) and math.isnan(strike_raw)) else 0.0
                    if strike <= 0:
                        continue

                    oi_raw = opt.get("openInterest", 0)
                    if oi_raw is None or (isinstance(oi_raw, float) and math.isnan(oi_raw)):
                        oi = 0
                    else:
                        oi = int(float(oi_raw))
                    if oi <= 0:
                        continue

                    iv_raw = opt.get("impliedVolatility", 0)
                    iv = float(iv_raw) if iv_raw is not None and not (isinstance(iv_raw, float) and math.isnan(iv_raw)) else 0.0

                    bid_raw = opt.get("bid", 0)
                    bid = float(bid_raw) if bid_raw is not None and not (isinstance(bid_raw, float) and math.isnan(bid_raw)) else 0.0
                    ask_raw = opt.get("ask", 0)
                    ask = float(ask_raw) if ask_raw is not None and not (isinstance(ask_raw, float) and math.isnan(ask_raw)) else 0.0
                    mid = (bid + ask) / 2.0

                    # Use gamma from chain if available, else compute via BS
                    chain_gamma = opt.get("gamma", None)
                    if chain_gamma is not None and not (isinstance(chain_gamma, float) and math.isnan(chain_gamma)) and float(chain_gamma) > 0:
                        gamma = float(chain_gamma)
                    elif iv > 0 and spot > 0:
                        gamma = bs_gamma(S=spot, K=strike, T=T, r=0.045, sigma=iv)
                    else:
                        gamma = 0.0

                    rows.append({
                        "strike": strike,
                        "expiry": exp,
                        "otype": otype,
                        "oi": oi,
                        "iv": iv,
                        "mid": mid,
                        "gamma": gamma,
                        "T": T,
                    })
                except Exception:
                    continue

    if not rows:
        return spot, pd.DataFrame()
    return spot, pd.DataFrame(rows)


def _compute_gex(df: pd.DataFrame, spot: float) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """
    Compute dealer GEX per row.
    Calls: dealer short gamma → negative GEX.
    Puts:  dealer long gamma  → positive GEX.
    GEX notional = ±gamma × oi × 100 × spot
    """
    df = df.copy()
    df["gex_raw"] = df["gamma"] * df["oi"] * 100 * spot
    df["gex"] = df.apply(
        lambda r: -r["gex_raw"] if r["otype"] == "call" else r["gex_raw"], axis=1
    )

    # per-strike aggregate (all expiries combined)
    by_strike = (
        df.groupby("strike")["gex"].sum().reset_index().sort_values("strike")
    )

    by_strike_call = (
        df[df["otype"] == "call"].groupby("strike")["gex"].sum().reset_index().rename(columns={"gex": "call_gex"})
    )
    by_strike_put = (
        df[df["otype"] == "put"].groupby("strike")["gex"].sum().reset_index().rename(columns={"gex": "put_gex"})
    )

    return df, by_strike, by_strike_call, by_strike_put


def _find_zero_gamma(by_strike: pd.DataFrame, spot: float) -> Optional[float]:
    """
    Find the strike where GEX flips sign (zero gamma level).
    Uses linear interpolation between the two strikes that bracket the sign change
    nearest to spot.
    """
    if by_strike.empty or len(by_strike) < 2:
        return None
    df = by_strike.sort_values("strike").reset_index(drop=True)
    # Find sign changes
    signs = df["gex"].apply(lambda v: 1 if v >= 0 else -1)
    flips = []
    for i in range(len(signs) - 1):
        if signs.iloc[i] != signs.iloc[i + 1]:
            s1, g1 = df["strike"].iloc[i], df["gex"].iloc[i]
            s2, g2 = df["strike"].iloc[i + 1], df["gex"].iloc[i + 1]
            # linear interpolation: zero at s1 + (s2-s1)*(-g1)/(g2-g1)
            if (g2 - g1) != 0:
                z = s1 + (s2 - s1) * (-g1) / (g2 - g1)
            else:
                z = (s1 + s2) / 2
            flips.append((abs(z - spot), z))
    if not flips:
        return None
    return round(sorted(flips)[0][1], 2)


def compute_gamma_exposure(symbol: str) -> GEXResult:
    """Main entry point. Returns a GEXResult ready to render."""
    sym = str(symbol or "").strip().upper()
    result = GEXResult(symbol=sym, spot=0.0, expiries=[])

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            spot, df = _fetch_chain_yfinance(sym)

        result.spot = round(spot, 2)

        if df.empty:
            result.error = f"No options data found for {sym}."
            return result

        expiries = sorted(df["expiry"].unique().tolist())
        result.expiries = expiries

        df, by_strike, by_strike_call, by_strike_put = _compute_gex(df, spot)

        result.strikes = by_strike["strike"].tolist()
        result.gex_by_strike = by_strike["gex"].tolist()

        merged = by_strike.merge(by_strike_call, on="strike", how="left").merge(by_strike_put, on="strike", how="left")
        merged["call_gex"] = merged.get("call_gex", 0).fillna(0)
        merged["put_gex"] = merged.get("put_gex", 0).fillna(0)
        result.call_gex_by_strike = merged["call_gex"].tolist()
        result.put_gex_by_strike = merged["put_gex"].tolist()

        # Net GEX
        result.net_gex = float(by_strike["gex"].sum())

        # Key levels
        result.zero_gamma = _find_zero_gamma(by_strike, spot)

        # Max call/put walls (strike with largest absolute GEX for each type)
        by_strike_call_sorted = by_strike_call.reindex(by_strike_call["call_gex"].abs().sort_values(ascending=False).index)
        by_strike_put_sorted = by_strike_put.reindex(by_strike_put["put_gex"].abs().sort_values(ascending=False).index)
        result.max_call_wall = float(by_strike_call_sorted["strike"].iloc[0]) if not by_strike_call_sorted.empty else None
        result.max_put_wall = float(by_strike_put_sorted["strike"].iloc[0]) if not by_strike_put_sorted.empty else None

        # Strike with max absolute net GEX
        if by_strike.empty:
            result.max_gex_strike = None
        else:
            idx = by_strike["gex"].abs().idxmax()
            result.max_gex_strike = float(by_strike.loc[idx, "strike"])

        # --- Heatmap data: GEX by expiry × strike ---
        # Only keep top N strikes near spot for readability
        _near = by_strike[
            (by_strike["strike"] >= spot * 0.8) & (by_strike["strike"] <= spot * 1.2)
        ]
        heatmap_strikes = sorted(_near["strike"].tolist())
        if not heatmap_strikes:
            heatmap_strikes = sorted(by_strike["strike"].tolist())

        # Cap at 40 strikes for display
        if len(heatmap_strikes) > 40:
            # Pick 40 evenly spaced around spot
            arr = sorted(heatmap_strikes, key=lambda s: abs(s - spot))[:40]
            heatmap_strikes = sorted(arr)

        # Limit expiries to nearest 8 for heatmap readability
        heatmap_expiries = expiries[:8]

        heatmap_values: list[list[float]] = []
        for exp in heatmap_expiries:
            sub = df[df["expiry"] == exp]
            sub_gex = sub.groupby("strike")["gex"].sum()
            row_vals = [float(sub_gex.get(s, 0.0)) for s in heatmap_strikes]
            heatmap_values.append(row_vals)

        result.heatmap_expiries = heatmap_expiries
        result.heatmap_strikes = heatmap_strikes
        result.heatmap_values = heatmap_values

    except Exception as e:
        result.error = str(e)

    return result
