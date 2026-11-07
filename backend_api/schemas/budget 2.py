"""backend_api/schemas/budget.py — Cash, budget, overrides, and credit card Pydantic models."""
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


# ── Cash ──────────────────────────────────────────────────────────────────────

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


# ── Budget ────────────────────────────────────────────────────────────────────

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


# ── Budget overrides ──────────────────────────────────────────────────────────

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


# ── Credit cards ──────────────────────────────────────────────────────────────

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
