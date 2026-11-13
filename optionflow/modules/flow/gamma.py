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
import threading
import time
from dataclasses import dataclass, field
from typing import List, Optional

import numpy as np
import pandas as pd

from optionflow.providers.market_data import MarketDataRateLimited, get_market_data

HEATMAP_EXPIRIES = 12   # heatmap rows sent: every expiry the providers fetch (MAX_CHAIN_EXPIRIES = 12)

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
    # max pain of the nearest expiry (flow.chain_stats) and ATM IV: nearest expiry ≥ 1 day out, and constant 30-day
    max_pain: Optional[float] = None
    max_pain_expiry: Optional[str] = None
    atm_iv_near: Optional[float] = None
    atm_iv_near_expiry: Optional[str] = None
    atm_iv_30d: Optional[float] = None
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
    # ideas: one contract per action (BUY_CALL, SELL_CALL, BUY_PUT, SELL_PUT) from the dealer levels (flow.ideas)
    ideas: List[dict] = field(default_factory=list)
    # outlook: likely direction, battleground strike, expected range (flow.ideas.outlook); None when unavailable
    outlook: Optional[dict] = None
    data_source: str = "yfinance"
    error: Optional[str] = None
    as_of: Optional[str] = None    # ISO UTC time this result was computed
    stale: bool = False            # True when served from cache because the data source is rate-limiting
    # [(key, volume, premium per contract)] for flow.traded; not part of the API payload
    contracts: List[tuple] = field(default_factory=list, repr=False)


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
    iv = pd.to_numeric(df["iv"], errors="coerce").fillna(0.0)
    bs = _bs_gamma_vec(spot, pd.to_numeric(df["strike"], errors="coerce").fillna(0.0),
                       pd.to_numeric(df["T"], errors="coerce").fillna(0.0), iv, r) if spot > 0 else 0.0
    df["gamma"] = feed.where(feed > 0, bs).fillna(0.0).astype(float)      # vectorised; same rules as bs_gamma
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
    sign = np.where(df["otype"] == "call", 1.0, -1.0)
    df["gex"] = df["gex_raw"] * sign
    # VEX: Black-Scholes vanna from IV/T, × OI × lot_size × spot × 0.01; calls +, puts −
    if len(df) and "iv" in df.columns and "T" in df.columns:
        vanna = _bs_vanna_vec(spot, pd.to_numeric(df["strike"], errors="coerce").fillna(0.0),
                              pd.to_numeric(df["T"], errors="coerce").fillna(0.0),
                              pd.to_numeric(df["iv"], errors="coerce").fillna(0.0))
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
    try:
        provider = get_market_data()
        chain = provider.option_chain(sym)
    except MarketDataRateLimited:
        raise                       # let the flow service serve the last good result
    except Exception as e:
        return GEXResult(symbol=display_sym, spot=0.0, expiries=[], error=str(e),
                         as_of=datetime.now(timezone.utc).isoformat(timespec="seconds"))
    source = chain.source or provider.name
    filled = _fill_gamma(chain.rows, chain.spot)
    if filled is not None and not filled.empty and chain.spot and chain.spot > 0:
        with _chains_lock:
            _chains[display_sym.upper()] = _Chain(sym, display_sym, chain.spot, filled, source, time.monotonic())
    return _build(display_sym, sym, chain.spot, filled, source)


# ── Last chain per symbol, for re-pricing at a new spot (respot) ─────────────
@dataclass
class _Chain:
    sym: str                # provider symbol ("^SPX")
    display: str            # as the user typed it ("SPX")
    spot: float             # spot the chain was fetched at
    rows: pd.DataFrame      # chain rows (CHAIN_COLUMNS) with gamma filled at `spot` (_fill_gamma)
    source: str
    fetched: float          # time.monotonic() of the fetch


_chains: dict[str, "_Chain"] = {}
_chains_lock = threading.Lock()


def chain_age(symbol: str) -> Optional[float]:
    """Seconds since `symbol`'s chain was last fetched, or None when there is none."""
    c = _chains.get(symbol.upper())
    return None if c is None else time.monotonic() - c.fetched


def chain_symbol(symbol: str) -> Optional[str]:
    """The provider symbol of `symbol`'s cached chain ("^SPX" for "SPX"), or None."""
    c = _chains.get(symbol.upper())
    return None if c is None else c.sym


def chain_rows(symbol: str) -> Optional[tuple]:
    """(spot, rows) of `symbol`'s last fetched chain, or None."""
    c = _chains.get(symbol.upper())
    return None if c is None else (c.spot, c.rows)


def clear_chains() -> None:
    with _chains_lock:
        _chains.clear()


def respot_gex(symbol: str, spot: float) -> Optional[GEXResult]:
    """The GEX result for `symbol`'s last fetched chain re-priced at `spot`, without fetching anything.

    Open interest, IV, volume and quotes stay as fetched; only the spot moves. Gamma is re-priced with
    Black-Scholes: a feed gamma is scaled by BS(new spot) / BS(fetch spot), so the result lines up with the
    next full refresh. None when there is no cached chain or the spot is unusable.
    """
    c = _chains.get(symbol.upper())
    if c is None or not spot or spot <= 0:
        return None
    df = c.rows
    if abs(spot - c.spot) > 1e-9 and not df.empty:
        df = df.copy()
        iv = pd.to_numeric(df["iv"], errors="coerce").fillna(0.0)
        k, t = df["strike"].astype(float), pd.to_numeric(df["T"], errors="coerce").fillna(0.0)
        old = _bs_gamma_vec(c.spot, k, t, iv)
        new = _bs_gamma_vec(spot, k, t, iv)
        ratio = (new / old.where(old > 0)).where(old > 0)
        df["gamma"] = (df["gamma"] * ratio).where(ratio.notna(), new)
    return _build(c.display, c.sym, spot, df, c.source, with_contracts=False)


