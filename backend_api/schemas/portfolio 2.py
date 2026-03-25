"""backend_api/schemas/portfolio.py — Portfolio weeks, positions, holdings, and snapshots Pydantic models."""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


# ── Weekly options portfolio ──────────────────────────────────────────────────

class WeekCreateRequest(BaseModel):
    for_date: Optional[datetime] = None


class WeekUpdateRequest(BaseModel):
    account_value: Optional[float] = None
    notes: Optional[str] = None


class WeekCompleteRequest(BaseModel):
    account_value: Optional[float] = None


# ── Positions ─────────────────────────────────────────────────────────────────

class PositionCreateRequest(BaseModel):
    symbol: str = Field(min_length=1)
    contracts: int = Field(default=1, ge=1)
    strike: float = Field(gt=0)
    option_type: str  # CALL or PUT
    sold_date: Optional[datetime] = None
    expiry_date: Optional[datetime] = None
    premium_in: Optional[float] = None
    spot_price: Optional[float] = None
    holding_id: Optional[int] = None
    notes: Optional[str] = None


class PositionUpdateRequest(BaseModel):
    symbol: Optional[str] = None
    contracts: Optional[int] = Field(default=None, ge=1)
    strike: Optional[float] = Field(default=None, gt=0)
    option_type: Optional[str] = None
    sold_date: Optional[datetime] = None
    buy_date: Optional[datetime] = None
    expiry_date: Optional[datetime] = None
    premium_in: Optional[float] = None
    premium_out: Optional[float] = None
    spot_price: Optional[float] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    holding_id: Optional[int] = None


# ── Assignments ───────────────────────────────────────────────────────────────

class AssignmentCreateRequest(BaseModel):
    symbol: str = Field(min_length=1)
    shares_acquired: int = Field(ge=1)
    acquisition_price: float = Field(gt=0)
    net_option_premium: Optional[float] = None
    notes: Optional[str] = None


class AssignmentUpdateRequest(BaseModel):
    shares_acquired: Optional[int] = Field(default=None, ge=1)
    acquisition_price: Optional[float] = Field(default=None, gt=0)
    net_option_premium: Optional[float] = None
    notes: Optional[str] = None


# ── Stock holdings ────────────────────────────────────────────────────────────

class StockHoldingCreateRequest(BaseModel):
    symbol: str = Field(min_length=1)
    shares: float = Field(gt=0)
    cost_basis: Optional[float] = None
    avg_cost: Optional[float] = None
    company_name: Optional[str] = None
    notes: Optional[str] = None


class StockHoldingUpdateRequest(BaseModel):
    shares: Optional[float] = Field(default=None, gt=0)
    cost_basis: Optional[float] = None
    avg_cost: Optional[float] = None
    company_name: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None


# ── Portfolio value history ───────────────────────────────────────────────────

class PortfolioSnapshotCreateRequest(BaseModel):
    snapshot_date: datetime
    total_value: Optional[float] = None
    cash: Optional[float] = None
    stock_value: Optional[float] = None
    options_value: Optional[float] = None
    realized_pnl: Optional[float] = None
    unrealized_pnl: Optional[float] = None
    notes: Optional[str] = None


class PortfolioSnapshotOut(BaseModel):
    id: int
    snapshot_date: datetime
    total_value: Optional[float] = None
    cash: Optional[float] = None
    stock_value: Optional[float] = None
    options_value: Optional[float] = None
    realized_pnl: Optional[float] = None
    unrealized_pnl: Optional[float] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
