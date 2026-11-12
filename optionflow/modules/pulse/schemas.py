"""optionflow/modules/pulse/schemas.py — price alerts and paper trades."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class PriceAlertIn(BaseModel):
    symbol: str
    price: float = Field(..., gt=0)
    direction: Literal["above", "below"]
    note: Optional[str] = Field(None, max_length=200)


class PriceAlertPatch(BaseModel):
    """Changing price or direction re-arms a triggered alert."""
    price: Optional[float] = Field(None, gt=0)
    direction: Optional[Literal["above", "below"]] = None
    note: Optional[str] = Field(None, max_length=200)


class PriceAlertOut(BaseModel):
    id: int
    symbol: str
    price: float
    direction: Literal["above", "below"]
    note: Optional[str] = None
    created_at: str
    triggered_at: Optional[str] = Field(None, description="Set once, when the price first reached the level (UTC)")
    triggered_price: Optional[float] = None


class PaperTradeIn(BaseModel):
    symbol: str
    side: Literal["long", "short"]
    qty: float = Field(..., gt=0)
    entry: float = Field(..., gt=0)
    stop: Optional[float] = Field(None, gt=0)
    target: Optional[float] = Field(None, gt=0)
    note: Optional[str] = Field(None, max_length=200)
    status: Literal["planned", "open"] = Field("planned", description="'open' starts it at once, filled at entry")


class PaperTradePatch(BaseModel):
    """Levels / qty while planned or open (an open trade's entry is fixed); status 'closed' closes it at
    exit_price, or the current price when omitted."""
    qty: Optional[float] = Field(None, gt=0)
    entry: Optional[float] = Field(None, gt=0)
    stop: Optional[float] = Field(None, gt=0)
    target: Optional[float] = Field(None, gt=0)
    note: Optional[str] = Field(None, max_length=200)
    status: Optional[Literal["closed"]] = None
    exit_price: Optional[float] = Field(None, gt=0)


class PaperTradeOut(BaseModel):
    id: int
    symbol: str
    side: Literal["long", "short"]
    qty: float
    entry: float
    stop: Optional[float] = None
    target: Optional[float] = None
    status: Literal["planned", "open", "stopped", "target", "closed"]
    note: Optional[str] = None
    created_at: str
    opened_at: Optional[str] = None
    closed_at: Optional[str] = None
    exit_price: Optional[float] = None
    created_price: Optional[float] = Field(None, description="Price when planned: entry triggers when crossed from this side")
