"""logic/trade_services.py — Orders, trades, accounts, and account-linked holdings."""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

import pandas as pd
from sqlalchemy.orm import sessionmaker

from database.models import (
    Account,
    Action,
    InstrumentType,
    StockHolding,
    Trade,
    get_trades_engine,
    get_portfolio_session,
    get_trades_session,
)

_logger = logging.getLogger("optionflow.trades")

_HOLDINGS_SYNC_ACCOUNT_NAME = (os.getenv("HOLDINGS_SYNC_ACCOUNT_NAME") or "Trading").strip() or "Trading"


# ── Session helpers ───────────────────────────────────────────────────────────

def _get_trades_session():
    """Session for trades.db. Respects monkeypatched logic.services.engine."""
    try:
        import logic.services as _svc
        if getattr(_svc, "engine", None) is not None:
            return sessionmaker(bind=_svc.engine)()
    except Exception:
        pass
    import database.models as _dbm
    return _dbm.get_trades_session()


def _get_portfolio_session():
    """Session for portfolio.db. Respects monkeypatched logic.services.engine."""
    try:
        import logic.services as _svc
        if getattr(_svc, "engine", None) is not None:
            return sessionmaker(bind=_svc.engine)()
    except Exception:
        pass
    import database.models as _dbm
    return _dbm.get_portfolio_session()


# Kept as the canonical "get_session" alias for trades.db (called by orders too).
def get_session():
    return _get_trades_session()


# ── Normalizers ───────────────────────────────────────────────────────────────

def _normalize_str(x) -> str:
    if x is None:
        return ""
    return str(x).strip()


def normalize_instrument(instrument):
    s = _normalize_str(instrument)
    if not s:
        return InstrumentType.STOCK
    return InstrumentType.OPTION if s.upper().startswith("OPT") else InstrumentType.STOCK


def normalize_action(action):
    s = _normalize_str(action)
    if not s:
        return Action.BUY
    return Action.BUY if s.upper().startswith("B") else Action.SELL


def normalize_option_type(o_type):
    from database.models import OptionType
    s = _normalize_str(o_type)
    if not s:
        return None
    return OptionType.CALL if s.upper().startswith("C") else OptionType.PUT


# ── Internal helpers ──────────────────────────────────────────────────────────

def _trade_signed_quantity(*, action: Action, quantity: int) -> float:
    act = getattr(action, "value", str(action))
    q = float(int(quantity or 0))
    return q if str(act).upper() == "BUY" else -q


def _get_or_create_holdings_sync_account(session, *, user_id: int) -> Account:
    acct = (
        session.query(Account)
        .filter(Account.user_id == int(user_id))
        .filter(Account.name == _HOLDINGS_SYNC_ACCOUNT_NAME)
        .first()
    )
    if acct is not None:
        return acct
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    acct = Account(
        user_id=int(user_id),
        name=_HOLDINGS_SYNC_ACCOUNT_NAME,
        broker=None,
        currency="USD",
        created_at=now,
    )
    session.add(acct)
    session.flush()
    return acct


def _apply_holding_delta(session, *, user_id: int, symbol: str, delta_qty: float, price: float | None) -> None:
    dq = float(delta_qty or 0.0)
    if abs(dq) < 1e-12:
        return
    sym = str(symbol or "").strip().upper()
    if not sym:
        return

    acct = _get_or_create_holdings_sync_account(session, user_id=int(user_id))
    h = (
        session.query(StockHolding)
        .filter(StockHolding.user_id == int(user_id))
        .filter(StockHolding.account_id == int(acct.id))
        .filter(StockHolding.symbol == sym)
        .first()
    )
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if h is None:
        h = StockHolding(
            user_id=int(user_id), account_id=int(acct.id), symbol=sym,
            shares=0.0, cost_basis=0.0, adjusted_cost_basis=0.0, avg_cost=None, updated_at=now,
        )
        session.add(h)
        session.flush()

    old_qty = float(getattr(h, "shares", 0.0) or 0.0)
    old_avg = getattr(h, "avg_cost", None)
    new_qty = old_qty + dq
    if abs(new_qty) < 1e-9:
        new_qty = 0.0

    px = float(price) if price is not None else None
    new_avg = old_avg

    if new_qty == 0.0:
        new_avg = None
    else:
        if (old_qty == 0.0 or old_avg is None) and px is not None:
            new_avg = px
        else:
            if px is not None and old_qty != 0.0 and (old_qty * dq) > 0.0:
                denom = abs(old_qty) + abs(dq)
                if denom > 0:
                    new_avg = (abs(old_qty) * float(old_avg or 0.0) + abs(dq) * px) / denom
            if px is not None and old_qty != 0.0 and (old_qty * new_qty) < 0.0:
                new_avg = px

    h.shares = float(new_qty)
    h.cost_basis = float(new_qty * (float(new_avg) if new_avg is not None else 0.0))
    h.adjusted_cost_basis = h.cost_basis
    h.avg_cost = (float(new_avg) if new_avg is not None else None)
    h.updated_at = now
    session.add(h)

    if float(new_qty) == 0.0:
        session.delete(h)


