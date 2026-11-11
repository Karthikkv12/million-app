"""optionflow/modules/portfolio/service.py — what the portfolio routes do.

The domain files (weeks, positions, assignments, holdings, premium_ledger,
accounts, value_history, trading_accounts) raise ValueError for missing or
invalid records; these flows turn that into domain errors with the same
status codes the API has always returned.
"""
from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Optional, Type

from optionflow.core import errors
from optionflow.modules.portfolio import (
    accounts, assignments, holdings, positions, premium_ledger, trading_accounts, value_history, weeks,
)
from optionflow.modules.portfolio._common import parse_dt

logger = logging.getLogger("optionflow.portfolio")


@contextmanager
def _as(error: Type[errors.AppError], *catch: Type[Exception]):
    """Re-raise the given exceptions (default ValueError) as `error`, keeping the message."""
    try:
        yield
    except (catch or (ValueError,)) as e:
        raise error(str(e)) from e


# ── Weeks ──────────────────────────────────────────────────────────────────────
def get_or_create_week(user_id: int, for_date) -> dict:
    return weeks.get_or_create_week(user_id=user_id, for_date=parse_dt(for_date))


def get_week(user_id: int, week_id: int) -> dict:
    w = weeks.get_week(user_id=user_id, week_id=week_id)
    if w is None:
        raise errors.NotFound("Week not found")
    return w


def update_week(user_id: int, week_id: int, **values) -> dict:
    with _as(errors.NotFound):
        return weeks.update_week(user_id=user_id, week_id=week_id, **values)


def complete_week(user_id: int, week_id: int, **values) -> dict:
    with _as(errors.BadRequest):
        return weeks.mark_week_complete(user_id=user_id, week_id=week_id, **values)


def reopen_week(user_id: int, week_id: int) -> dict:
    with _as(errors.NotFound):
        return weeks.reopen_week(user_id=user_id, week_id=week_id)


# ── Positions and assignments ──────────────────────────────────────────────────
def create_position(user_id: int, week_id: int, data: dict) -> dict:
    with _as(errors.BadRequest):
        return positions.create_position(user_id=user_id, week_id=week_id, data=data)


def update_position(user_id: int, position_id: int, data: dict) -> dict:
    """Update a position; a status change also updates the linked holding (best effort)."""
    with _as(errors.NotFound):
        result = positions.update_position(user_id=user_id, position_id=position_id, data=data)
    if data.get("status") is not None:
        try:
            holdings.apply_position_status_change(user_id=user_id, position_id=position_id,
                                                  new_status=data["status"])
        except Exception as exc:
            logger.warning("apply_position_status_change failed for position %s: %s", position_id, exc)
    return result


def delete_position(user_id: int, position_id: int) -> None:
    with _as(errors.NotFound):
        positions.delete_position(user_id=user_id, position_id=position_id)


def create_assignment(user_id: int, position_id: int, data: dict) -> dict:
    with _as(errors.BadRequest):
        return assignments.create_assignment(user_id=user_id, position_id=position_id, data=data)


def get_assignment(user_id: int, position_id: int) -> dict:
    a = assignments.get_assignment_for_position(user_id=user_id, position_id=position_id)
    if a is None:
        raise errors.NotFound("No assignment found")
    return a


def update_assignment(user_id: int, assignment_id: int, data: dict) -> dict:
    with _as(errors.NotFound):
        return assignments.update_assignment(user_id=user_id, assignment_id=assignment_id, data=data)


# ── Holdings ───────────────────────────────────────────────────────────────────
def create_holding(user_id: int, data: dict) -> dict:
    with _as(errors.BadRequest, ValueError, KeyError):
        return holdings.create_holding(user_id=user_id, data=data)


def update_holding(user_id: int, holding_id: int, data: dict) -> dict:
    with _as(errors.NotFound):
        return holdings.update_holding(user_id=user_id, holding_id=holding_id, data=data)


def delete_holding(user_id: int, holding_id: int) -> None:
    with _as(errors.NotFound):
        holdings.delete_holding(user_id=user_id, holding_id=holding_id)


def sync_premium_ledger(user_id: int) -> dict:
    """Rebuild the premium ledger from positions, then recompute every holding's basis."""
    synced = premium_ledger.sync_ledger_from_positions(user_id=user_id)
    recalculated = holdings.recalculate_all_holdings(user_id=user_id)
    return {"synced_rows": synced["upserted"], "updated_holdings": recalculated["updated"]}


# ── Value history ──────────────────────────────────────────────────────────────
def record_value_snapshot(user_id: int, **values):
    with _as(errors.BadRequest):
        return value_history.upsert_portfolio_snapshot(user_id=user_id, **values)


# ── Broker accounts, balances, deposits ────────────────────────────────────────
def update_broker_account(user_id: int, account_id: int, **values) -> dict:
    with _as(errors.NotFound):
        return accounts.update_broker_account(user_id=user_id, account_id=account_id, **values)


def delete_broker_account(user_id: int, account_id: int) -> None:
    with _as(errors.NotFound):
        accounts.delete_broker_account(user_id=user_id, account_id=account_id)


def upsert_account_balance(user_id: int, account_id: int, week_date: str, balance: float) -> dict:
    with _as(errors.BadRequest, ValueError, KeyError):
        return accounts.upsert_account_balance(user_id=user_id, account_id=account_id,
                                               week_date=week_date, balance=balance)


def upsert_cash_deposit(user_id: int, week_date: str, amount: float, note: Optional[str],
                        deposit_id: Optional[int]) -> dict:
    with _as(errors.BadRequest, ValueError, KeyError):
        return accounts.upsert_cash_deposit(user_id=user_id, week_date=week_date, amount=amount,
                                            note=note, deposit_id=deposit_id or None)


def delete_cash_deposit(user_id: int, deposit_id: int) -> None:
    with _as(errors.NotFound):
        accounts.delete_cash_deposit(user_id=user_id, deposit_id=deposit_id)


# ── Trading accounts (/accounts) ───────────────────────────────────────────────
def create_trading_account(user_id: int, name: str, broker: Optional[str], currency: str) -> dict:
    with _as(errors.BadRequest):
        account_id = trading_accounts.create_account(user_id=user_id, name=name, broker=broker, currency=currency)
    return {"id": int(account_id), "name": name, "broker": broker, "currency": str(currency).upper()}


def list_account_holdings(user_id: int, account_id: int):
    with _as(errors.NotFound):
        return trading_accounts.list_holdings(user_id=user_id, account_id=account_id)


def upsert_account_holding(user_id: int, account_id: int, symbol: str, quantity: float, avg_cost: Optional[float]):
    with _as(errors.BadRequest):
        return trading_accounts.upsert_holding(user_id=user_id, account_id=account_id, symbol=symbol,
                                               quantity=float(quantity), avg_cost=avg_cost)


def delete_account_holding(user_id: int, holding_id: int) -> None:
    if not trading_accounts.delete_holding(user_id=user_id, holding_id=holding_id):
        raise errors.NotFound("Holding not found")


# ── For other modules ──────────────────────────────────────────────────────────
def position_symbols(user_id: int) -> list[str]:
    """Distinct symbols across all of the user's option positions."""
    return positions.distinct_symbols(user_id=user_id)


def holding_symbols(user_id: int) -> list[str]:
    """Distinct symbols across all of the user's stock holdings."""
    return holdings.distinct_symbols(user_id=user_id)
