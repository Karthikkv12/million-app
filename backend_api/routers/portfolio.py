"""backend_api/routers/portfolio.py — Portfolio, holdings, options positions & premium routes."""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from logic.holdings import (
    apply_position_status_change,
    create_holding,
    delete_holding,
    list_holding_events,
    list_holdings,
    recalculate_all_holdings,
    seed_holdings_from_positions,
    update_holding,
)
from logic.portfolio import (
    create_assignment,
    create_position,
    delete_position,
    get_assignment_for_position,
    get_or_create_week,
    get_week,
    list_all_positions,
    list_positions,
    list_weeks,
    mark_week_complete,
    portfolio_summary,
    reopen_week,
    symbol_summary,
    update_assignment,
    update_position,
    update_week,
    parse_dt,
    list_broker_accounts,
    create_broker_account,
    update_broker_account,
    delete_broker_account,
    upsert_account_balance,
    delete_account_balance,
    list_account_balances,
    list_account_balance_years,
    list_all_account_balances,
    list_cash_deposits,
    upsert_cash_deposit,
    delete_cash_deposit,
)
from logic.premium_ledger import get_premium_dashboard, get_premium_summary, sync_ledger_from_positions
from logic import services as _services
from ..deps import get_current_user
from ..schemas import (
    AssignmentCreateRequest,
    AssignmentUpdateRequest,
    PortfolioSnapshotCreateRequest,
    PortfolioSnapshotOut,
    PositionCreateRequest,
    PositionUpdateRequest,
    StockHoldingCreateRequest,
    StockHoldingUpdateRequest,
    WeekCompleteRequest,
    WeekCreateRequest,
    WeekUpdateRequest,
)

logger = logging.getLogger("optionflow.portfolio")
router = APIRouter(prefix="/portfolio", tags=["portfolio"])


# ── Weekly snapshots ──────────────────────────────────────────────────────────

@router.get("/weeks", response_model=List[Dict[str, Any]])
def list_weeks_route(user=Depends(get_current_user)) -> List[Dict[str, Any]]:
    return list_weeks(user_id=int(user["sub"]))


@router.post("/weeks", response_model=Dict[str, Any])
def get_or_create_week_route(body: WeekCreateRequest, user=Depends(get_current_user)) -> Dict[str, Any]:
    return get_or_create_week(user_id=int(user["sub"]), for_date=parse_dt(body.for_date))


@router.get("/weeks/{week_id}", response_model=Dict[str, Any])
def get_week_route(week_id: int, user=Depends(get_current_user)) -> Dict[str, Any]:
    w = get_week(user_id=int(user["sub"]), week_id=week_id)
    if w is None:
        raise HTTPException(status_code=404, detail="Week not found")
    return w


