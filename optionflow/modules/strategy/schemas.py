"""optionflow/modules/strategy/schemas.py — request/response models."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class StrategyInfo(BaseModel):
    key: str
    name: str
    summary: str
    steps: List[List[str]]
    sides: str = Field(..., description="put | call | both: the legs it opens")
    buys_options: bool
    scanner: str = Field(..., description="What the scanner looks for with this strategy")
    defaults: Dict[str, Any]


class StrategySettingsOut(BaseModel):
    strategy: str
    rules: Dict[str, Any] = Field(..., description="Effective rules: the strategy's defaults + overrides")
    overrides: Dict[str, Any]
    scanner: Dict[str, Any] = Field(..., description="Scanner filters")
    notify: bool = Field(..., description="Push new scanner picks to every device")
    updated_at: Optional[str] = None


class StrategyOut(StrategySettingsOut):
    strategies: List[StrategyInfo]
    filters_default: Dict[str, Any]


class StrategyUpdate(BaseModel):
    strategy: Optional[str] = Field(None, max_length=40)
    rules: Optional[Dict[str, Any]] = Field(None, description="Overrides of the strategy's rules; {} = defaults")
    scanner: Optional[Dict[str, Any]] = Field(None, description="Scanner filters; {} = defaults")
    notify: Optional[bool] = None


class ScanRow(BaseModel):
    key: str
    symbol: str
    strategy: str
    action: str = Field(..., description="SELL_PUT | SELL_PUT_SPREAD | BUY_WRITE")
    headline: str
    strike: float
    long_strike: Optional[float] = None
    expiry: str
    dte: float
    delta: float
    premium: float
    credit: float
    yield_ann: Optional[float] = None
    collateral: Optional[float] = None
    max_loss: Optional[float] = None
    spot: float
    day_change: Optional[float] = None
    pullback: float
    rsi: Optional[float] = None
    sma200_gap: Optional[float] = None
    iv: Optional[float] = None
    hv20: Optional[float] = None
    iv_hv: Optional[float] = None
    iv_pctile: Optional[float] = None
    oi: int
    spread_pct: Optional[float] = None
    earnings: Optional[str] = None
    score: float
    reasons: List[str] = []
    found_at: Optional[str] = None
    notified: Optional[bool] = None


class ScanOut(BaseModel):
    as_of: Optional[str] = None
    strategy: Optional[str] = None
    strategy_name: Optional[str] = None
    universe: int = 0
    screened: int = 0
    chains: int = 0
    skipped: Dict[str, int] = {}
    seconds: Optional[float] = None
    rows: List[ScanRow] = []
    new: List[str] = []
    running: bool = False


class PicksOut(BaseModel):
    picks: List[ScanRow]
