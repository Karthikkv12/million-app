"""optionflow/modules/portfolio/accounts.py — Broker accounts, weekly account balances and cash deposits."""
from __future__ import annotations
from datetime import datetime
from optionflow.core.db import get_portfolio_session as _portfolio_session
from database.models import WeeklySnapshot, BrokerAccount, AccountBalance


# ── Broker Accounts ───────────────────────────────────────────────────────────

def _account_to_dict(a: BrokerAccount) -> dict:
    return {
        "id":         a.id,
        "name":       a.name,
        "color":      a.color,
        "sort_order": a.sort_order,
        "is_active":  a.is_active,
    }


def list_broker_accounts(*, user_id: int) -> list[dict]:
    session = _portfolio_session()
    try:
        accounts = (
            session.query(BrokerAccount)
            .filter(BrokerAccount.user_id == user_id)
            .order_by(BrokerAccount.sort_order, BrokerAccount.id)
            .all()
        )
        return [_account_to_dict(a) for a in accounts]
    finally:
        session.close()


def create_broker_account(*, user_id: int, name: str, color: str | None = None,
                          sort_order: int = 0) -> dict:
    session = _portfolio_session()
    try:
        a = BrokerAccount(
            user_id=user_id, name=name, color=color,
            sort_order=sort_order, is_active=True,
            created_at=datetime.utcnow(),
        )
        session.add(a)
        session.commit()
        session.refresh(a)
        return _account_to_dict(a)
    finally:
        session.close()


def update_broker_account(*, user_id: int, account_id: int,
                          name: str | None = None, color: str | None = None,
                          sort_order: int | None = None,
                          is_active: bool | None = None) -> dict:
    session = _portfolio_session()
    try:
        a = session.query(BrokerAccount).filter(
            BrokerAccount.id == account_id,
            BrokerAccount.user_id == user_id,
        ).first()
        if a is None:
            raise ValueError("Account not found")
        if name is not None:
            a.name = name
        if color is not None:
            a.color = color
        if sort_order is not None:
            a.sort_order = sort_order
        if is_active is not None:
            a.is_active = is_active
        session.commit()
        session.refresh(a)
        return _account_to_dict(a)
    finally:
        session.close()


def delete_broker_account(*, user_id: int, account_id: int) -> None:
    session = _portfolio_session()
    try:
        a = session.query(BrokerAccount).filter(
            BrokerAccount.id == account_id,
            BrokerAccount.user_id == user_id,
        ).first()
        if a is None:
            raise ValueError("Account not found")
        # Soft-delete: mark inactive
        a.is_active = False
        session.commit()
    finally:
        session.close()


# ── Account Balances ──────────────────────────────────────────────────────────

def _recompute_week_total(session, user_id: int, week_date) -> None:
    """Sum all account balances for a Friday and write to weekly_snapshots.account_value."""
    from datetime import date as _date
    if isinstance(week_date, _date):
        week_date_d = week_date
    else:
        week_date_d = week_date.date() if hasattr(week_date, 'date') else week_date

    total = (
        session.query(AccountBalance)
        .filter(
            AccountBalance.user_id == user_id,
            AccountBalance.week_date == week_date_d,
        )
        .all()
    )
    new_sum = sum(b.balance for b in total) if total else None

    # Find the matching weekly_snapshot (week_end on the same date)
    from datetime import datetime as _dt
    week_end_dt = _dt.combine(week_date_d, _dt.min.time())
    snap = session.query(WeeklySnapshot).filter(
        WeeklySnapshot.user_id == user_id,
        WeeklySnapshot.week_end >= week_end_dt,
        WeeklySnapshot.week_end < _dt.combine(week_date_d, _dt.max.time()),
    ).first()
    if snap is not None and new_sum is not None:
        snap.account_value = round(new_sum, 2)
        session.add(snap)


def upsert_account_balance(*, user_id: int, account_id: int,
                           week_date, balance: float) -> dict:
    """Insert or update a balance entry; recomputes weekly_snapshots total."""
    from datetime import date as _date, datetime as _dt
    if not isinstance(week_date, _date):
        week_date = _dt.strptime(str(week_date), "%Y-%m-%d").date()

    session = _portfolio_session()
    try:
        existing = session.query(AccountBalance).filter(
            AccountBalance.account_id == account_id,
            AccountBalance.week_date == week_date,
        ).first()
        if existing:
            existing.balance = balance
            b = existing
        else:
            b = AccountBalance(
                user_id=user_id, account_id=account_id,
                week_date=week_date, balance=balance,
            )
            session.add(b)
        session.flush()
        _recompute_week_total(session, user_id, week_date)
        session.commit()
        return {
            "account_id": b.account_id,
            "week_date":  str(b.week_date),
            "balance":    b.balance,
        }
    finally:
        session.close()


