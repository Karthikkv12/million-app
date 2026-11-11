"""
optionflow/modules/flow/gamma.py — Gamma Exposure (GEX) calculations.

Option chains come from the market-data provider (optionflow.providers);
this module only does the math.

Dealer GEX model (SpotGamma convention, as `_compute_gex` implements it):
  - For calls:  GEX contribution = +Gamma × OI × lot_size × Spot² × 0.01
  - For puts:   GEX contribution = −Gamma × OI × lot_size × Spot² × 0.01
  Net GEX > 0  →  dealers net long gamma  → they sell rallies / buy dips  → mean-reverting / low vol
  Net GEX < 0  →  dealers net short gamma → they buy rallies / sell dips  → trending / volatile
  Formula: GEX = gamma × OI × contract_size × spot² × 0.01  ($ per 1% spot move, canonical standard)

Dealer VEX (vanna exposure), same sign convention (calls +, puts −):
  VEX = vanna × OI × contract_size × spot × 0.01  ($ change in dealer delta per 1 vol-point)
  Vanna is always Black-Scholes from the row's IV and T (feeds don't send it).

Data source:
  get_market_data() — Public.com option chains (real-time) when PUBLIC_API_SECRET
  is set, else / on failure Yahoo Finance (free, ~15-min delayed).
  GEXResult.data_source names the source that served the chain.

Lot size: US-listed options only, 100 shares per contract.
"""
from __future__ import annotations

from datetime import datetime, timezone

import math
from dataclasses import dataclass, field
from typing import List, Optional

import pandas as pd

from optionflow.providers.market_data import MarketDataRateLimited, get_market_data

def _get_lot_size(symbol: str) -> int:
    """Contract multiplier: 100 for US-listed options (the only market supported)."""
    return 100


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
    # Hard floor: yfinance returns 1e-5 as a placeholder IV for illiquid/zero-bid
    # options. With sigma ~1e-5 the denominator (S*sigma*sqrt(T)) ≈ 0 and gamma
    # explodes to thousands. Anything below 0.5% IV is not a real market quote.
    if sigma < 0.005:
        return 0.0
    try:
        d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
        return _norm_pdf(d1) / (S * sigma * math.sqrt(T))
    except Exception:
        return 0.0


def bs_vanna(S: float, K: float, T: float, r: float, sigma: float) -> float:
    """Black-Scholes vanna ∂Δ/∂σ (per 1.00 of vol; same for calls and puts). Same guards as bs_gamma."""
    if T <= 0 or sigma < 0.005 or S <= 0 or K <= 0:
        return 0.0
    try:
        st = sigma * math.sqrt(T)
        d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / st
        d2 = d1 - st
        return -_norm_pdf(d1) * d2 / sigma
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
    heatmap_vex_values: List[List[float]] = field(default_factory=list)  # same grid, $ VEX per 1 vol-point
    # key levels
    zero_gamma: Optional[float] = None
    max_call_wall: Optional[float] = None
    max_put_wall: Optional[float] = None
    max_gex_strike: Optional[float] = None
    net_gex: float = 0.0
    net_vex: float = 0.0
    lot_size: int = 100   # contract multiplier (US options: always 100)
    # ── Net flow fields ──────────────────────────────────────────────────────
    call_premium: float = 0.0       # total call premium (OI × mid × lot_size)
    put_premium: float = 0.0        # total put premium (OI × mid × lot_size)
    net_flow: float = 0.0           # call_premium - put_premium (+ = bullish)
    total_volume: int = 0           # total options volume (call + put) from chain
    # flow_by_expiry: [{expiry, call_prem, put_prem, net}]
    flow_by_expiry: List[dict] = field(default_factory=list)
    # top_flow_strikes: [{strike, call_prem, put_prem, net, otype_bias}]
    top_flow_strikes: List[dict] = field(default_factory=list)
    data_source: str = "yfinance"
    error: Optional[str] = None
    as_of: Optional[str] = None    # ISO UTC time this result was computed
    stale: bool = False            # True when served from cache because the data source is rate-limiting


# ---------------------------------------------------------------------------
# Fetch + compute
# ---------------------------------------------------------------------------

