"""optionflow/modules/hedge/schemas.py — request/response models."""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class IngestPosition(BaseModel):
    account: Optional[str] = Field(None, description='Masked label, e.g. "Trading ••8453". Never a full account number.')
    symbol: str
    kind: Literal["stock", "option"]
    quantity: float = Field(..., description="Signed: long > 0, short < 0 (shares or contracts)")
    avg_price: Optional[float] = Field(None, ge=0, description="Per share; option premium per share")
    option_type: Optional[Literal["call", "put"]] = None
    strike: Optional[float] = Field(None, gt=0)
    expiry: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    multiplier: float = 100.0
    opened_at: Optional[str] = None


class IngestRequest(BaseModel):
    username: str
    source: Literal["robinhood"] = "robinhood"
    positions: List[IngestPosition]


class IngestOut(BaseModel):
    count: int
    synced_at: str


class BrokerPositionOut(IngestPosition):
    id: int
    source: str
    synced_at: str


class LegOut(BaseModel):
    kind: str
    quantity: float
    avg_price: Optional[float] = None
    otype: Optional[str] = None
    strike: Optional[float] = None
    expiry: Optional[str] = None
    dte: Optional[float] = None
    iv: Optional[float] = None
    delta: float
    gamma: float
    position_delta: float
    position_gamma: float


class SuggestionOut(BaseModel):
    action: Literal["SELL_CALL", "SELL_PUT", "BUY_PUT", "HOLD", "WAIT", "TRACK"]
    headline: str
    reasons: List[str] = []
    strike: Optional[float] = None
    expiry: Optional[str] = None
    otype: Optional[str] = None
    contracts: int = 0
    option_delta: Optional[float] = None
    premium: Optional[float] = None
    credit: Optional[float] = None
    net_delta_after: Optional[float] = None
    locked_gain: Optional[float] = None
    warnings: List[str] = []


class IvOut(BaseModel):
    atm_iv: Optional[float] = None
    iv_open: Optional[float] = None
    iv_roc_day: Optional[float] = None
    iv_roc_15m: Optional[float] = None
    iv_high: Optional[float] = None
    spike: bool = False
    cooling: bool = False
    hv10: Optional[float] = None
    hv20: Optional[float] = None
    hv60: Optional[float] = None


class LevelsOut(BaseModel):
    king: Optional[float] = None
    put_wall: Optional[float] = None
    call_wall: Optional[float] = None
    net_gex: Optional[float] = None
    zero_gamma: Optional[float] = None


class BookOut(BaseModel):
    symbol: str
    error: Optional[str] = None
    accounts: List[str] = []
    shares: Optional[float] = None
    avg_cost: Optional[float] = None
    lots: Optional[float] = None
    net_delta: Optional[float] = None
    net_gamma: Optional[float] = None
    dollar_gamma_1pct: Optional[float] = None
    target_delta: Optional[float] = None
    regime: Optional[Literal["bull", "high-vol"]] = None
    gap: Optional[float] = None
    iv_hv: Optional[float] = None
    legs: List[LegOut] = []
    suggestion: Optional[SuggestionOut] = None
    spot: Optional[float] = None
    prev_close: Optional[float] = None
    day_change: Optional[float] = None
    day_high: Optional[float] = None
    weekly_expiry: Optional[str] = None
    chain_source: Optional[str] = None
    iv: Optional[IvOut] = None
    levels: Optional[LevelsOut] = None


class BooksOut(BaseModel):
    as_of: str
    synced_at: Optional[str] = None
    books: List[BookOut]