# ── Orders ────────────────────────────────────────────────────────────────────

# (Order/broker layer removed — was never enabled in production)

# ── Trades ────────────────────────────────────────────────────────────────────

def list_trades(
    *,
    user_id: int,
    limit: int = 200,
    offset: int = 0,
    symbol: str | None = None,
    is_closed: bool | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    instrument: str | None = None,
) -> list[dict]:
    session = get_session()
    try:
        q = session.query(Trade).filter(Trade.user_id == int(user_id))
        if symbol is not None:
            q = q.filter(Trade.symbol == str(symbol).strip().upper())
        if is_closed is not None:
            q = q.filter(Trade.is_closed == bool(is_closed))
        if date_from is not None:
            q = q.filter(Trade.entry_date >= date_from)
        if date_to is not None:
            q = q.filter(Trade.entry_date <= date_to)
        if instrument is not None:
            q = q.filter(Trade.instrument == normalize_instrument(instrument))
        rows = q.order_by(Trade.entry_date.desc()).offset(int(offset)).limit(int(limit)).all()
        return [_trade_to_dict(t) for t in rows]
    finally:
        session.close()


def _trade_to_dict(t) -> dict:
    return {
        "id": int(getattr(t, "id")),
        "symbol": str(getattr(t, "symbol", "") or ""),
        "instrument": str(getattr(getattr(t, "instrument", None), "value", getattr(t, "instrument", "")) or ""),
        "strategy": (str(getattr(t, "strategy", "") or "") or None),
        "action": str(getattr(getattr(t, "action", None), "value", getattr(t, "action", "")) or ""),
        "quantity": int(getattr(t, "quantity", 0) or 0),
        "entry_price": float(getattr(t, "entry_price", 0.0) or 0.0),
        "entry_date": getattr(t, "entry_date", None),
        "is_closed": bool(getattr(t, "is_closed", False)),
        "exit_date": getattr(t, "exit_date", None),
        "exit_price": (float(getattr(t, "exit_price")) if getattr(t, "exit_price", None) is not None else None),
        "realized_pnl": (float(getattr(t, "realized_pnl")) if getattr(t, "realized_pnl", None) is not None else None),
        "option_type": (str(getattr(getattr(t, "option_type", None), "value", getattr(t, "option_type", "")) or "") or None),
        "strike_price": (float(getattr(t, "strike_price")) if getattr(t, "strike_price", None) is not None else None),
        "expiry_date": getattr(t, "expiry_date", None),
        "notes": (str(getattr(t, "notes", "") or "") or None),
        "client_order_id": (str(getattr(t, "client_order_id", "") or "") or None),
        "account_id": (int(getattr(t, "account_id")) if getattr(t, "account_id", None) is not None else None),
        "created_at": getattr(t, "created_at", None),
        "updated_at": getattr(t, "updated_at", None),
    }


def get_trade(trade_id: int, *, user_id: int) -> dict | None:
    session = get_session()
    try:
        t = session.query(Trade).filter(Trade.id == int(trade_id), Trade.user_id == int(user_id)).first()
        if t is None:
            return None
        return _trade_to_dict(t)
    finally:
        session.close()


