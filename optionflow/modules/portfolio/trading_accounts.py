"""optionflow/modules/portfolio/trading_accounts.py — Accounts and account-linked holdings."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from database.models import Account, StockHolding
from optionflow.core.db import get_portfolio_session, get_trades_session

_logger = logging.getLogger("optionflow.trades")


# ── Session helpers ───────────────────────────────────────────────────────────

def _get_trades_session():
    """Session for trades.db."""
    return get_trades_session()


def _get_portfolio_session():
    """Session for portfolio.db."""
    return get_portfolio_session()


# Canonical alias for trades.db session used by accounts + holdings.
def get_session():
    return _get_trades_session()


# ── Accounts ──────────────────────────────────────────────────────────────────

def create_account(*, user_id: int, name: str, broker: str | None = None, currency: str = "USD") -> int:
    session = get_session()
    try:
        nm = str(name or "").strip()
        if not nm:
            raise ValueError("account name is required")
        cur = str(currency or "USD").strip().upper() or "USD"
        acct = Account(
            user_id=int(user_id), name=nm,
            broker=(str(broker).strip() if broker else None),
            currency=cur, created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        )
        session.add(acct)
        session.commit()
        return int(acct.id)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def list_accounts(*, user_id: int) -> list[dict]:
    session = get_session()
    try:
        rows = session.query(Account).filter(Account.user_id == int(user_id)).order_by(Account.created_at.desc()).all()
        return [
            {
                "id": int(getattr(a, "id")),
                "name": str(getattr(a, "name", "") or ""),
                "broker": (str(getattr(a, "broker", "") or "") or None),
                "currency": str(getattr(a, "currency", "") or "USD"),
                "created_at": getattr(a, "created_at", None),
            }
            for a in rows
        ]
    finally:
        session.close()


# ── Account-linked holdings ───────────────────────────────────────────────────

def list_holdings(*, user_id: int, account_id: int) -> list[dict]:
    trades_session = get_session()
    portfolio_session = _get_portfolio_session()
    try:
        acct = trades_session.query(Account).filter(Account.id == int(account_id), Account.user_id == int(user_id)).first()
        if not acct:
            raise ValueError("account not found")
        rows = (
            portfolio_session.query(StockHolding)
            .filter(StockHolding.user_id == int(user_id), StockHolding.account_id == int(account_id))
            .order_by(StockHolding.symbol.asc())
            .all()
        )
        return [
            {
                "id": int(getattr(h, "id")),
                "account_id": int(getattr(h, "account_id")),
                "symbol": str(getattr(h, "symbol", "") or ""),
                "quantity": float(getattr(h, "shares", 0.0) or 0.0),
                "avg_cost": (float(getattr(h, "avg_cost", 0.0)) if getattr(h, "avg_cost", None) is not None else None),
                "updated_at": getattr(h, "updated_at", None),
            }
            for h in rows
        ]
    finally:
        trades_session.close()
        portfolio_session.close()


def upsert_holding(*, user_id: int, account_id: int, symbol: str, quantity: float, avg_cost: float | None = None) -> dict:
    trades_session = get_session()
    portfolio_session = _get_portfolio_session()
    try:
        sym = str(symbol or "").strip().upper()
        if not sym:
            raise ValueError("symbol is required")
        acct = trades_session.query(Account).filter(Account.id == int(account_id), Account.user_id == int(user_id)).first()
        if not acct:
            raise ValueError("account not found")

        h = portfolio_session.query(StockHolding).filter(StockHolding.user_id == int(user_id), StockHolding.account_id == int(account_id), StockHolding.symbol == sym).first()
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        qty = float(quantity)
        cost = qty * (float(avg_cost) if avg_cost is not None else 0.0)
        if h is None:
            h = StockHolding(
                user_id=int(user_id), account_id=int(account_id), symbol=sym,
                shares=qty, cost_basis=cost, adjusted_cost_basis=cost,
                avg_cost=(float(avg_cost) if avg_cost is not None else None), updated_at=now,
            )
            portfolio_session.add(h)
        else:
            h.shares = qty
            h.cost_basis = cost
            h.adjusted_cost_basis = cost
            h.avg_cost = (float(avg_cost) if avg_cost is not None else None)
            h.updated_at = now
            portfolio_session.add(h)
        portfolio_session.commit()
        return {
            "id": int(getattr(h, "id")),
            "account_id": int(getattr(h, "account_id")),
            "symbol": str(getattr(h, "symbol", "") or ""),
            "quantity": float(getattr(h, "shares", 0.0) or 0.0),
            "avg_cost": (float(getattr(h, "avg_cost", 0.0)) if getattr(h, "avg_cost", None) is not None else None),
            "updated_at": getattr(h, "updated_at", None),
        }
    except Exception:
        portfolio_session.rollback()
        raise
    finally:
        trades_session.close()
        portfolio_session.close()


def delete_holding(*, user_id: int, holding_id: int) -> bool:
    session = _get_portfolio_session()
    try:
        h = session.query(StockHolding).filter(StockHolding.id == int(holding_id), StockHolding.user_id == int(user_id)).first()
        if not h:
            return False
        session.delete(h)
        session.commit()
        return True
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()



