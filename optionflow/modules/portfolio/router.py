"""optionflow/modules/portfolio/router.py — /portfolio and /accounts routes (HTTP only)."""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, Query

from optionflow.core.deps import get_current_user
from optionflow.modules.portfolio import (
    accounts, holdings, positions, premium_ledger, service, summary, trading_accounts, value_history, weeks,
)
from optionflow.modules.portfolio.schemas import (
    AccountBalanceOut, AccountBalanceUpsertRequest, AccountCreateRequest, AccountOut,
    AssignmentCreateRequest, AssignmentOut, AssignmentUpdateRequest,
    BrokerAccountCreateRequest, BrokerAccountOut, BrokerAccountUpdateRequest,
    CashDepositOut, CashDepositUpsertRequest, HoldingEventOut, HoldingOut, HoldingUpsertRequest,
    PortfolioSnapshotCreateRequest, PortfolioSnapshotOut, PortfolioSummaryOut,
    PositionCreateRequest, PositionOut, PositionUpdateRequest,
    PremiumDashboardOut, PremiumLedgerOut, RecalculateHoldingsOut, SeedHoldingsOut, StatusOut,
    StockHoldingCreateRequest, StockHoldingOut, StockHoldingUpdateRequest, SymbolSummaryOut, SyncLedgerOut,
    WeekCompleteRequest, WeekCreateRequest, WeekOut, WeekUpdateRequest,
)

router = APIRouter(prefix="/portfolio", tags=["portfolio"])
accounts_router = APIRouter(tags=["accounts"])


def _uid(user) -> int:
    return int(user["sub"])


# ── Weeks ──────────────────────────────────────────────────────────────────────
@router.get("/weeks", response_model=List[WeekOut])
def list_weeks(user=Depends(get_current_user)):
    return weeks.list_weeks(user_id=_uid(user))


@router.post("/weeks", response_model=WeekOut)
def get_or_create_week(body: WeekCreateRequest, user=Depends(get_current_user)):
    return service.get_or_create_week(_uid(user), body.for_date)


@router.get("/weeks/{week_id}", response_model=WeekOut)
def get_week(week_id: int, user=Depends(get_current_user)):
    return service.get_week(_uid(user), week_id)


@router.patch("/weeks/{week_id}", response_model=WeekOut)
def update_week(week_id: int, body: WeekUpdateRequest, user=Depends(get_current_user)):
    return service.update_week(_uid(user), week_id, **body.model_dump())


@router.post("/weeks/{week_id}/complete", response_model=WeekOut)
def complete_week(week_id: int, body: WeekCompleteRequest, user=Depends(get_current_user)):
    return service.complete_week(_uid(user), week_id, **body.model_dump())


@router.post("/weeks/{week_id}/reopen", response_model=WeekOut)
def reopen_week(week_id: int, user=Depends(get_current_user)):
    return service.reopen_week(_uid(user), week_id)


# ── Positions ──────────────────────────────────────────────────────────────────
@router.get("/positions", response_model=List[PositionOut])
def list_all_positions(user=Depends(get_current_user)):
    """All positions across all weeks."""
    return positions.list_all_positions(user_id=_uid(user))


@router.get("/weeks/{week_id}/positions", response_model=List[PositionOut])
def list_week_positions(week_id: int, user=Depends(get_current_user)):
    return positions.list_positions(user_id=_uid(user), week_id=week_id)


@router.post("/weeks/{week_id}/positions", response_model=PositionOut)
def create_position(week_id: int, body: PositionCreateRequest, user=Depends(get_current_user)):
    return service.create_position(_uid(user), week_id, body.model_dump())


@router.patch("/positions/{position_id}", response_model=PositionOut)
def update_position(position_id: int, body: PositionUpdateRequest, user=Depends(get_current_user)):
    return service.update_position(_uid(user), position_id, body.model_dump(exclude_unset=True))


@router.delete("/positions/{position_id}", response_model=StatusOut)
def delete_position(position_id: int, user=Depends(get_current_user)):
    service.delete_position(_uid(user), position_id)
    return StatusOut()


# ── Assignments ────────────────────────────────────────────────────────────────
@router.post("/positions/{position_id}/assign", response_model=AssignmentOut)
def create_assignment(position_id: int, body: AssignmentCreateRequest, user=Depends(get_current_user)):
    return service.create_assignment(_uid(user), position_id, body.model_dump())


