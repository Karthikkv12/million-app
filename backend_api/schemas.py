from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, Field


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


class AuthMeResponse(BaseModel):
    user_id: int
    username: str


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


class TradeCreateRequest(BaseModel):
    symbol: str
    instrument: str
    strategy: str
    action: str
    qty: int
    price: float
    date: datetime
    client_order_id: Optional[str] = None


class TradeUpdateRequest(BaseModel):
    symbol: str
    strategy: str
    action: str
    qty: int
    price: float
    date: datetime


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


class BudgetCreateRequest(BaseModel):
    category: str
    type: str
    amount: float
    date: datetime
    description: str = ""


class BudgetOut(BaseModel):
    id: int
    category: str
    type: str
    amount: float
    date: datetime
    description: Optional[str] = None
