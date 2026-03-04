"""backend_api/schemas/trades.py — Accounts, holdings, and trades Pydantic models."""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


# ── Accounts & Holdings ───────────────────────────────────────────────────────

class AccountCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    broker: Optional[str] = None
    currency: str = Field(default="USD", min_length=1)


class AccountOut(BaseModel):
    id: int
    name: str
    broker: Optional[str] = None
    currency: str
    created_at: Optional[datetime] = None


class HoldingUpsertRequest(BaseModel):
    symbol: str = Field(min_length=1)
    quantity: float
    avg_cost: Optional[float] = None


class HoldingOut(BaseModel):
    id: int
    account_id: int
    symbol: str
    quantity: float
    avg_cost: Optional[float] = None
    updated_at: Optional[datetime] = None



# ── Trades ────────────────────────────────────────────────────────────────────

class TradeCreateRequest(BaseModel):
    symbol: str
    instrument: str = "STOCK"
    strategy: str = "Swing"
    action: str
    qty: int = Field(ge=1)
    price: float = Field(gt=0)
    date: datetime
    option_type: Optional[str] = None
    strike: Optional[float] = None
    expiry: Optional[datetime] = None
    notes: Optional[str] = None
    account_id: Optional[int] = None
    client_order_id: Optional[str] = None


class TradeUpdateRequest(BaseModel):
    symbol: str
    strategy: str
    action: str
    qty: int = Field(ge=1)
    price: float = Field(gt=0)
    date: datetime
    notes: Optional[str] = None
    option_type: Optional[str] = None
    strike: Optional[float] = None
    expiry: Optional[datetime] = None


class TradeCloseRequest(BaseModel):
    exit_price: float
    exit_date: Optional[datetime] = None


class TradeOut(BaseModel):
    id: int
    symbol: str
    instrument: Optional[str] = None
    strategy: Optional[str] = None
    action: Optional[str] = None
    quantity: Optional[int] = None
    entry_price: Optional[float] = None
    entry_date: Optional[datetime] = None
    is_closed: bool = False
    exit_date: Optional[datetime] = None
    exit_price: Optional[float] = None
    realized_pnl: Optional[float] = None
    option_type: Optional[str] = None
    strike_price: Optional[float] = None
    expiry_date: Optional[datetime] = None
    notes: Optional[str] = None
    client_order_id: Optional[str] = None
    account_id: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