def save_trade(
    symbol, instrument, strategy, action, qty, price, date,
    o_type=None, strike=None, expiry=None, user_id=None,
    client_order_id=None, notes=None, account_id=None,
):
    session = get_session()
    try:
        inst_enum = normalize_instrument(instrument)
        act_enum = normalize_action(action)
        opt_enum = normalize_option_type(o_type)
        coid = (str(client_order_id).strip() if client_order_id is not None else "") or None

        if coid and user_id is not None:
            existing = session.query(Trade).filter(Trade.user_id == int(user_id), Trade.client_order_id == coid).first()
            if existing:
                return existing.id

        new_trade = Trade(
            symbol=str(symbol).upper(), quantity=int(qty), instrument=inst_enum,
            strategy=str(strategy), action=act_enum,
            entry_date=pd.to_datetime(date), entry_price=float(price),
            option_type=opt_enum,
            strike_price=float(strike) if strike else None,
            expiry_date=pd.to_datetime(expiry) if expiry else None,
            user_id=int(user_id) if user_id is not None else None,
            client_order_id=coid,
            notes=(str(notes)[:2000] if notes else None),
            account_id=(int(account_id) if account_id is not None else None),
        )
        session.add(new_trade)
        session.flush()

        try:
            if user_id is not None and inst_enum == InstrumentType.STOCK:
                signed_qty = _trade_signed_quantity(action=act_enum, quantity=int(qty))
                _apply_holding_delta(session, user_id=int(user_id), symbol=str(symbol), delta_qty=float(signed_qty), price=float(price))
        except Exception:
            pass

        session.commit()
        return new_trade.id
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def close_trade(trade_id, exit_price, exit_date=None, user_id=None):
    session = get_session()
    try:
        q = session.query(Trade).filter(Trade.id == int(trade_id))
        if user_id is not None:
            q = q.filter(Trade.user_id == int(user_id))
        trade = q.first()
        if not trade:
            return False
        if getattr(trade, "is_closed", False) or getattr(trade, "exit_price", None) is not None:
            return False

        xp = float(exit_price)
        ed = pd.to_datetime(exit_date) if exit_date is not None else pd.to_datetime("today")
        qty = int(trade.quantity or 0)
        entry = float(trade.entry_price or 0.0)
        act = getattr(trade.action, "value", str(trade.action))
        realized = ((entry - xp) * qty) if str(act).upper() == "SELL" else ((xp - entry) * qty)

        trade.exit_price = xp
        trade.exit_date = ed
        trade.realized_pnl = float(realized)
        trade.is_closed = True

        try:
            if user_id is not None and getattr(trade, "instrument", None) == InstrumentType.STOCK:
                signed_entry_qty = _trade_signed_quantity(action=trade.action, quantity=int(qty))
                _apply_holding_delta(session, user_id=int(user_id), symbol=str(getattr(trade, "symbol", "")), delta_qty=float(-signed_entry_qty), price=float(xp))
        except Exception:
            pass

        session.commit()
        return True
    except Exception as e:
        session.rollback()
        _logger.error("Error closing trade: %s", e)
        return False
    finally:
        session.close()


def delete_trade(trade_id, user_id=None):
    session = get_session()
    try:
        q = session.query(Trade).filter(Trade.id == int(trade_id))
        if user_id is not None:
            q = q.filter(Trade.user_id == int(user_id))
        trade_to_delete = q.first()
        if trade_to_delete:
            try:
                if (
                    user_id is not None
                    and getattr(trade_to_delete, "is_closed", False) is False
                    and getattr(trade_to_delete, "instrument", None) == InstrumentType.STOCK
                ):
                    signed_entry_qty = _trade_signed_quantity(action=trade_to_delete.action, quantity=int(getattr(trade_to_delete, "quantity", 0) or 0))
                    _apply_holding_delta(session, user_id=int(user_id), symbol=str(getattr(trade_to_delete, "symbol", "")), delta_qty=float(-signed_entry_qty), price=float(getattr(trade_to_delete, "entry_price", 0.0) or 0.0))
            except Exception:
                pass
            session.delete(trade_to_delete)
            session.commit()
            return True
        return False
    except Exception as e:
        session.rollback()
        _logger.error("Error deleting trade: %s", e)
        return False
    finally:
        session.close()


