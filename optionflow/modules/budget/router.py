"""optionflow/modules/budget/router.py — cash, budget, overrides, credit cards, ledger (HTTP only)."""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, Query

from optionflow.core.deps import get_current_user
from optionflow.modules.budget import service
from optionflow.modules.budget.schemas import (
    BudgetCreateRequest, BudgetEntryOut, BudgetOverrideOut, BudgetOverrideRequest, BudgetSummaryOut,
    CashBalanceOut, CashCreateRequest, CashFlowOut, CashOut, CashUpdateRequest, CreatedOut,
    CreditCardWeekOut, CreditCardWeekRequest, IdOut, LedgerEntryOut, StatusOut,
)

router = APIRouter(tags=["budget"])


def _uid(user) -> int:
    return int(user["sub"])


# ── Cash ───────────────────────────────────────────────────────────────────────
@router.get("/cash", response_model=List[CashFlowOut])
def list_cash(user=Depends(get_current_user), limit: int = Query(default=200, ge=1, le=1000),
              offset: int = Query(default=0, ge=0)):
    return service.list_cash_flows(user_id=_uid(user), limit=limit, offset=offset)


@router.get("/cash/balance", response_model=CashBalanceOut)
def cash_balance(user=Depends(get_current_user), currency: str = "USD"):
    return service.cash_balance(user_id=_uid(user), currency=currency)


@router.post("/cash", response_model=CreatedOut)
def create_cash(body: CashCreateRequest, user=Depends(get_current_user)):
    row_id = service.save_cash(body.action, body.amount, body.date, body.notes, user_id=_uid(user))
    return CreatedOut(id=int(row_id) if row_id is not None else 0)


@router.patch("/cash/{cash_id}", response_model=CashOut)
def update_cash(cash_id: int, body: CashUpdateRequest, user=Depends(get_current_user)):
    return service.update_cash_or_404(cash_id, _uid(user), action=body.action, amount=body.amount,
                                      date=body.date, notes=body.notes)


@router.delete("/cash/{cash_id}", response_model=StatusOut)
def delete_cash(cash_id: int, user=Depends(get_current_user)):
    service.delete_cash_or_404(cash_id, _uid(user))
    return StatusOut()


# ── Budget entries ─────────────────────────────────────────────────────────────
@router.get("/budget/summary", response_model=BudgetSummaryOut)
def budget_summary(user=Depends(get_current_user)):
    return service.get_budget_summary(user_id=_uid(user))


@router.get("/budget", response_model=List[BudgetEntryOut])
def list_budget(user=Depends(get_current_user), limit: int = Query(default=500, ge=1, le=2000),
                offset: int = Query(default=0, ge=0)):
    return service.list_budget_entries(user_id=_uid(user), limit=limit, offset=offset)


@router.post("/budget", response_model=CreatedOut)
def create_budget(body: BudgetCreateRequest, user=Depends(get_current_user)):
    row_id = service.save_budget(body.category, body.type, body.amount, body.date, body.description,
                                 user_id=_uid(user), entry_type=body.entry_type, recurrence=body.recurrence,
                                 merchant=body.merchant, active_until=body.active_until)
    return CreatedOut(id=int(row_id) if row_id is not None else 0)


@router.patch("/budget/{budget_id}", response_model=StatusOut)
def update_budget(budget_id: int, body: BudgetCreateRequest, user=Depends(get_current_user)):
    service.update_budget(budget_id, user_id=_uid(user), category=body.category, type=body.type,
                          entry_type=body.entry_type, recurrence=body.recurrence, amount=body.amount,
                          date=body.date, description=body.description, merchant=body.merchant,
                          active_until=body.active_until)
    return StatusOut()


@router.delete("/budget/{budget_id}", response_model=StatusOut)
def delete_budget(budget_id: int, user=Depends(get_current_user)):
    service.remove_budget_entry(budget_id, user_id=_uid(user))
    return StatusOut()


# ── Monthly overrides ──────────────────────────────────────────────────────────
@router.get("/budget-overrides", response_model=List[BudgetOverrideOut])
def list_overrides(user=Depends(get_current_user)):
    return service.list_budget_overrides(user_id=_uid(user))


@router.post("/budget-overrides", response_model=IdOut)
def upsert_override(body: BudgetOverrideRequest, user=Depends(get_current_user)):
    return IdOut(id=service.upsert_budget_override(user_id=_uid(user), budget_id=body.budget_id,
                                                    month_key=body.month_key, amount=body.amount,
                                                    description=body.description))


@router.delete("/budget-overrides/{override_id}", response_model=StatusOut)
def delete_override(override_id: int, user=Depends(get_current_user)):
    service.delete_budget_override(override_id, user_id=_uid(user))
    return StatusOut()


# ── Credit card weeks ──────────────────────────────────────────────────────────
@router.get("/credit-card/weeks", response_model=List[CreditCardWeekOut])
def list_cc_weeks(user=Depends(get_current_user)):
    return service.list_credit_card_weeks(user_id=_uid(user))


@router.post("/credit-card/weeks", response_model=CreatedOut)
def create_cc_week(body: CreditCardWeekRequest, user=Depends(get_current_user)):
    return CreatedOut(id=service.create_credit_card_week(user_id=_uid(user), **body.model_dump()))


@router.patch("/credit-card/weeks/{row_id}", response_model=StatusOut)
def update_cc_week(row_id: int, body: CreditCardWeekRequest, user=Depends(get_current_user)):
    service.update_credit_card_week(row_id, user_id=_uid(user), **body.model_dump())
    return StatusOut()


@router.delete("/credit-card/weeks/{row_id}", response_model=StatusOut)
def delete_cc_week(row_id: int, user=Depends(get_current_user)):
    service.delete_credit_card_week(row_id, user_id=_uid(user))
    return StatusOut()


# ── Ledger ─────────────────────────────────────────────────────────────────────
@router.get("/ledger/cash-balance", response_model=CashBalanceOut)
def ledger_cash_balance(user=Depends(get_current_user)):
    return service.cash_balance(user_id=_uid(user), currency="USD")


@router.get("/ledger/entries", response_model=List[LedgerEntryOut])
def ledger_entries(user=Depends(get_current_user), limit: int = Query(default=100, ge=1, le=1000),
                   offset: int = Query(default=0, ge=0)):
    return service.list_ledger_entries(user_id=_uid(user), limit=int(limit), offset=int(offset))