def _fill_gamma(df: pd.DataFrame, spot: float, r: float = 0.045) -> pd.DataFrame:
    """Use the feed's gamma where it has one (> 0); otherwise Black-Scholes from IV.

    Rows without IV (or without a spot price) get gamma 0.
    """
    if df.empty:
        return df
    df = df.copy()
    feed = pd.to_numeric(df["gamma"], errors="coerce") if "gamma" in df.columns else pd.Series(float("nan"), index=df.index)

    def _row_gamma(row) -> float:
        g = feed.loc[row.name]
        if pd.notna(g) and g > 0:
            return float(g)
        if row["iv"] > 0 and spot > 0:
            return bs_gamma(S=spot, K=row["strike"], T=row["T"], r=r, sigma=row["iv"])
        return 0.0

    df["gamma"] = df.apply(_row_gamma, axis=1)
    return df


def _compute_gex(df: pd.DataFrame, spot: float, lot_size: int = 100) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """
    Compute dealer GEX per row using the canonical Perfiliev/SpotGamma formula:
      GEX = gamma × OI × contract_size × spot² × 0.01
    This gives "dollars of delta-hedging required per 1% move in spot".

    Sign convention (matches SpotGamma / Unusual Whales):
      Calls: dealers are assumed LONG calls → LONG gamma → positive GEX (stabilising)
      Puts:  dealers are assumed SHORT puts → LONG gamma... but net put GEX is NEGATIVE
             because put buyers are long downside convexity dealers must hedge against.
    In practice: CallGEX positive, PutGEX negative — Net GEX > 0 = long gamma regime.
    """
    df = df.copy()
    # Canonical formula: gamma × OI × lot_size × spot² × 0.01
    df["gex_raw"] = df["gamma"] * df["oi"] * lot_size * spot * spot * 0.01
    # Calls = positive, Puts = negative
    df["gex"] = df.apply(
        lambda r: r["gex_raw"] if r["otype"] == "call" else -r["gex_raw"], axis=1
    )
    # VEX: Black-Scholes vanna from IV/T, × OI × lot_size × spot × 0.01; calls +, puts −
    if len(df) and "iv" in df.columns and "T" in df.columns:
        vanna = df.apply(lambda r: bs_vanna(spot, float(r["strike"]), float(r["T"]), 0.045, float(r["iv"] or 0.0)), axis=1)
        sign = df["otype"].map(lambda o: 1.0 if o == "call" else -1.0)
        df["vex"] = vanna * df["oi"] * lot_size * spot * 0.01 * sign
    else:
        df["vex"] = 0.0

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
    # ── Symbol normalization ──────────────────────────────────────────────────
    # Map common shorthand names to the yfinance ticker that actually has options.
    # Users type "SPX"; yfinance needs "^SPX".
    _SYMBOL_ALIASES: dict[str, str] = {
        "SPX":   "^SPX",   # S&P 500 index
        "NDX":   "^NDX",   # Nasdaq 100 index
        "RUT":   "^RUT",   # Russell 2000 index
        "VIX":   "^VIX",   # CBOE Volatility Index
        "DJI":   "^DJI",   # Dow Jones
        "DJIA":  "^DJI",
        "SPY500":"^SPX",
        "OEX":   "^OEX",
        "XSP":   "^XSP",   # Mini-SPX
    }
    raw = str(symbol or "").strip().upper()
    sym = _SYMBOL_ALIASES.get(raw, raw)
    # Display symbol stays as the user typed (e.g. "SPX") for labels
    display_sym = raw
    result = GEXResult(symbol=display_sym, spot=0.0, expiries=[],
                       as_of=datetime.now(timezone.utc).isoformat(timespec="seconds"))

    try:
        provider = get_market_data()
        chain = provider.option_chain(sym)
        spot, df = chain.spot, chain.rows
        df = _fill_gamma(df, spot)

        result.spot = round(spot, 2)
        result.data_source = chain.source or provider.name

        if df.empty:
            result.error = f"No options data found for {sym}."
            return result

        expiries = sorted(df["expiry"].unique().tolist())
        result.expiries = expiries

        lot_size = _get_lot_size(sym)
        df, by_strike, by_strike_call, by_strike_put = _compute_gex(df, spot, lot_size=lot_size)
        result.lot_size = lot_size

        result.strikes = by_strike["strike"].tolist()
        result.gex_by_strike = by_strike["gex"].tolist()

        merged = by_strike.merge(by_strike_call, on="strike", how="left").merge(by_strike_put, on="strike", how="left")
        merged["call_gex"] = merged.get("call_gex", 0).fillna(0)
        merged["put_gex"] = merged.get("put_gex", 0).fillna(0)
        result.call_gex_by_strike = merged["call_gex"].tolist()
        result.put_gex_by_strike = merged["put_gex"].tolist()

        # Net GEX
        result.net_gex = float(by_strike["gex"].sum())
        result.net_vex = float(df["vex"].sum())

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

        # ── Net flow: premium dollars changing hands ──────────────────────────
        # premium = OI × mid × lot_size  (proxy for committed capital)
        df["premium"] = df["oi"] * df["mid"] * lot_size
        call_df = df[df["otype"] == "call"]
        put_df  = df[df["otype"] == "put"]

        result.call_premium = float(call_df["premium"].sum())
        result.put_premium  = float(put_df["premium"].sum())
        result.net_flow     = result.call_premium - result.put_premium
        result.total_volume = int(df["volume"].sum())

        # Flow by expiry (nearest 12 expiries, sorted)
        flow_rows = []
        for exp in expiries[:12]:
            c_prem = float(df[(df["expiry"] == exp) & (df["otype"] == "call")]["premium"].sum())
            p_prem = float(df[(df["expiry"] == exp) & (df["otype"] == "put")]["premium"].sum())
            flow_rows.append({
                "expiry":     exp,
                "call_prem":  round(c_prem, 2),
                "put_prem":   round(p_prem, 2),
                "net":        round(c_prem - p_prem, 2),
            })
        result.flow_by_expiry = flow_rows

        # Top 10 strikes by total premium (near spot ±30%)
        df_near = df[(df["strike"] >= spot * 0.7) & (df["strike"] <= spot * 1.3)]
        strike_flow = df_near.groupby(["strike", "otype"])["premium"].sum().unstack(fill_value=0)
        if "call" not in strike_flow.columns: strike_flow["call"] = 0.0
        if "put"  not in strike_flow.columns: strike_flow["put"]  = 0.0
        strike_flow["total"] = strike_flow["call"] + strike_flow["put"]
        strike_flow["net"]   = strike_flow["call"] - strike_flow["put"]
        top10 = strike_flow.nlargest(10, "total").reset_index()
        result.top_flow_strikes = [
            {
                "strike":     float(row["strike"]),
                "call_prem":  round(float(row["call"]), 2),
                "put_prem":   round(float(row["put"]), 2),
                "net":        round(float(row["net"]), 2),
                "bias":       "call" if row["net"] >= 0 else "put",
            }
            for _, row in top10.iterrows()
        ]

        # --- Heatmap data: GEX by expiry × strike ---
        # Every strike within ±50% of spot, uncapped: the board centres its 10–40 window on spot itself
        # and widens it to reach the owner's legs, so far-out positions must be in the payload (C-79).
        _near = by_strike[
            (by_strike["strike"] >= spot * 0.5) & (by_strike["strike"] <= spot * 1.5)
        ]
        heatmap_strikes = sorted(_near["strike"].tolist())
        if not heatmap_strikes:
            heatmap_strikes = sorted(by_strike["strike"].tolist())

        # Limit expiries to nearest 8 for heatmap readability
        heatmap_expiries = expiries[:8]

        heatmap_values: list[list[float]] = []
        heatmap_vex_values: list[list[float]] = []
        for exp in heatmap_expiries:
            sub = df[df["expiry"] == exp]
            sub_gex = sub.groupby("strike")["gex"].sum()
            sub_vex = sub.groupby("strike")["vex"].sum()
            heatmap_values.append([float(sub_gex.get(s, 0.0)) for s in heatmap_strikes])
            heatmap_vex_values.append([float(sub_vex.get(s, 0.0)) for s in heatmap_strikes])

        result.heatmap_expiries = heatmap_expiries
        result.heatmap_strikes = heatmap_strikes
        result.heatmap_values = heatmap_values
        result.heatmap_vex_values = heatmap_vex_values

    except MarketDataRateLimited:
        raise                       # let the flow service serve the last good result
    except Exception as e:
        result.error = str(e)

    return result