def delete_account_balance(*, user_id: int, account_id: int, week_date) -> None:
    from datetime import date as _date, datetime as _dt
    if not isinstance(week_date, _date):
        week_date = _dt.strptime(str(week_date), "%Y-%m-%d").date()
    session = _portfolio_session()
    try:
        b = session.query(AccountBalance).filter(
            AccountBalance.account_id == account_id,
            AccountBalance.week_date == week_date,
        ).first()
        if b:
            session.delete(b)
            session.flush()
            _recompute_week_total(session, user_id, week_date)
            session.commit()
    finally:
        session.close()


def list_account_balance_years(*, user_id: int) -> list[int]:
    """Return sorted list of distinct years that have any account_balance rows."""
    from datetime import date as _date
    session = _portfolio_session()
    try:
        rows = (
            session.query(AccountBalance.week_date)
            .filter(AccountBalance.user_id == user_id)
            .distinct()
            .all()
        )
        years = sorted({r.week_date.year for r in rows}, reverse=True)
        current = _date.today().year
        if current not in years:
            years.insert(0, current)
        return years
    finally:
        session.close()


def list_account_balances(*, user_id: int, year: int) -> list[dict]:
    """Return all balances for a given year, keyed by week_date."""
    from datetime import date as _date
    session = _portfolio_session()
    try:
        rows = (
            session.query(AccountBalance)
            .filter(
                AccountBalance.user_id == user_id,
                AccountBalance.week_date >= _date(year, 1, 1),
                AccountBalance.week_date <= _date(year, 12, 31),
            )
            .order_by(AccountBalance.week_date)
            .all()
        )
        return [
            {
                "account_id": r.account_id,
                "week_date":  str(r.week_date),
                "balance":    r.balance,
            }
            for r in rows
        ]
    finally:
        session.close()


def list_all_account_balances(*, user_id: int) -> list[dict]:
    """Return all balances across all years for chart use."""
    session = _portfolio_session()
    try:
        rows = (
            session.query(AccountBalance)
            .filter(AccountBalance.user_id == user_id)
            .order_by(AccountBalance.week_date)
            .all()
        )
        return [
            {
                "account_id": r.account_id,
                "week_date":  str(r.week_date),
                "balance":    r.balance,
            }
            for r in rows
        ]
    finally:
        session.close()


# ── Cash Deposits ─────────────────────────────────────────────────────────────

def list_cash_deposits(*, user_id: int) -> list[dict]:
    """Return all cash deposit/withdrawal events for the user, oldest first."""
    from database.models import CashDeposit
    session = _portfolio_session()
    try:
        rows = (
            session.query(CashDeposit)
            .filter(CashDeposit.user_id == user_id)
            .order_by(CashDeposit.week_date)
            .all()
        )
        return [
            {
                "id":         r.id,
                "week_date":  str(r.week_date),
                "amount":     r.amount,
                "note":       r.note,
                "created_at": str(r.created_at),
            }
            for r in rows
        ]
    finally:
        session.close()


def upsert_cash_deposit(
    *,
    user_id: int,
    week_date,
    amount: float,
    note: str | None = None,
    deposit_id: int | None = None,
) -> dict:
    """
    Insert or update a cash deposit row.
    If deposit_id is provided, update that specific row.
    Otherwise create a new row (multiple deposits on the same Friday are allowed).
    """
    from datetime import date as _date
    from database.models import CashDeposit
    import pandas as _pd

    # Normalise week_date to a Python date
    if isinstance(week_date, str):
        week_date = _pd.to_datetime(week_date).date()

    session = _portfolio_session()
    try:
        if deposit_id is not None:
            row = (
                session.query(CashDeposit)
                .filter(CashDeposit.id == deposit_id, CashDeposit.user_id == user_id)
                .first()
            )
            if row is None:
                raise ValueError(f"Cash deposit {deposit_id} not found")
            row.week_date = week_date
            row.amount = float(amount)
            if note is not None:
                row.note = str(note)[:255] if note else None
        else:
            row = CashDeposit(
                user_id=user_id,
                week_date=week_date,
                amount=float(amount),
                note=str(note)[:255] if note else None,
                created_at=__import__("datetime").datetime.utcnow(),
            )
            session.add(row)

        session.commit()
        session.refresh(row)
        return {
            "id":         row.id,
            "week_date":  str(row.week_date),
            "amount":     row.amount,
            "note":       row.note,
            "created_at": str(row.created_at),
        }
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def delete_cash_deposit(*, user_id: int, deposit_id: int) -> None:
    from database.models import CashDeposit
    session = _portfolio_session()
    try:
        row = (
            session.query(CashDeposit)
            .filter(CashDeposit.id == deposit_id, CashDeposit.user_id == user_id)
            .first()
        )
        if row is None:
            raise ValueError(f"Cash deposit {deposit_id} not found")
        session.delete(row)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