@router.get("/positions/{position_id}/assignment", response_model=AssignmentOut)
def get_assignment(position_id: int, user=Depends(get_current_user)):
    return service.get_assignment(_uid(user), position_id)


@router.patch("/assignments/{assignment_id}", response_model=AssignmentOut)
def update_assignment(assignment_id: int, body: AssignmentUpdateRequest, user=Depends(get_current_user)):
    return service.update_assignment(_uid(user), assignment_id, body.model_dump(exclude_unset=True))


# ── Summaries ──────────────────────────────────────────────────────────────────
@router.get("/summary", response_model=PortfolioSummaryOut)
def portfolio_summary(user=Depends(get_current_user)):
    return summary.portfolio_summary(user_id=_uid(user))


@router.get("/symbols", response_model=List[SymbolSummaryOut])
def symbol_summary(user=Depends(get_current_user)):
    return summary.symbol_summary(user_id=_uid(user))


# ── Holdings ───────────────────────────────────────────────────────────────────
@router.get("/holdings", response_model=List[StockHoldingOut])
def list_holdings(user=Depends(get_current_user)):
    return holdings.list_holdings(user_id=_uid(user))


@router.post("/holdings", response_model=StockHoldingOut)
def create_holding(body: StockHoldingCreateRequest, user=Depends(get_current_user)):
    return service.create_holding(_uid(user), body.model_dump())


@router.post("/holdings/seed-from-positions", response_model=SeedHoldingsOut)
def seed_holdings(user=Depends(get_current_user)):
    return holdings.seed_holdings_from_positions(user_id=_uid(user))


@router.post("/holdings/recalculate", response_model=RecalculateHoldingsOut)
def recalculate_holdings(user=Depends(get_current_user)):
    return holdings.recalculate_all_holdings(user_id=_uid(user))


@router.post("/holdings/sync-ledger", response_model=SyncLedgerOut)
def sync_ledger(user=Depends(get_current_user)):
    return service.sync_premium_ledger(_uid(user))


@router.get("/premium-dashboard", response_model=PremiumDashboardOut)
def premium_dashboard(user=Depends(get_current_user)):
    return premium_ledger.get_premium_dashboard(user_id=_uid(user))


@router.get("/holdings/{holding_id}/premium-ledger", response_model=PremiumLedgerOut)
def holding_premium_ledger(holding_id: int, user=Depends(get_current_user)):
    return premium_ledger.get_premium_summary(holding_id=holding_id)


@router.patch("/holdings/{holding_id}", response_model=StockHoldingOut)
def update_holding(holding_id: int, body: StockHoldingUpdateRequest, user=Depends(get_current_user)):
    return service.update_holding(_uid(user), holding_id, body.model_dump(exclude_unset=True))


@router.delete("/holdings/{holding_id}", response_model=StatusOut)
def delete_holding(holding_id: int, user=Depends(get_current_user)):
    service.delete_holding(_uid(user), holding_id)
    return StatusOut()


@router.get("/holdings/{holding_id}/events", response_model=List[HoldingEventOut])
def holding_events(holding_id: int, user=Depends(get_current_user)):
    return holdings.list_holding_events(user_id=_uid(user), holding_id=holding_id)


# ── Value history ──────────────────────────────────────────────────────────────
@router.get("/value-history", response_model=List[PortfolioSnapshotOut])
def list_value_history(user=Depends(get_current_user), limit: int = Query(default=365, ge=1, le=1000),
                       offset: int = Query(default=0, ge=0)):
    return value_history.list_portfolio_snapshots(user_id=_uid(user), limit=limit, offset=offset)


@router.post("/value-history", response_model=PortfolioSnapshotOut)
def record_value_history(body: PortfolioSnapshotCreateRequest, user=Depends(get_current_user)):
    return service.record_value_snapshot(_uid(user), **body.model_dump())


# ── Broker accounts ────────────────────────────────────────────────────────────
@router.get("/broker-accounts", response_model=List[BrokerAccountOut])
def list_broker_accounts(user=Depends(get_current_user)):
    return accounts.list_broker_accounts(user_id=_uid(user))


