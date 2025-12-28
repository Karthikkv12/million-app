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
    token_type: str = "bearer"
    user_id: int
    username: str


class AuthMeResponse(BaseModel):
    user_id: int
    username: str


class AuthChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=1)


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
