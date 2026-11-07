"""logic/budget_services.py — Cash, budget, overrides, CC weeks, and double-entry ledger."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import pandas as pd
from sqlalchemy.orm import sessionmaker

from database.models import (
    Budget,
    BudgetOverride,
    CashAction,
    CashFlow,
    CreditCardWeek,
    LedgerAccount,
    LedgerAccountType,
    LedgerEntry,
    LedgerEntryType,
    LedgerLine,
    get_budget_session,
)

_logger = logging.getLogger("optionflow.budget")


# ── Session helper ────────────────────────────────────────────────────────────

def _budget_session():
    """Session for budget.db. Respects monkeypatched logic.services.engine."""
    try:
        import logic.services as _svc
        if getattr(_svc, "engine", None) is not None:
            return sessionmaker(bind=_svc.engine)()
    except Exception:
        pass
    import database.models as _dbm
    return _dbm.get_budget_session()


# ── Normalizers ───────────────────────────────────────────────────────────────

def normalize_cash_action(action):
    s = str(action or "").strip().upper()
    return CashAction.DEPOSIT if s.startswith("D") else CashAction.WITHDRAW


def normalize_budget_type(b_type):
    from database.models import BudgetType
    s = str(b_type or "").strip().upper()
    if s == "INCOME":
        return BudgetType.INCOME
    if s == "ASSET":
        return BudgetType.ASSET
    return BudgetType.EXPENSE


# ── Ledger private helpers ────────────────────────────────────────────────────

def _get_or_create_cash_ledger_accounts(session, *, user_id: int, currency: str = "USD") -> tuple[LedgerAccount, LedgerAccount]:
    cur = str(currency or "USD").strip().upper() or "USD"
    cash_name = f"Cash ({cur})"
    equity_name = "Owner Equity"

    cash_acct = (
        session.query(LedgerAccount)
        .filter(LedgerAccount.user_id == int(user_id))
        .filter(LedgerAccount.name == cash_name)
        .filter(LedgerAccount.currency == cur)
        .first()
    )
    if cash_acct is None:
        cash_acct = LedgerAccount(
            user_id=int(user_id), name=cash_name,
            type=LedgerAccountType.ASSET, currency=cur,
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        )
        session.add(cash_acct)
        session.flush()

    equity_acct = (
        session.query(LedgerAccount)
        .filter(LedgerAccount.user_id == int(user_id))
        .filter(LedgerAccount.name == equity_name)
        .filter(LedgerAccount.currency == cur)
        .first()
    )
    if equity_acct is None:
        equity_acct = LedgerAccount(
            user_id=int(user_id), name=equity_name,
            type=LedgerAccountType.EQUITY, currency=cur,
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        )
        session.add(equity_acct)
        session.flush()

    return cash_acct, equity_acct


def _post_cash_ledger_entry(
    session,
    *,
    user_id: int,
    action: CashAction,
    amount: float,
    effective_at: datetime | None,
    notes: str | None,
    idempotency_key: str | None,
    source_type: str | None,
    source_id: int | None,
    currency: str = "USD",
) -> None:
    amt = float(amount or 0.0)
    if amt <= 0:
        raise ValueError("amount must be > 0")

    et = (
        LedgerEntryType.CASH_DEPOSIT
        if str(getattr(action, "value", action)).upper() == "DEPOSIT"
        else LedgerEntryType.CASH_WITHDRAW
    )

    if idempotency_key:
        exists = (
            session.query(LedgerEntry)
            .filter(LedgerEntry.user_id == int(user_id))
            .filter(LedgerEntry.idempotency_key == str(idempotency_key))
            .first()
        )
        if exists is not None:
            return

    cash_acct, equity_acct = _get_or_create_cash_ledger_accounts(session, user_id=int(user_id), currency=currency)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    e = LedgerEntry(
        user_id=int(user_id), entry_type=et, created_at=now, effective_at=effective_at,
        description=(str(notes)[:500] if notes else None),
        idempotency_key=(str(idempotency_key) if idempotency_key else None),
        source_type=(str(source_type) if source_type else None),
        source_id=(int(source_id) if source_id is not None else None),
    )
    session.add(e)
    session.flush()

    if et == LedgerEntryType.CASH_DEPOSIT:
        lines = [
            LedgerLine(entry_id=int(e.id), account_id=int(cash_acct.id), amount=+amt, memo=None),
            LedgerLine(entry_id=int(e.id), account_id=int(equity_acct.id), amount=-amt, memo=None),
        ]
    else:
        lines = [
            LedgerLine(entry_id=int(e.id), account_id=int(equity_acct.id), amount=+amt, memo=None),
            LedgerLine(entry_id=int(e.id), account_id=int(cash_acct.id), amount=-amt, memo=None),
        ]
    session.add_all(lines)


# ── Cash ──────────────────────────────────────────────────────────────────────

def save_cash(action, amount, date, notes, user_id=None) -> int:
    session = _budget_session()
    try:
        action_enum = normalize_cash_action(action)
        new_cash = CashFlow(
            action=action_enum, amount=float(amount),
            date=pd.to_datetime(date), notes=notes,
        )
        if user_id is not None:
            new_cash.user_id = int(user_id)
        session.add(new_cash)
        session.flush()

        if user_id is not None:
            try:
                eff = pd.to_datetime(date).to_pydatetime() if date is not None else None
            except Exception:
                eff = None
            _post_cash_ledger_entry(
                session, user_id=int(user_id), action=action_enum,
                amount=float(amount), effective_at=eff,
                notes=(str(notes) if notes is not None else None),
                idempotency_key=f"cash_flow:{int(new_cash.id)}",
                source_type="cash_flow", source_id=int(new_cash.id), currency="USD",
            )

        session.commit()
        session.refresh(new_cash)
        return int(new_cash.id)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def update_cash(cash_id: int, user_id: int, *, action: str | None = None, amount: float | None = None, date=None, notes: str | None = None) -> dict | None:
    session = _budget_session()
    try:
        row = session.query(CashFlow).filter(CashFlow.id == int(cash_id), CashFlow.user_id == int(user_id)).first()
        if not row:
            return None
        if action is not None:
            row.action = normalize_cash_action(action)
        if amount is not None:
            row.amount = float(amount)
        if date is not None:
            row.date = pd.to_datetime(date)
        if notes is not None:
            row.notes = str(notes)
        session.commit()
        return {
            "id": int(row.id),
            "action": str(getattr(getattr(row, "action", None), "value", row.action) or ""),
            "amount": float(row.amount),
            "date": row.date,
            "notes": (str(row.notes) if row.notes else None),
        }
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def delete_cash(cash_id: int, user_id: int) -> bool:
    session = _budget_session()
    try:
        row = session.query(CashFlow).filter(CashFlow.id == int(cash_id), CashFlow.user_id == int(user_id)).first()
        if not row:
            return False
        session.delete(row)
        session.commit()
        return True
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def list_cash_flows(*, user_id: int, limit: int = 200, offset: int = 0) -> list[dict]:
    session = _budget_session()
    try:
        rows = (
            session.query(CashFlow)
            .filter(CashFlow.user_id == int(user_id))
            .order_by(CashFlow.date.desc())
            .offset(int(offset)).limit(int(limit)).all()
        )
        return [
            {
                "id": int(r.id),
                "action": str(getattr(getattr(r, "action", None), "value", r.action) or ""),
                "amount": float(r.amount),
                "date": r.date,
                "notes": (str(r.notes) if r.notes else None),
            }
            for r in rows
        ]
    finally:
        session.close()


def get_cash_balance_ledger(*, user_id: int, currency: str = "USD") -> float:
    session = _budget_session()
    try:
        cur = str(currency or "USD").strip().upper() or "USD"
        cash_name = f"Cash ({cur})"
        cash_acct = (
            session.query(LedgerAccount)
            .filter(LedgerAccount.user_id == int(user_id))
            .filter(LedgerAccount.name == cash_name)
            .filter(LedgerAccount.currency == cur)
            .first()
        )
        if cash_acct is None:
            return 0.0
        rows = session.query(LedgerLine.amount).filter(LedgerLine.account_id == int(cash_acct.id)).all()
        return float(sum(float(r[0] or 0.0) for r in rows))
    finally:
        session.close()


def get_cash_balance(*, user_id: int, currency: str = "USD") -> float:
    return get_cash_balance_ledger(user_id=int(user_id), currency=str(currency or "USD"))


# ── Budget ────────────────────────────────────────────────────────────────────

def save_budget(category, b_type, amount, date, desc, user_id=None, entry_type=None, recurrence=None, merchant=None, active_until=None) -> int:
    session = _budget_session()
    try:
        type_enum = normalize_budget_type(b_type)
        new_item = Budget(
            category=str(category), type=type_enum, amount=float(amount),
            date=pd.to_datetime(date), description=str(desc),
            entry_type=entry_type, recurrence=recurrence,
            merchant=merchant or None, active_until=active_until or None,
        )
        if user_id is not None:
            new_item.user_id = int(user_id)
        session.add(new_item)
        session.commit()
        session.refresh(new_item)
        return int(new_item.id)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def update_budget(budget_id: int, user_id: int, **kwargs):
    session = _budget_session()
    try:
        item = session.query(Budget).filter(Budget.id == budget_id, Budget.user_id == user_id).first()
        if not item:
            raise ValueError(f"Budget {budget_id} not found")
        for k, v in kwargs.items():
            if k == "type" and v is not None:
                v = normalize_budget_type(v)
            if k == "date" and v is not None:
                v = pd.to_datetime(v)
            if hasattr(item, k):
                setattr(item, k, v)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def delete_budget(budget_id: int, user_id: int):
    session = _budget_session()
    try:
        item = session.query(Budget).filter(Budget.id == budget_id, Budget.user_id == user_id).first()
        if item:
            session.delete(item)
            session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def list_budget_entries(*, user_id: int, limit: int = 500, offset: int = 0) -> list[dict]:
    session = _budget_session()
    try:
        rows = (
            session.query(Budget)
            .filter(Budget.user_id == int(user_id))
            .order_by(Budget.date.desc())
            .offset(int(offset)).limit(int(limit)).all()
        )
        return [
            {
                "id": int(r.id),
                "category": (str(r.category) if r.category else None),
                "type": str(getattr(getattr(r, "type", None), "value", r.type) or ""),
                "entry_type": (str(r.entry_type) if r.entry_type else None),
                "recurrence": (str(r.recurrence) if r.recurrence else None),
                "amount": float(r.amount),
                "date": r.date,
                "description": (str(r.description) if r.description else None),
                "merchant": (str(r.merchant) if r.merchant else None),
                "active_until": (str(r.active_until) if r.active_until else None),
            }
            for r in rows
        ]
    finally:
        session.close()


def get_budget_summary(*, user_id: int) -> dict:
    session = _budget_session()
    try:
        rows = session.query(Budget).filter(Budget.user_id == int(user_id)).all()
        by_category: dict[str, float] = {}
        by_type: dict[str, float] = {}
        total_income = 0.0
        total_expense = 0.0
        for r in rows:
            cat = str(r.category or "Uncategorized")
            b_type = str(getattr(getattr(r, "type", None), "value", r.type) or "EXPENSE").upper()
            amt = float(r.amount or 0.0)
            by_category[cat] = by_category.get(cat, 0.0) + amt
            by_type[b_type] = by_type.get(b_type, 0.0) + amt
            if b_type == "INCOME":
                total_income += amt
            else:
                total_expense += amt
        return {
            "total_income": total_income,
            "total_expense": total_expense,
            "net": total_income - total_expense,
            "by_category": by_category,
            "by_type": by_type,
            "entry_count": len(rows),
        }
    finally:
        session.close()


# ── Budget overrides ──────────────────────────────────────────────────────────

def list_budget_overrides(user_id: int):
    session = _budget_session()
    try:
        rows = (
            session.query(BudgetOverride)
            .filter(BudgetOverride.user_id == user_id)
            .order_by(BudgetOverride.month_key)
            .all()
        )
        return [
            {
                "id": r.id, "budget_id": r.budget_id,
                "month_key": r.month_key, "amount": r.amount,
                "description": r.description,
            }
            for r in rows
        ]
    finally:
        session.close()


def upsert_budget_override(user_id: int, budget_id: int, month_key: str, amount: float, description: str = None):
    session = _budget_session()
    try:
        existing = session.query(BudgetOverride).filter(
            BudgetOverride.user_id == user_id,
            BudgetOverride.budget_id == budget_id,
            BudgetOverride.month_key == month_key,
        ).first()
        if existing:
            existing.amount = float(amount)
            existing.description = description
            existing.updated_at = datetime.utcnow()
            session.commit()
            return existing.id
        row = BudgetOverride(
            user_id=user_id, budget_id=budget_id, month_key=month_key,
            amount=float(amount), description=description,
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        return row.id
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def delete_budget_override(override_id: int, user_id: int):
    session = _budget_session()
    try:
        row = session.query(BudgetOverride).filter(
            BudgetOverride.id == override_id, BudgetOverride.user_id == user_id,
        ).first()
        if row:
            session.delete(row)
            session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def delete_budget_overrides_for_entry(budget_id: int, user_id: int):
    session = _budget_session()
    try:
        session.query(BudgetOverride).filter(
            BudgetOverride.budget_id == budget_id, BudgetOverride.user_id == user_id,
        ).delete()
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


# ── Credit card weeks ─────────────────────────────────────────────────────────

def list_credit_card_weeks(user_id: int):
    session = _budget_session()
    try:
        rows = (
            session.query(CreditCardWeek)
            .filter(CreditCardWeek.user_id == user_id)
            .order_by(CreditCardWeek.week_start.desc())
            .all()
        )
        return [
            {
                "id": r.id,
                "week_start": r.week_start.isoformat() if r.week_start else None,
                "card_name": r.card_name,
                "balance": r.balance,
                "squared_off": r.squared_off,
                "paid_amount": r.paid_amount,
                "note": r.note,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            }
            for r in rows
        ]
    finally:
        session.close()


def create_credit_card_week(user_id: int, week_start, balance: float, squared_off: bool = False, paid_amount=None, note=None, card_name=None):
    session = _budget_session()
    try:
        row = CreditCardWeek(
            user_id=user_id, week_start=pd.to_datetime(week_start),
            card_name=(str(card_name) if card_name else None),
            balance=float(balance), squared_off=bool(squared_off),
            paid_amount=(float(paid_amount) if paid_amount is not None else None),
            note=(str(note) if note else None),
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        return row.id
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def update_credit_card_week(row_id: int, user_id: int, **kwargs):
    session = _budget_session()
    try:
        row = session.query(CreditCardWeek).filter(
            CreditCardWeek.id == row_id, CreditCardWeek.user_id == user_id,
        ).first()
        if not row:
            raise ValueError(f"CreditCardWeek {row_id} not found")
        for k, v in kwargs.items():
            if k == "week_start" and v is not None:
                v = pd.to_datetime(v)
            if hasattr(row, k):
                setattr(row, k, v)
        row.updated_at = datetime.utcnow()
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def delete_credit_card_week(row_id: int, user_id: int):
    session = _budget_session()
    try:
        row = session.query(CreditCardWeek).filter(
            CreditCardWeek.id == row_id, CreditCardWeek.user_id == user_id,
        ).first()
        if row:
            session.delete(row)
            session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


# ── Ledger ────────────────────────────────────────────────────────────────────

def list_ledger_entries(*, user_id: int, limit: int = 100, offset: int = 0) -> list[dict]:
    session = _budget_session()
    try:
        es = (
            session.query(LedgerEntry)
            .filter(LedgerEntry.user_id == int(user_id))
            .order_by(LedgerEntry.created_at.desc())
            .offset(int(offset)).limit(int(limit)).all()
        )
        out: list[dict] = []
        for e in es:
            lines = (
                session.query(LedgerLine, LedgerAccount)
                .join(LedgerAccount, LedgerAccount.id == LedgerLine.account_id)
                .filter(LedgerLine.entry_id == int(e.id))
                .all()
            )
            out.append({
                "id": int(e.id),
                "entry_type": str(getattr(getattr(e, "entry_type", None), "value", e.entry_type) or ""),
                "created_at": getattr(e, "created_at", None),
                "effective_at": getattr(e, "effective_at", None),
                "description": (str(getattr(e, "description", "") or "") or None),
                "idempotency_key": (str(getattr(e, "idempotency_key", "") or "") or None),
                "source_type": (str(getattr(e, "source_type", "") or "") or None),
                "source_id": (int(getattr(e, "source_id")) if getattr(e, "source_id", None) is not None else None),
                "lines": [
                    {
                        "account": str(getattr(a, "name", "") or ""),
                        "account_type": str(getattr(getattr(a, "type", None), "value", a.type) or ""),
                        "currency": str(getattr(a, "currency", "") or "USD"),
                        "amount": float(getattr(l, "amount", 0.0) or 0.0),
                    }
                    for (l, a) in lines
                ],
            })
        return out
    finally:
        session.close()