@router.post("/broker-accounts", response_model=BrokerAccountOut)
def create_broker_account(body: BrokerAccountCreateRequest, user=Depends(get_current_user)):
    return accounts.create_broker_account(user_id=_uid(user), name=body.name, color=body.color,
                                          sort_order=body.sort_order)


@router.patch("/broker-accounts/{account_id}", response_model=BrokerAccountOut)
def update_broker_account(account_id: int, body: BrokerAccountUpdateRequest, user=Depends(get_current_user)):
    return service.update_broker_account(_uid(user), account_id, **body.model_dump())


@router.delete("/broker-accounts/{account_id}", response_model=StatusOut)
def delete_broker_account(account_id: int, user=Depends(get_current_user)):
    service.delete_broker_account(_uid(user), account_id)
    return StatusOut()


# ── Account balances ───────────────────────────────────────────────────────────
@router.get("/account-balances/years", response_model=List[int])
def account_balance_years(user=Depends(get_current_user)):
    return accounts.list_account_balance_years(user_id=_uid(user))


@router.get("/account-balances/all", response_model=List[AccountBalanceOut])
def all_account_balances(user=Depends(get_current_user)):
    """Every balance row across all years (for charts)."""
    return accounts.list_all_account_balances(user_id=_uid(user))


@router.get("/account-balances", response_model=List[AccountBalanceOut])
def account_balances(year: int = Query(...), user=Depends(get_current_user)):
    return accounts.list_account_balances(user_id=_uid(user), year=year)


@router.put("/account-balances", response_model=AccountBalanceOut)
def upsert_account_balance(body: AccountBalanceUpsertRequest, user=Depends(get_current_user)):
    return service.upsert_account_balance(_uid(user), body.account_id, body.week_date, body.balance)


@router.delete("/account-balances/{account_id}/{week_date}", response_model=StatusOut)
def delete_account_balance(account_id: int, week_date: str, user=Depends(get_current_user)):
    accounts.delete_account_balance(user_id=_uid(user), account_id=account_id, week_date=week_date)
    return StatusOut()


# ── Cash deposits ──────────────────────────────────────────────────────────────
@router.get("/cash-deposits", response_model=List[CashDepositOut])
def list_cash_deposits(user=Depends(get_current_user)):
    """Deposits and withdrawals, oldest first."""
    return accounts.list_cash_deposits(user_id=_uid(user))


@router.put("/cash-deposits", response_model=CashDepositOut)
def upsert_cash_deposit(body: CashDepositUpsertRequest, user=Depends(get_current_user)):
    """Create a deposit, or update one when `id` is given."""
    return service.upsert_cash_deposit(_uid(user), body.week_date, body.amount, body.note, body.id)


@router.delete("/cash-deposits/{deposit_id}", response_model=StatusOut)
def delete_cash_deposit(deposit_id: int, user=Depends(get_current_user)):
    service.delete_cash_deposit(_uid(user), deposit_id)
    return StatusOut()


# ── Trading accounts (/accounts, /holdings) ────────────────────────────────────
@accounts_router.get("/accounts", response_model=List[AccountOut])
def list_trading_accounts(user=Depends(get_current_user)):
    return trading_accounts.list_accounts(user_id=_uid(user))


@accounts_router.post("/accounts", response_model=AccountOut)
def create_trading_account(body: AccountCreateRequest, user=Depends(get_current_user)):
    return service.create_trading_account(_uid(user), body.name, body.broker, body.currency)


@accounts_router.get("/accounts/{account_id}/holdings", response_model=List[HoldingOut])
def list_account_holdings(account_id: int, user=Depends(get_current_user)):
    return service.list_account_holdings(_uid(user), account_id)


@accounts_router.put("/accounts/{account_id}/holdings", response_model=HoldingOut)
def upsert_account_holding(account_id: int, body: HoldingUpsertRequest, user=Depends(get_current_user)):
    return service.upsert_account_holding(_uid(user), account_id, body.symbol, body.quantity, body.avg_cost)


@accounts_router.delete("/holdings/{holding_id}", response_model=StatusOut)
def delete_account_holding(holding_id: int, user=Depends(get_current_user)):
    service.delete_account_holding(_uid(user), holding_id)
    return StatusOut()
