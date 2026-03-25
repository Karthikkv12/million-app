"""backend_api/routers/trades.py — Trade journal & order management routes."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query

from logic import services
from ..schemas import (
    AccountCreateRequest,
    AccountOut,
    HoldingOut,
    HoldingUpsertRequest,
    OrderCreateRequest,
    OrderFillRequest,
    OrderOut,
    TradeCloseRequest,
    TradeCreateRequest,
    TradeOut,
    TradeUpdateRequest,
)
from ..deps import get_current_user
from ..utils import df_records as _df_records

router = APIRouter(tags=["trades"])


# ── Accounts ──────────────────────────────────────────────────────────────────

@router.get("/accounts", response_model=List[AccountOut])
def list_accounts(user=Depends(get_current_user)) -> List[AccountOut]:
    rows = services.list_accounts(user_id=int(user["sub"]))
    return [AccountOut.model_validate(r) for r in rows]


@router.post("/accounts", response_model=AccountOut)
def create_account(req: AccountCreateRequest, user=Depends(get_current_user)) -> AccountOut:
    try:
        account_id = services.create_account(
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
        rows = services.list_holdings(user_id=int(user["sub"]), account_id=int(account_id))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return [HoldingOut.model_validate(r) for r in rows]


@router.put("/accounts/{account_id}/holdings", response_model=HoldingOut)
def upsert_account_holding(
    account_id: int, req: HoldingUpsertRequest, user=Depends(get_current_user)
) -> HoldingOut:
    try:
        r = services.upsert_holding(
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
    ok = services.delete_holding(user_id=int(user["sub"]), holding_id=int(holding_id))
    if not ok:
        raise HTTPException(status_code=404, detail="Holding not found")
    return {"status": "ok"}


# ── Orders ────────────────────────────────────────────────────────────────────

@router.get("/orders", response_model=List[OrderOut])
def list_orders(
    user=Depends(get_current_user),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> List[OrderOut]:
    rows = services.list_orders(user_id=int(user["sub"]), limit=limit, offset=offset)
    return [OrderOut.model_validate(r) for r in rows]


@router.post("/orders", response_model=Dict[str, Any])
def create_order(req: OrderCreateRequest, user=Depends(get_current_user)) -> Dict[str, Any]:
    try:
        oid = services.create_order(
            user_id=int(user["sub"]),
            symbol=req.symbol,
            instrument=req.instrument,
            action=req.action,
            strategy=req.strategy,
            qty=int(req.qty),
            limit_price=req.limit_price,
            client_order_id=req.client_order_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "ok", "order_id": int(oid)}


@router.post("/orders/{order_id}/cancel")
def cancel_order(order_id: int, user=Depends(get_current_user)) -> Dict[str, str]:
    ok = services.cancel_order(user_id=int(user["sub"]), order_id=int(order_id))
    if not ok:
        raise HTTPException(status_code=400, detail="Order not found or not cancelable")
    return {"status": "ok"}


@router.post("/orders/{order_id}/fill", response_model=Dict[str, Any])
def fill_order(order_id: int, req: OrderFillRequest, user=Depends(get_current_user)) -> Dict[str, Any]:
    try:
        trade_id = services.fill_order(
            user_id=int(user["sub"]),
            order_id=int(order_id),
            filled_price=float(req.filled_price),
            filled_at=req.filled_at,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "ok", "trade_id": int(trade_id)}


@router.post("/orders/{order_id}/sync")
def sync_order(order_id: int, user=Depends(get_current_user)) -> Dict[str, str]:
    ok = services.sync_order_status(user_id=int(user["sub"]), order_id=int(order_id))
    if not ok:
        raise HTTPException(status_code=400, detail="Order not found, not linked to broker, or broker disabled")
    return {"status": "ok"}


@router.post("/orders/sync-pending")
def sync_pending_orders(user=Depends(get_current_user)) -> Dict[str, int]:
    n = services.sync_pending_orders(user_id=int(user["sub"]))
    return {"status": 0, "updated": int(n)}


@router.post("/orders/{order_id}/fill-external", response_model=Dict[str, Any])
def fill_order_external(
    order_id: int, req: OrderFillRequest, user=Depends(get_current_user)
) -> Dict[str, Any]:
    try:
        trade_id = services.fill_order_via_broker(
            user_id=int(user["sub"]),
            order_id=int(order_id),
            filled_price=float(req.filled_price),
            filled_at=req.filled_at,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "ok", "trade_id": int(trade_id)}


@router.get("/orders/{order_id}/events", response_model=List[Dict[str, Any]])
def order_events(
    order_id: int,
    user=Depends(get_current_user),
    limit: int = Query(default=200, ge=1, le=1000),
) -> List[Dict[str, Any]]:
    import pandas as pd
    rows = services.list_order_events(
        user_id=int(user["sub"]), order_id=int(order_id), limit=int(limit)
    )
    return _df_records(pd.DataFrame(rows) if rows else pd.DataFrame())


# ── Trades ────────────────────────────────────────────────────────────────────

@router.get("/trades", response_model=List[TradeOut])
def list_trades(
    user=Depends(get_current_user),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> List[TradeOut]:
    rows = services.list_trades(user_id=int(user["sub"]), limit=limit, offset=offset)
    return [TradeOut.model_validate(r) for r in rows]


@router.get("/trades/{trade_id}", response_model=TradeOut)
def get_trade(trade_id: int, user=Depends(get_current_user)) -> TradeOut:
    row = services.get_trade(trade_id, user_id=int(user["sub"]))
    if row is None:
        raise HTTPException(status_code=404, detail="Trade not found")
    return TradeOut.model_validate(row)


@router.post("/trades", response_model=Dict[str, Any])
def create_trade(req: TradeCreateRequest, user=Depends(get_current_user)) -> Dict[str, Any]:
    trade_id = services.save_trade(
        req.symbol, req.instrument, req.strategy, req.action,
        req.qty, req.price, req.date,
        o_type=req.option_type,
        strike=req.strike,
        expiry=req.expiry,
        notes=req.notes,
        user_id=int(user["sub"]),
        client_order_id=req.client_order_id,
    )
    return {"status": "ok", "trade_id": int(trade_id)}


@router.put("/trades/{trade_id}", response_model=Dict[str, str])
def update_trade(
    trade_id: int, req: TradeUpdateRequest, user=Depends(get_current_user)
) -> Dict[str, str]:
    ok = services.update_trade(
        trade_id, req.symbol, req.strategy, req.action,
        req.qty, req.price, req.date,
        user_id=int(user["sub"]),
        notes=req.notes,
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Trade not found")
    return {"status": "ok"}


@router.post("/trades/{trade_id}/close", response_model=Dict[str, str])
def close_trade(
    trade_id: int, req: TradeCloseRequest, user=Depends(get_current_user)
) -> Dict[str, str]:
    ok = services.close_trade(
        trade_id, req.exit_price, exit_date=req.exit_date, user_id=int(user["sub"])
    )
    if not ok:
        raise HTTPException(status_code=400, detail="Trade not found or already closed")
    return {"status": "ok"}


@router.delete("/trades/{trade_id}", response_model=Dict[str, str])
def delete_trade(trade_id: int, user=Depends(get_current_user)) -> Dict[str, str]:
    ok = services.delete_trade(trade_id, user_id=int(user["sub"]))
    if not ok:
        raise HTTPException(status_code=404, detail="Trade not found")
    return {"status": "ok"}
