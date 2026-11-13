"""optionflow/modules/risk/schemas.py — response shapes for /risk/vol-target and /risk/factors."""
from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


# ── Volatility targeting (voltarget.py) ───────────────────────────────────────
class VolTargetHolding(BaseModel):
    symbol: str
    spot: float
    net_delta: Optional[float] = Field(None, description="Lots (100 shares = 1.00), shares and options together")
    exposure: float = Field(..., description="Delta dollars: net Δ × 100 × spot")
    shares: float = 0
    has_options: bool = False
    weight: Optional[float] = Field(None, description="exposure ÷ capital")
    forecast: Optional[float] = Field(None, description="GARCH(1,1) forecast vol, annualised (decimal)")
    long_run: Optional[float] = None
    realized_20d: Optional[float] = None
    own_exposure: Optional[float] = Field(None, description="target ÷ this stock's own forecast, capped")
    risk_share: Optional[float] = Field(None, description="Share of portfolio variance (sums to 1)")
    suggested_exposure: Optional[float] = None
    change: Optional[float] = Field(None, description="Delta dollars to add (+) or cut (−)")
    change_shares: Optional[float] = Field(None, description="The change in share-equivalents (delta)")
    # Options (full repricing)
    atm_iv: Optional[float] = Field(None, description="The stock's ATM implied vol (decimal)")
    long_contracts: float = 0
    short_contracts: float = Field(0, description="Option contracts sold (positive number)")
    value: Optional[float] = Field(None, description="Worth now: shares at spot, options at mark (sold options negative)")
    max_loss: Optional[float] = Field(None, description="Most it can lose held to expiry; None with unlimited_loss")
    unlimited_loss: bool = Field(False, description="More calls sold than the shares and long calls cover")
    pnl_vol: Optional[float] = Field(None, description="Annual vol of its replayed daily P&L, as a fraction of capital")
    worst_day: Optional[float] = Field(None, description="Worst replayed day, $ lost")
    loss_99: Optional[float] = Field(None, description="1-in-100 replayed day, $ lost")
    contracts_after: Optional[Dict[str, float]] = Field(None, description="Long / sold contracts at the target scale")
    error: Optional[str] = None


class VolTargetPoint(BaseModel):
    date: str
    forecast: Optional[float] = None
    scale: Optional[float] = Field(None, description="What the rule would have scaled today's book by that day")


class VolTargetOut(BaseModel):
    as_of: str
    target: float
    cap: float
    capital: Optional[float] = Field(None, description="What weights and the cap are measured against")
    account_value: Optional[float] = None
    capital_source: Optional[Literal["input", "account", "gross"]] = None
    gross: float = 0
    net: float = 0
    method: Literal["delta", "repriced"] = Field("delta", description="delta: shares only; repriced: every option leg "
                                                 "repriced with Black-Scholes on each past day")
    vix_note: Optional[str] = Field(None, description="Set when implied vol couldn't follow VIX in the replay")
    worst_day: Optional[float] = Field(None, description="Worst replayed day for today's book, $ lost")
    loss_99: Optional[float] = Field(None, description="1-in-100 replayed day for today's book, $ lost")
    max_loss: Optional[float] = Field(None, description="Most the book can lose held to expiry; None if any is unlimited")
    unlimited: List[str] = Field([], description="Holdings with unlimited loss (calls sold beyond cover)")
    forecast: Optional[float] = Field(None, description="Portfolio GARCH forecast vol, annualised")
    long_run: Optional[float] = None
    realized_20d: Optional[float] = None
    scale: Optional[float] = Field(None, description="Multiply every holding's exposure by this")
    capped: bool = False
    max_scale: Optional[float] = Field(None, description="Largest scale the cap allows: cap × capital ÷ gross")
    sessions: int = 0
    holdings: List[VolTargetHolding] = []
    chart: List[VolTargetPoint] = []
    error: Optional[str] = None


# ── Factor exposure (factors.py) ──────────────────────────────────────────────
class FactorInfo(BaseModel):
    key: Literal["market", "tech", "size", "rates"]
    label: str
    etf: str
    minus: Optional[str] = Field(None, description="Subtracted ETF, e.g. QQQ − SPY for the tech tilt")
    about: str = ""


class HedgeLeg(BaseModel):
    symbol: str
    dollars: float = Field(..., description="Buy (+) or sell (−) this many dollars of the ETF")
    shares: Optional[float] = None


class BookFactor(BaseModel):
    key: Literal["market", "tech", "size", "rates"]
    beta: float = Field(..., description="% of capital the book moves per 1% factor move")
    dollar_per_pct: Optional[float] = Field(None, description="$ the book makes per +1% factor move")
    factor_vol: float = Field(..., description="The factor's own annual vol")
    risk: float = Field(..., description="Annual variance from this factor (can be negative when it offsets)")
    risk_share: Optional[float] = Field(None, description="Share of the book's variance")
    hedge: List[HedgeLeg] = Field([], description="ETF trades that take this beta to zero")


class BookFactors(BaseModel):
    factors: List[BookFactor]
    r2: Optional[float] = Field(None, description="Share of the book's daily moves the factors explain")
    vol: Optional[float] = Field(None, description="Book vol, annual, as % of capital")
    specific: float = 0
    specific_share: Optional[float] = Field(None, description="Share of variance no factor explains")
    factor_share: Optional[float] = None


class FactorHolding(BaseModel):
    symbol: str
    spot: float
    net_delta: Optional[float] = None
    exposure: float = Field(..., description="Delta dollars: net Δ × 100 × spot")
    shares: float = 0
    has_options: bool = False
    weight: Optional[float] = None
    betas: Optional[Dict[str, float]] = Field(None, description="factor key → beta of this stock")
    dollar_betas: Optional[Dict[str, float]] = Field(None, description="factor key → $ per 1% factor move")
    r2: Optional[float] = Field(None, description="Share of this stock's moves the factors explain")
    vol: Optional[float] = None
    specific_vol: Optional[float] = Field(None, description="Annual vol no factor explains")
    risk_share: Optional[float] = Field(None, description="Approximate share of the book's variance")
    error: Optional[str] = None


class FactorWindow(BaseModel):
    start: str
    end: str


class FactorsOut(BaseModel):
    as_of: str
    factors: List[FactorInfo]
    capital: Optional[float] = None
    account_value: Optional[float] = None
    capital_source: Optional[Literal["input", "account", "gross"]] = None
    gross: float = 0
    net: float = 0
    sessions: int = 0
    window: Optional[FactorWindow] = None
    prices: Dict[str, float] = {}
    book: Optional[BookFactors] = None
    holdings: List[FactorHolding] = []
    error: Optional[str] = None
