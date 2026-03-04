"""backend_api/schemas.py — Pydantic v2 request/response models."""
from datetime import date, datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


# ── Auth ─────────────────────────────────────────────────────────────────────

class AuthSignupRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class AuthLoginRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class AuthResponse(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None
    token_type: str = "bearer"
    user_id: int
    username: str
    role: str = "user"


class AuthMeResponse(BaseModel):
    user_id: int
    username: str
    role: str = "user"


class AuthChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=1)


class AuthRefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1)


class AuthLogoutRequest(BaseModel):
    refresh_token: Optional[str] = None


class AuthEventOut(BaseModel):
    created_at: Optional[datetime] = None
    event_type: str
    success: bool
    ip: Optional[str] = None
    detail: Optional[str] = None


class AuthSessionOut(BaseModel):
    id: int
    created_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None
    ip: Optional[str] = None
    user_agent: Optional[str] = None
    expires_at: Optional[datetime] = None


# ── Admin ─────────────────────────────────────────────────────────────────────

class AdminUserOut(BaseModel):
    user_id: int
    username: str
    role: str
    is_active: bool
    created_at: Optional[datetime] = None


class AdminCreateUserRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=6)
    role: str = Field(default="user", pattern="^(admin|user)$")


class AdminPatchUserRequest(BaseModel):
    username: Optional[str] = Field(default=None, min_length=1)
    password: Optional[str] = Field(default=None, min_length=6)
    role: Optional[str] = Field(default=None, pattern="^(admin|user)$")
    is_active: Optional[bool] = None


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


# ── Orders ────────────────────────────────────────────────────────────────────

class OrderCreateRequest(BaseModel):
    symbol: str = Field(min_length=1)
    instrument: str = Field(default="STOCK", min_length=1)
    action: str = Field(min_length=1)
    strategy: Optional[str] = None
    qty: int = Field(ge=1)
    limit_price: Optional[float] = None
    client_order_id: Optional[str] = None


class OrderFillRequest(BaseModel):
    filled_price: float = Field(gt=0)
    filled_at: Optional[datetime] = None


class OrderOut(BaseModel):
    id: int
    symbol: str
    instrument: str
    action: str
    strategy: Optional[str] = None
    quantity: int
    limit_price: Optional[float] = None
    status: str
    created_at: Optional[datetime] = None
    filled_at: Optional[datetime] = None
    filled_price: Optional[float] = None
    trade_id: Optional[int] = None
    client_order_id: Optional[str] = None
    external_order_id: Optional[str] = None
    venue: Optional[str] = None
    external_status: Optional[str] = None
    last_synced_at: Optional[datetime] = None


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


# ── Cash & Budget ─────────────────────────────────────────────────────────────

class CashCreateRequest(BaseModel):
    action: str
    amount: float
    date: datetime
    notes: str = ""


class CashOut(BaseModel):
    id: int
    action: str
    amount: float
    date: datetime
    notes: Optional[str] = None


class CashUpdateRequest(BaseModel):
    action: Optional[str] = None
    amount: Optional[float] = None
    date: Optional[datetime] = None
    notes: Optional[str] = None


class CashCreateOut(BaseModel):
    id: int
    status: str = "ok"


class BudgetCreateRequest(BaseModel):
    category: str
    type: Literal["INCOME", "EXPENSE", "ASSET"] = "EXPENSE"
    entry_type: Optional[str] = "FLOATING"
    recurrence: Optional[str] = None
    amount: float
    date: datetime
    description: str = ""
    merchant: Optional[str] = None
    active_until: Optional[str] = None   # YYYY-MM


class BudgetCreateOut(BaseModel):
    id: int
    status: str = "ok"


class BudgetOut(BaseModel):
    id: int
    category: str
    type: str
    entry_type: Optional[str] = None
    recurrence: Optional[str] = None
    amount: float
    date: datetime
    description: Optional[str] = None
    merchant: Optional[str] = None
    active_until: Optional[str] = None


class BudgetOverrideRequest(BaseModel):
    budget_id: int
    month_key: str   # 'YYYY-MM'
    amount: float
    description: Optional[str] = None


class BudgetOverrideOut(BaseModel):
    id: int
    budget_id: int
    month_key: str
    amount: float
    description: Optional[str] = None


# ── Credit Cards ──────────────────────────────────────────────────────────────

class CreditCardWeekRequest(BaseModel):
    week_start: datetime
    balance: float
    squared_off: bool = False
    paid_amount: Optional[float] = None
    note: Optional[str] = None
    card_name: Optional[str] = None


class CreditCardWeekOut(BaseModel):
    id: int
    week_start: datetime
    balance: float
    squared_off: bool
    paid_amount: Optional[float] = None
    note: Optional[str] = None
    card_name: Optional[str] = None


# ── Portfolio ─────────────────────────────────────────────────────────────────

class WeekCreateRequest(BaseModel):
    for_date: Optional[datetime] = None


class WeekUpdateRequest(BaseModel):
    account_value: Optional[float] = None
    notes: Optional[str] = None


class WeekCompleteRequest(BaseModel):
    account_value: Optional[float] = None


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


# ── Portfolio Value History ───────────────────────────────────────────────────

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
