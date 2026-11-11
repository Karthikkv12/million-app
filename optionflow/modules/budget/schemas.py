"""optionflow/modules/budget/schemas.py — cash, budget, overrides, credit cards, ledger."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict

from optionflow.modules.portfolio.schemas import Num, Out, StatusOut, Str  # shared response helpers

__all__ = ["StatusOut"]


# ── Requests ───────────────────────────────────────────────────────────────────
class CashCreateRequest(BaseModel):
    action: str
    amount: float
    date: datetime
    notes: str = ""


class CashUpdateRequest(BaseModel):
    action: Optional[str] = None
    amount: Optional[float] = None
    date: Optional[datetime] = None
    notes: Optional[str] = None


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


class BudgetOverrideRequest(BaseModel):
    budget_id: int
    month_key: str   # YYYY-MM
    amount: float
    description: Optional[str] = None


class CreditCardWeekRequest(BaseModel):
    week_start: datetime
    balance: float
    squared_off: bool = False
    paid_amount: Optional[float] = None
    note: Optional[str] = None
    card_name: Optional[str] = None


# ── Responses ──────────────────────────────────────────────────────────────────
class IdOut(BaseModel):
    id: int


class CreatedOut(BaseModel):
    id: int
    status: str = "ok"


class CashFlowOut(Out):
    id: Optional[int] = None
    action: Str = None
    amount: Num = None
    date: Str = None
    notes: Str = None


class CashOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    action: str
    amount: float
    date: datetime
    notes: Optional[str] = None


class CashBalanceOut(BaseModel):
    currency: str
    balance: float


class BudgetEntryOut(Out):
    id: Optional[int] = None
    category: Str = None
    type: Str = None
    entry_type: Str = None
    recurrence: Str = None
    amount: Num = None
    date: Str = None
    description: Str = None
    merchant: Str = None
    active_until: Str = None


class BudgetSummaryOut(Out):
    total_income: Num = None
    total_expense: Num = None
    net: Num = None
    entry_count: Optional[int] = None
    by_type: Optional[Dict[str, Any]] = None       # type -> total
    by_category: Optional[Dict[str, Any]] = None   # category -> total


class BudgetOverrideOut(Out):
    id: Optional[int] = None
    budget_id: Optional[int] = None
    month_key: Str = None
    amount: Num = None
    description: Str = None


class CreditCardWeekOut(Out):
    id: Optional[int] = None
    card_name: Str = None
    week_start: Str = None
    balance: Num = None
    squared_off: Optional[bool] = None
    paid_amount: Num = None
    note: Str = None
    created_at: Str = None
    updated_at: Str = None


class LedgerLineOut(Out):
    account: Str = None
    account_type: Str = None
    amount: Num = None
    currency: Str = None


class LedgerEntryOut(Out):
    id: Optional[int] = None
    entry_type: Str = None
    source_type: Str = None
    source_id: Optional[int] = None
    idempotency_key: Str = None
    description: Str = None
    effective_at: Str = None
    created_at: Str = None
    lines: List[LedgerLineOut] = []
