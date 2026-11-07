"""backend_api/routers/trades.py — Accounts and account-linked holdings."""
from __future__ import annotations

import logging
from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException

from logic import trade_services
from ..schemas import (
    AccountCreateRequest,
    AccountOut,
    HoldingOut,
    HoldingUpsertRequest,
)
from optionflow.core.deps import get_current_user

logger = logging.getLogger("optionflow.trades")
router = APIRouter(tags=["trades"])


# ── Accounts ──────────────────────────────────────────────────────────────────

@router.get("/accounts", response_model=List[AccountOut])
def list_accounts(user=Depends(get_current_user)) -> List[AccountOut]:
    rows = trade_services.list_accounts(user_id=int(user["sub"]))
    return [AccountOut.model_validate(r) for r in rows]


@router.post("/accounts", response_model=AccountOut)
def create_account(req: AccountCreateRequest, user=Depends(get_current_user)) -> AccountOut:
    try:
        account_id = trade_services.create_account(
            user_id=int(user["sub"]),
            name=req.name,
            broker=req.broker,
            currency=req.currency,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return AccountOut(
        id=int(account_id), name=req.name,
        broker=req.broker, currency=str(req.currency).upper(),
    )


@router.get("/accounts/{account_id}/holdings", response_model=List[HoldingOut])
def list_account_holdings(account_id: int, user=Depends(get_current_user)) -> List[HoldingOut]:
    try:
        rows = trade_services.list_holdings(user_id=int(user["sub"]), account_id=int(account_id))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return [HoldingOut.model_validate(r) for r in rows]


@router.put("/accounts/{account_id}/holdings", response_model=HoldingOut)
def upsert_account_holding(
    account_id: int, req: HoldingUpsertRequest, user=Depends(get_current_user)
) -> HoldingOut:
    try:
        r = trade_services.upsert_holding(
            user_id=int(user["sub"]),
            account_id=int(account_id),
            symbol=req.symbol,
            quantity=float(req.quantity),
            avg_cost=req.avg_cost,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return HoldingOut.model_validate(r)


@router.delete("/holdings/{holding_id}")
def delete_account_holding(holding_id: int, user=Depends(get_current_user)) -> Dict[str, str]:
    ok = trade_services.delete_holding(user_id=int(user["sub"]), holding_id=int(holding_id))
    if not ok:
        raise HTTPException(status_code=404, detail="Holding not found")
    return {"status": "ok"}