@router.patch("/weeks/{week_id}", response_model=Dict[str, Any])
def update_week_route(week_id: int, body: WeekUpdateRequest, user=Depends(get_current_user)) -> Dict[str, Any]:
    try:
        return update_week(
            user_id=int(user["sub"]), week_id=week_id,
            account_value=body.account_value, notes=body.notes,
            acct_label_1=body.acct_label_1, acct_val_1=body.acct_val_1,
            acct_label_2=body.acct_label_2, acct_val_2=body.acct_val_2,
            acct_label_3=body.acct_label_3, acct_val_3=body.acct_val_3,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/weeks/{week_id}/complete", response_model=Dict[str, Any])
def mark_week_complete_route(
    week_id: int, body: WeekCompleteRequest, user=Depends(get_current_user)
) -> Dict[str, Any]:
    try:
        return mark_week_complete(
            user_id=int(user["sub"]), week_id=week_id,
            account_value=body.account_value,
            acct_label_1=body.acct_label_1, acct_val_1=body.acct_val_1,
            acct_label_2=body.acct_label_2, acct_val_2=body.acct_val_2,
            acct_label_3=body.acct_label_3, acct_val_3=body.acct_val_3,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/weeks/{week_id}/reopen", response_model=Dict[str, Any])
def reopen_week_route(week_id: int, user=Depends(get_current_user)) -> Dict[str, Any]:
    try:
        return reopen_week(user_id=int(user["sub"]), week_id=week_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── Positions ─────────────────────────────────────────────────────────────────

@router.get("/positions", response_model=List[Dict[str, Any]])
def list_all_positions_route(user=Depends(get_current_user)) -> List[Dict[str, Any]]:
    """Return all positions across all weeks for the authenticated user."""
    return list_all_positions(user_id=int(user["sub"]))


@router.get("/weeks/{week_id}/positions", response_model=List[Dict[str, Any]])
def list_positions_route(week_id: int, user=Depends(get_current_user)) -> List[Dict[str, Any]]:
    return list_positions(user_id=int(user["sub"]), week_id=week_id)


@router.post("/weeks/{week_id}/positions", response_model=Dict[str, Any])
def create_position_route(
    week_id: int, body: PositionCreateRequest, user=Depends(get_current_user)
) -> Dict[str, Any]:
    try:
        return create_position(user_id=int(user["sub"]), week_id=week_id, data=body.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/positions/{position_id}", response_model=Dict[str, Any])
def update_position_route(
    position_id: int, body: PositionUpdateRequest, user=Depends(get_current_user)
) -> Dict[str, Any]:
    try:
        data = body.model_dump(exclude_unset=True)
        result = update_position(user_id=int(user["sub"]), position_id=position_id, data=data)
        if body.status is not None:
            try:
                apply_position_status_change(
                    user_id=int(user["sub"]),
                    position_id=position_id,
                    new_status=body.status,
                )
            except Exception as exc:
                logger.warning(
                    "apply_position_status_change failed for position %s: %s", position_id, exc
                )
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/positions/{position_id}")
def delete_position_route(position_id: int, user=Depends(get_current_user)) -> Dict[str, str]:
    try:
        delete_position(user_id=int(user["sub"]), position_id=position_id)
        return {"status": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── Assignments ───────────────────────────────────────────────────────────────

@router.post("/positions/{position_id}/assign", response_model=Dict[str, Any])
def create_assignment_route(
    position_id: int, body: AssignmentCreateRequest, user=Depends(get_current_user)
) -> Dict[str, Any]:
    try:
        return create_assignment(user_id=int(user["sub"]), position_id=position_id, data=body.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/positions/{position_id}/assignment", response_model=Dict[str, Any])
def get_assignment_route(position_id: int, user=Depends(get_current_user)) -> Dict[str, Any]:
    a = get_assignment_for_position(user_id=int(user["sub"]), position_id=position_id)
    if a is None:
        raise HTTPException(status_code=404, detail="No assignment found")
    return a


@router.patch("/assignments/{assignment_id}", response_model=Dict[str, Any])
def update_assignment_route(
    assignment_id: int, body: AssignmentUpdateRequest, user=Depends(get_current_user)
) -> Dict[str, Any]:
    try:
        return update_assignment(
            user_id=int(user["sub"]), assignment_id=assignment_id, data=body.model_dump(exclude_unset=True)
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── Summary & symbols ─────────────────────────────────────────────────────────

@router.get("/summary", response_model=Dict[str, Any])
def portfolio_summary_route(user=Depends(get_current_user)) -> Dict[str, Any]:
    return portfolio_summary(user_id=int(user["sub"]))


@router.get("/symbols", response_model=List[Dict[str, Any]])
def symbol_summary_route(user=Depends(get_current_user)) -> List[Dict[str, Any]]:
    return symbol_summary(user_id=int(user["sub"]))


# ── Stock Holdings ────────────────────────────────────────────────────────────

@router.get("/holdings", response_model=List[Dict[str, Any]])
def list_stock_holdings(user=Depends(get_current_user)) -> List[Dict[str, Any]]:
    return list_holdings(user_id=int(user["sub"]))


@router.post("/holdings", response_model=Dict[str, Any])
def create_stock_holding(body: StockHoldingCreateRequest, user=Depends(get_current_user)) -> Dict[str, Any]:
    try:
        return create_holding(user_id=int(user["sub"]), data=body.model_dump())
    except (ValueError, KeyError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/holdings/seed-from-positions", response_model=Dict[str, Any])
def seed_holdings_from_positions_route(user=Depends(get_current_user)) -> Dict[str, Any]:
    return seed_holdings_from_positions(user_id=int(user["sub"]))


@router.post("/holdings/recalculate", response_model=Dict[str, Any])
def recalculate_holdings(user=Depends(get_current_user)) -> Dict[str, Any]:
    return recalculate_all_holdings(user_id=int(user["sub"]))


@router.post("/holdings/sync-ledger", response_model=Dict[str, Any])
def sync_premium_ledger(user=Depends(get_current_user)) -> Dict[str, Any]:
    sync_result = sync_ledger_from_positions(user_id=int(user["sub"]))
    recalc_result = recalculate_all_holdings(user_id=int(user["sub"]))
    return {"synced_rows": sync_result["upserted"], "updated_holdings": recalc_result["updated"]}


@router.get("/premium-dashboard", response_model=Dict[str, Any])
def get_premium_dashboard_route(user=Depends(get_current_user)) -> Dict[str, Any]:
    return get_premium_dashboard(user_id=int(user["sub"]))


@router.get("/holdings/{holding_id}/premium-ledger", response_model=Dict[str, Any])
def get_holding_premium_ledger(holding_id: int, user=Depends(get_current_user)) -> Dict[str, Any]:
    return get_premium_summary(holding_id=holding_id)


@router.patch("/holdings/{holding_id}", response_model=Dict[str, Any])
def update_stock_holding(
    holding_id: int, body: StockHoldingUpdateRequest, user=Depends(get_current_user)
) -> Dict[str, Any]:
    try:
        return update_holding(user_id=int(user["sub"]), holding_id=holding_id, data=body.model_dump(exclude_unset=True))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/holdings/{holding_id}")
def delete_stock_holding(holding_id: int, user=Depends(get_current_user)) -> Dict[str, str]:
    try:
        delete_holding(user_id=int(user["sub"]), holding_id=holding_id)
        return {"status": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/holdings/{holding_id}/events", response_model=List[Dict[str, Any]])
def list_holding_events_route(holding_id: int, user=Depends(get_current_user)) -> List[Dict[str, Any]]:
    return list_holding_events(user_id=int(user["sub"]), holding_id=holding_id)


# ── Portfolio Value History ────────────────────────────────────────────────────

@router.get("/value-history", response_model=List[PortfolioSnapshotOut])
def list_portfolio_value_history(
    user=Depends(get_current_user),
    limit: int = Query(default=365, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> List[PortfolioSnapshotOut]:
    rows = _services.list_portfolio_snapshots(user_id=int(user["sub"]), limit=limit, offset=offset)
    return [PortfolioSnapshotOut.model_validate(r) for r in rows]


@router.post("/value-history", response_model=PortfolioSnapshotOut)
def upsert_portfolio_value_history(
    body: PortfolioSnapshotCreateRequest, user=Depends(get_current_user)
) -> PortfolioSnapshotOut:
    try:
        row = _services.upsert_portfolio_snapshot(
            user_id=int(user["sub"]),
            snapshot_date=body.snapshot_date,
            total_value=body.total_value,
            cash=body.cash,
            stock_value=body.stock_value,
            options_value=body.options_value,
            realized_pnl=body.realized_pnl,
            unrealized_pnl=body.unrealized_pnl,
            notes=body.notes,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return PortfolioSnapshotOut.model_validate(row)


# ── Broker Accounts ───────────────────────────────────────────────────────────

@router.get("/broker-accounts", response_model=List[Dict[str, Any]])
def list_broker_accounts_route(user=Depends(get_current_user)) -> List[Dict[str, Any]]:
    return list_broker_accounts(user_id=int(user["sub"]))


@router.post("/broker-accounts", response_model=Dict[str, Any])
def create_broker_account_route(body: Dict[str, Any], user=Depends(get_current_user)) -> Dict[str, Any]:
    return create_broker_account(
        user_id=int(user["sub"]),
        name=body["name"],
        color=body.get("color"),
        sort_order=body.get("sort_order", 0),
    )


@router.patch("/broker-accounts/{account_id}", response_model=Dict[str, Any])
def update_broker_account_route(account_id: int, body: Dict[str, Any], user=Depends(get_current_user)) -> Dict[str, Any]:
    try:
        return update_broker_account(
            user_id=int(user["sub"]), account_id=account_id,
            name=body.get("name"), color=body.get("color"),
            sort_order=body.get("sort_order"), is_active=body.get("is_active"),
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/broker-accounts/{account_id}")
def delete_broker_account_route(account_id: int, user=Depends(get_current_user)) -> Dict[str, str]:
    try:
        delete_broker_account(user_id=int(user["sub"]), account_id=account_id)
        return {"status": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── Account Balances ──────────────────────────────────────────────────────────

@router.get("/account-balances/years", response_model=List[int])
def list_account_balance_years_route(user=Depends(get_current_user)) -> List[int]:
    return list_account_balance_years(user_id=int(user["sub"]))


@router.get("/account-balances/all", response_model=List[Dict[str, Any]])
def list_all_account_balances_route(user=Depends(get_current_user)) -> List[Dict[str, Any]]:
    """Return every account balance row across all years (for chart use)."""
    return list_all_account_balances(user_id=int(user["sub"]))


@router.get("/account-balances", response_model=List[Dict[str, Any]])
def list_account_balances_route(
    year: int = Query(...), user=Depends(get_current_user)
) -> List[Dict[str, Any]]:
    return list_account_balances(user_id=int(user["sub"]), year=year)


@router.put("/account-balances", response_model=Dict[str, Any])
def upsert_account_balance_route(body: Dict[str, Any], user=Depends(get_current_user)) -> Dict[str, Any]:
    try:
        return upsert_account_balance(
            user_id=int(user["sub"]),
            account_id=int(body["account_id"]),
            week_date=body["week_date"],
            balance=float(body["balance"]),
        )
    except (KeyError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/account-balances/{account_id}/{week_date}")
def delete_account_balance_route(
    account_id: int, week_date: str, user=Depends(get_current_user)
) -> Dict[str, str]:
    delete_account_balance(user_id=int(user["sub"]), account_id=account_id, week_date=week_date)
    return {"status": "ok"}


# ── Cash Deposits ─────────────────────────────────────────────────────────────

@router.get("/cash-deposits", response_model=List[Dict[str, Any]])
def list_cash_deposits_route(user=Depends(get_current_user)) -> List[Dict[str, Any]]:
    """Return all cash deposit/withdrawal events, oldest first."""
    return list_cash_deposits(user_id=int(user["sub"]))


@router.put("/cash-deposits", response_model=Dict[str, Any])
def upsert_cash_deposit_route(
    body: Dict[str, Any], user=Depends(get_current_user)
) -> Dict[str, Any]:
    """Create or update a cash deposit. Pass id in body to update an existing row."""
    try:
        return upsert_cash_deposit(
            user_id=int(user["sub"]),
            week_date=body["week_date"],
            amount=float(body["amount"]),
            note=body.get("note"),
            deposit_id=int(body["id"]) if body.get("id") else None,
        )
    except (KeyError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/cash-deposits/{deposit_id}")
def delete_cash_deposit_route(
    deposit_id: int, user=Depends(get_current_user)
) -> Dict[str, str]:
    try:
        delete_cash_deposit(user_id=int(user["sub"]), deposit_id=deposit_id)
        return {"status": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