def _bs_gamma_vec(S: float, K: pd.Series, T: pd.Series, sigma: pd.Series, r: float = 0.045) -> pd.Series:
    """Vectorised bs_gamma (same guards: 0 for T ≤ 0, IV < 0.5 %, or a bad strike)."""
    ok = (T > 0) & (sigma >= 0.005) & (K > 0) & (S > 0)
    Ts, sg, Ks = T.where(ok, 1.0), sigma.where(ok, 1.0), K.where(ok, 1.0)
    st = sg * np.sqrt(Ts)
    d1 = (np.log(S / Ks) + (r + 0.5 * sg ** 2) * Ts) / st
    g = np.exp(-0.5 * d1 ** 2) / math.sqrt(2 * math.pi) / (S * st)
    return g.where(ok, 0.0)


def _bs_vanna_vec(S: float, K: pd.Series, T: pd.Series, sigma: pd.Series, r: float = 0.045) -> pd.Series:
    """Vectorised bs_vanna (same guards)."""
    ok = (T > 0) & (sigma >= 0.005) & (K > 0) & (S > 0)
    Ts, sg, Ks = T.where(ok, 1.0), sigma.where(ok, 1.0), K.where(ok, 1.0)
    st = sg * np.sqrt(Ts)
    d1 = (np.log(S / Ks) + (r + 0.5 * sg ** 2) * Ts) / st
    v = -np.exp(-0.5 * d1 ** 2) / math.sqrt(2 * math.pi) * (d1 - st) / sg
    return v.where(ok, 0.0)


def _build(display_sym: str, sym: str, spot: float, df: pd.DataFrame, source: str,
           with_contracts: bool = True) -> GEXResult:
    """Everything computed from a chain whose gamma is already filled (see _fill_gamma) at `spot`.
    `with_contracts=False` (respot) skips the per-contract rows that only traded-premium tracking reads."""
    result = GEXResult(symbol=display_sym, spot=0.0, expiries=[],
                       as_of=datetime.now(timezone.utc).isoformat(timespec="seconds"))

    try:
        result.spot = round(spot, 2)
        result.data_source = source

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

        # Max pain (nearest expiry) and ATM IV; never fatal
        try:
            from optionflow.modules.flow import chain_stats
            result.max_pain_expiry = expiries[0]
            result.max_pain = chain_stats.max_pain(df, expiries[0])
            iv = chain_stats.atm_iv(df, spot)
            result.atm_iv_near, result.atm_iv_near_expiry, result.atm_iv_30d = iv["near"], iv["near_expiry"], iv["d30"]
        except Exception:
            pass

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

        # ── Trade ideas off the levels (never fatal: the board works without them) ──
        try:
            from optionflow.modules.flow.ideas import trade_ideas
            result.ideas = trade_ideas(df, spot, net_gex=result.net_gex, zero_gamma=result.zero_gamma,
                                       call_wall=result.max_call_wall, put_wall=result.max_put_wall,
                                       king=result.max_gex_strike)
        except Exception:
            result.ideas = []

        # ── Net flow: premium dollars changing hands ──────────────────────────
        # premium = OI × mid × lot_size  (proxy for committed capital)
        df["premium"] = df["oi"] * df["mid"] * lot_size
        call_df = df[df["otype"] == "call"]
        put_df  = df[df["otype"] == "put"]

        result.call_premium = float(call_df["premium"].sum())
        result.put_premium  = float(put_df["premium"].sum())
        result.net_flow     = result.call_premium - result.put_premium
        result.total_volume = int(df["volume"].sum())
        try:
            from optionflow.modules.flow.traded import contracts
            result.contracts = contracts(df, lot_size, spot) if with_contracts else []
        except Exception:
            result.contracts = []

        try:
            from optionflow.modules.flow.ideas import outlook
            result.outlook = outlook(df, spot, strikes=result.strikes, call_gex=result.call_gex_by_strike,
                                     put_gex=result.put_gex_by_strike, net_gex=result.net_gex,
                                     zero_gamma=result.zero_gamma, call_wall=result.max_call_wall,
                                     put_wall=result.max_put_wall, king=result.max_gex_strike,
                                     call_premium=result.call_premium, put_premium=result.put_premium)
        except Exception:
            result.outlook = None

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

        # Every fetched expiry (up to HEATMAP_EXPIRIES): the board shows the first 6 unless the owner picks
        # others in the per-table expiry dropdown (C-93)
        heatmap_expiries = expiries[:HEATMAP_EXPIRIES]

        # expiry × strike sums in one pass (a per-strike loop cost most of a 1 s respot)
        grid = df[df["expiry"].isin(heatmap_expiries)].groupby(["expiry", "strike"])[["gex", "vex"]].sum()
        heatmap_values: list[list[float]] = []
        heatmap_vex_values: list[list[float]] = []
        for metric, out in (("gex", heatmap_values), ("vex", heatmap_vex_values)):
            table = grid[metric].unstack("strike").reindex(index=heatmap_expiries, columns=heatmap_strikes).fillna(0.0)
            out.extend([[float(v) for v in row] for row in table.to_numpy()])

        result.heatmap_expiries = heatmap_expiries
        result.heatmap_strikes = heatmap_strikes
        result.heatmap_values = heatmap_values
        result.heatmap_vex_values = heatmap_vex_values

    except MarketDataRateLimited:
        raise                       # let the flow service serve the last good result
    except Exception as e:
        result.error = str(e)

    return result