def update_trade(trade_id, symbol, strategy, action, qty, price, date, user_id=None, notes=None, option_type=None, strike=None, expiry=None):
    session = get_session()
    try:
        q = session.query(Trade).filter(Trade.id == int(trade_id))
        if user_id is not None:
            q = q.filter(Trade.user_id == int(user_id))
        trade = q.first()
        if trade:
            try:
                if (
                    user_id is not None
                    and getattr(trade, "is_closed", False) is False
                    and getattr(trade, "instrument", None) == InstrumentType.STOCK
                ):
                    old_signed = _trade_signed_quantity(action=trade.action, quantity=int(getattr(trade, "quantity", 0) or 0))
                    new_act = normalize_action(action)
                    new_signed = _trade_signed_quantity(action=new_act, quantity=int(qty))
                    old_sym = str(getattr(trade, "symbol", "") or "").strip().upper()
                    new_sym = str(symbol or "").strip().upper()
                    if old_sym and new_sym and old_sym != new_sym:
                        _apply_holding_delta(session, user_id=int(user_id), symbol=old_sym, delta_qty=float(-old_signed), price=float(getattr(trade, "entry_price", 0.0) or 0.0))
                        _apply_holding_delta(session, user_id=int(user_id), symbol=new_sym, delta_qty=float(new_signed), price=float(price))
                    else:
                        delta = float(new_signed - old_signed)
                        if abs(delta) > 1e-12 and new_sym:
                            _apply_holding_delta(session, user_id=int(user_id), symbol=new_sym, delta_qty=float(delta), price=float(price))
            except Exception:
                pass

            trade.symbol = str(symbol).upper()
            trade.strategy = str(strategy)
            trade.action = normalize_action(action)
            trade.quantity = int(qty)
            trade.entry_price = float(price)
            trade.entry_date = pd.to_datetime(date)
            if notes is not None:
                trade.notes = str(notes)[:2000]
            if option_type is not None:
                trade.option_type = normalize_option_type(option_type)
            if strike is not None:
                trade.strike_price = float(strike)
            if expiry is not None:
                trade.expiry_date = pd.to_datetime(expiry)
            session.commit()
            return True
        return False
    except Exception as e:
        session.rollback()
        _logger.error("Error updating trade: %s", e)
        return False
    finally:
        session.close()


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


# ── Bulk data loader (legacy) ─────────────────────────────────────────────────

def load_data(user_id=None):
    """Load trades, cash, budget as DataFrames. Kept for legacy callers."""
    from database.models import get_budget_engine
    try:
        import database.models as _dbm
        try:
            import logic.services as _svc
            _trades_engine = _svc.engine if getattr(_svc, "engine", None) is not None else _dbm.get_trades_engine()
            _budget_engine = _svc.engine if getattr(_svc, "engine", None) is not None else _dbm.get_budget_engine()
        except Exception:
            _trades_engine = _dbm.get_trades_engine()
            _budget_engine = _dbm.get_budget_engine()

        if user_id is None:
            trades = pd.read_sql("SELECT * FROM trades", _trades_engine)
            cash = pd.read_sql("SELECT * FROM cash_flow", _budget_engine)
            budget = pd.read_sql("SELECT * FROM budget", _budget_engine)
        else:
            trades = pd.read_sql("SELECT * FROM trades WHERE user_id = :uid", _trades_engine, params={"uid": int(user_id)})
            cash = pd.read_sql("SELECT * FROM cash_flow WHERE user_id = :uid", _budget_engine, params={"uid": int(user_id)})
            budget = pd.read_sql("SELECT * FROM budget WHERE user_id = :uid", _budget_engine, params={"uid": int(user_id)})

        if not trades.empty:
            trades["entry_date"] = pd.to_datetime(trades["entry_date"])
            if "exit_date" in trades.columns:
                trades["exit_date"] = pd.to_datetime(trades["exit_date"], errors="coerce")
        if not cash.empty:
            cash["date"] = pd.to_datetime(cash["date"])
        if not budget.empty:
            budget["date"] = pd.to_datetime(budget["date"])
        return trades, cash, budget
    except Exception:
        return pd.DataFrame(), pd.DataFrame(), pd.DataFrame()
