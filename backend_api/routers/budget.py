"""backend_api/routers/budget.py — Budget, cash flow, credit card & ledger routes."""
from __future__ import annotations

import logging
from typing import Any, Dict, List

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query

from logic import services
from ..schemas import (
    BudgetCreateOut,
    BudgetCreateRequest,
    BudgetOut,
    BudgetOverrideOut,
    BudgetOverrideRequest,
    CashCreateOut,
    CashCreateRequest,
    CashOut,
    CashUpdateRequest,
    CreditCardWeekOut,
    CreditCardWeekRequest,
)
from ..deps import get_current_user
from ..utils import df_records as _df_records

logger = logging.getLogger("optionflow.budget")
router = APIRouter(tags=["budget"])


# ── Cash ──────────────────────────────────────────────────────────────────────

@router.get("/cash", response_model=List[Dict[str, Any]])
def list_cash(
    user=Depends(get_current_user),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> List[Dict[str, Any]]:
    return services.list_cash_flows(user_id=int(user["sub"]), limit=limit, offset=offset)


@router.get("/cash/balance")
def cash_balance(user=Depends(get_current_user), currency: str = "USD") -> Dict[str, Any]:
    cur = str(currency or "USD").strip().upper() or "USD"
    bal = services.get_cash_balance(user_id=int(user["sub"]), currency=cur)
    return {"currency": cur, "balance": float(bal)}


@router.post("/cash", response_model=CashCreateOut)
def create_cash(req: CashCreateRequest, user=Depends(get_current_user)) -> CashCreateOut:
    row_id = services.save_cash(req.action, req.amount, req.date, req.notes, user_id=int(user["sub"]))
    return CashCreateOut(id=int(row_id) if row_id is not None else 0)


@router.patch("/cash/{cash_id}", response_model=CashOut)
def update_cash(cash_id: int, req: CashUpdateRequest, user=Depends(get_current_user)) -> CashOut:
    row = services.update_cash(
        cash_id, int(user["sub"]),
        action=req.action,
        amount=req.amount,
        date=req.date,
        notes=req.notes,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Cash entry not found")
    return CashOut.model_validate(row)


@router.delete("/cash/{cash_id}", response_model=Dict[str, str])
def delete_cash(cash_id: int, user=Depends(get_current_user)) -> Dict[str, str]:
    ok = services.delete_cash(cash_id, int(user["sub"]))
    if not ok:
        raise HTTPException(status_code=404, detail="Cash entry not found")
    return {"status": "ok"}


# ── Budget ────────────────────────────────────────────────────────────────────

@router.get("/budget/summary", response_model=Dict[str, Any])
def budget_summary(user=Depends(get_current_user)) -> Dict[str, Any]:
    return services.get_budget_summary(user_id=int(user["sub"]))


@router.get("/budget", response_model=List[Dict[str, Any]])
def list_budget(
    user=Depends(get_current_user),
    limit: int = Query(default=500, ge=1, le=2000),
    offset: int = Query(default=0, ge=0),
) -> List[Dict[str, Any]]:
    return services.list_budget_entries(user_id=int(user["sub"]), limit=limit, offset=offset)


@router.post("/budget", response_model=BudgetCreateOut)
def create_budget(req: BudgetCreateRequest, user=Depends(get_current_user)) -> BudgetCreateOut:
    row_id = services.save_budget(
        req.category, req.type, req.amount, req.date, req.description,
        user_id=int(user["sub"]),
        entry_type=req.entry_type,
        recurrence=req.recurrence,
        merchant=req.merchant,
        active_until=req.active_until,
    )
    return BudgetCreateOut(id=int(row_id) if row_id is not None else 0)


@router.patch("/budget/{budget_id}")
def patch_budget(
    budget_id: int, req: BudgetCreateRequest, user=Depends(get_current_user)
) -> Dict[str, str]:
    services.update_budget(
        budget_id, user_id=int(user["sub"]),
        category=req.category, type=req.type,
        entry_type=req.entry_type, recurrence=req.recurrence,
        amount=req.amount, date=req.date, description=req.description,
        merchant=req.merchant, active_until=req.active_until,
    )
    return {"status": "ok"}


@router.delete("/budget/{budget_id}")
def remove_budget(budget_id: int, user=Depends(get_current_user)) -> Dict[str, str]:
    uid = int(user["sub"])
    services.delete_budget_overrides_for_entry(budget_id, user_id=uid)
    services.delete_budget(budget_id, user_id=uid)
    return {"status": "ok"}


# ── Budget Overrides ──────────────────────────────────────────────────────────

@router.get("/budget-overrides", response_model=List[Dict[str, Any]])
def list_overrides(user=Depends(get_current_user)) -> List[Dict[str, Any]]:
    return services.list_budget_overrides(user_id=int(user["sub"]))


@router.post("/budget-overrides", response_model=Dict[str, Any])
def upsert_override(
    req: BudgetOverrideRequest, user=Depends(get_current_user)
) -> Dict[str, Any]:
    oid = services.upsert_budget_override(
        user_id=int(user["sub"]),
        budget_id=req.budget_id,
        month_key=req.month_key,
        amount=req.amount,
        description=req.description,
    )
    return {"id": oid}


@router.delete("/budget-overrides/{override_id}")
def delete_override(override_id: int, user=Depends(get_current_user)) -> Dict[str, str]:
    services.delete_budget_override(override_id, user_id=int(user["sub"]))
    return {"status": "ok"}


# ── Credit Card Weeks ─────────────────────────────────────────────────────────

@router.get("/credit-card/weeks", response_model=List[Dict[str, Any]])
def list_cc_weeks(user=Depends(get_current_user)) -> List[Dict[str, Any]]:
    return services.list_credit_card_weeks(user_id=int(user["sub"]))


@router.post("/credit-card/weeks", response_model=Dict[str, Any])
def create_cc_week(
    req: CreditCardWeekRequest, user=Depends(get_current_user)
) -> Dict[str, Any]:
    row_id = services.create_credit_card_week(
        user_id=int(user["sub"]),
        week_start=req.week_start,
        balance=req.balance,
        squared_off=req.squared_off,
        paid_amount=req.paid_amount,
        note=req.note,
        card_name=req.card_name,
    )
    return {"id": row_id, "status": "ok"}


@router.patch("/credit-card/weeks/{row_id}", response_model=Dict[str, str])
def patch_cc_week(
    row_id: int, req: CreditCardWeekRequest, user=Depends(get_current_user)
) -> Dict[str, str]:
    services.update_credit_card_week(
        row_id, user_id=int(user["sub"]),
        week_start=req.week_start,
        balance=req.balance,
        squared_off=req.squared_off,
        paid_amount=req.paid_amount,
        note=req.note,
        card_name=req.card_name,
    )
    return {"status": "ok"}


@router.delete("/credit-card/weeks/{row_id}", response_model=Dict[str, str])
def delete_cc_week(row_id: int, user=Depends(get_current_user)) -> Dict[str, str]:
    services.delete_credit_card_week(row_id, user_id=int(user["sub"]))
    return {"status": "ok"}


# ── Ledger ────────────────────────────────────────────────────────────────────

@router.get("/ledger/cash-balance")
def ledger_cash_balance(user=Depends(get_current_user)) -> Dict[str, Any]:
    bal = services.get_cash_balance(user_id=int(user["sub"]), currency="USD")
    return {"currency": "USD", "balance": float(bal)}


@router.get("/ledger/entries", response_model=List[Dict[str, Any]])
def ledger_entries(
    user=Depends(get_current_user),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> List[Dict[str, Any]]:
    rows = services.list_ledger_entries(user_id=int(user["sub"]), limit=int(limit), offset=int(offset))
    return _df_records(pd.DataFrame(rows) if rows else pd.DataFrame())
