import logging
import pandas as pd
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timezone
from datetime import timedelta
from sqlalchemy.orm import sessionmaker

_logger = logging.getLogger("optionflow.services")

from brokers import broker_enabled as _broker_enabled
from brokers import get_broker
from brokers.base import SubmitOrderRequest
from database.models import (
    Trade, CashFlow, Budget, CreditCardWeek, BudgetOverride,
    Order,
    Account, StockHolding,
    InstrumentType, OptionType, Action, CashAction, BudgetType,
    OrderStatus,
    LedgerAccount, LedgerAccountType,
    LedgerEntry, LedgerEntryType,
    LedgerLine,
    get_engine,
    get_users_engine, get_trades_engine, get_budget_engine,
    get_portfolio_engine, get_markets_engine,
    get_users_session, get_trades_session, get_budget_session,
    get_portfolio_session, get_markets_session,
)


_HOLDINGS_SYNC_ACCOUNT_NAME = (os.getenv("HOLDINGS_SYNC_ACCOUNT_NAME") or "Trading").strip() or "Trading"


def _get_or_create_cash_ledger_accounts(session, *, user_id: int, currency: str = "USD") -> tuple[LedgerAccount, LedgerAccount]:
    """Return (cash_asset_account, equity_funding_account) for the user."""
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
            user_id=int(user_id),
            name=cash_name,
            type=LedgerAccountType.ASSET,
            currency=cur,
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
            user_id=int(user_id),
            name=equity_name,
            type=LedgerAccountType.EQUITY,
            currency=cur,
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

    et = LedgerEntryType.CASH_DEPOSIT if str(getattr(action, "value", action)).upper() == "DEPOSIT" else LedgerEntryType.CASH_WITHDRAW
    # Idempotency: if already posted, no-op.
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
        user_id=int(user_id),
        entry_type=et,
        created_at=now,
        effective_at=effective_at,
        description=(str(notes)[:500] if notes else None),
        idempotency_key=(str(idempotency_key) if idempotency_key else None),
        source_type=(str(source_type) if source_type else None),
        source_id=(int(source_id) if source_id is not None else None),
    )
    session.add(e)
    session.flush()

    if et == LedgerEntryType.CASH_DEPOSIT:
        # Debit Cash, Credit Equity
        lines = [
            LedgerLine(entry_id=int(e.id), account_id=int(cash_acct.id), amount=+amt, memo=None),
            LedgerLine(entry_id=int(e.id), account_id=int(equity_acct.id), amount=-amt, memo=None),
        ]
    else:
        # Debit Equity, Credit Cash
        lines = [
            LedgerLine(entry_id=int(e.id), account_id=int(equity_acct.id), amount=+amt, memo=None),
            LedgerLine(entry_id=int(e.id), account_id=int(cash_acct.id), amount=-amt, memo=None),
        ]

    session.add_all(lines)


def _trade_signed_quantity(*, action: Action, quantity: int) -> float:
    act = getattr(action, "value", str(action))
    act_up = str(act).upper()
    q = float(int(quantity or 0))
    return q if act_up == "BUY" else -q


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


def _apply_holding_delta(
    session,
    *,
    user_id: int,
    symbol: str,
    delta_qty: float,
    price: float | None,
) -> None:
    # Best-effort: no-op on tiny deltas.
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
            user_id=int(user_id),
            account_id=int(acct.id),
            symbol=sym,
            shares=0.0,
            cost_basis=0.0,
            adjusted_cost_basis=0.0,
            avg_cost=None,
            updated_at=now,
        )
        session.add(h)
        session.flush()

    old_qty = float(getattr(h, "shares", 0.0) or 0.0)
    old_avg = getattr(h, "avg_cost", None)
    new_qty = old_qty + dq

    # Clamp tiny float noise to 0.
    if abs(new_qty) < 1e-9:
        new_qty = 0.0

    px = float(price) if price is not None else None
    new_avg = old_avg

    if new_qty == 0.0:
        new_avg = None
    else:
        # If opening a position (or we never had a cost basis), set avg_cost from price when available.
        if (old_qty == 0.0 or old_avg is None) and px is not None:
            new_avg = px
        else:
            # If increasing position magnitude in same direction, blend via moving average.
            if px is not None and old_qty != 0.0 and (old_qty * dq) > 0.0:
                denom = abs(old_qty) + abs(dq)
                if denom > 0:
                    base = float(old_avg or 0.0)
                    new_avg = (abs(old_qty) * base + abs(dq) * px) / denom

            # If we cross through zero (flip long<->short), reset basis to the trade price when available.
            if px is not None and old_qty != 0.0 and (old_qty * new_qty) < 0.0:
                new_avg = px

    h.shares = float(new_qty)
    h.cost_basis = float(new_qty * (float(new_avg) if new_avg is not None else 0.0))
    h.adjusted_cost_basis = h.cost_basis
    h.avg_cost = (float(new_avg) if new_avg is not None else None)
    h.updated_at = now
    session.add(h)

    # Avoid clutter: delete empty rows.
    if float(new_qty) == 0.0:
        session.delete(h)


def _order_status_str(v) -> str:
    return str(getattr(v, "value", v) or "")


def _append_order_event(
    session,
    *,
    user_id: int,
    order: Order,
    event_type: str,
    note: str | None = None,
) -> None:
    from database.models import OrderEvent

    ev = OrderEvent(
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        user_id=int(user_id),
        order_id=int(getattr(order, "id")),
        event_type=str(event_type).upper(),
        order_status=(_order_status_str(getattr(order, "status", None)) or None),
        external_status=(str(getattr(order, "external_status", "") or "") or None),
        note=(str(note)[:500] if note else None),
    )
    session.add(ev)


def create_order(
    *,
    user_id: int,
    symbol: str,
    instrument: str = "STOCK",
    action: str = "BUY",
    strategy: str | None = None,
    qty: int = 1,
    limit_price: float | None = None,
    client_order_id: str | None = None,
) -> int:
    session = get_session()
    try:
        sym = str(symbol or "").strip().upper()
        if not sym:
            raise ValueError("symbol is required")
        if int(qty) < 1:
            raise ValueError("qty must be >= 1")

        inst_enum = normalize_instrument(instrument)
        act_enum = normalize_action(action)
        coid = (str(client_order_id).strip() if client_order_id is not None else "") or None

        if coid:
            existing = (
                session.query(Order)
                .filter(Order.user_id == int(user_id))
                .filter(Order.client_order_id == coid)
                .first()
            )
            if existing is not None:
                return int(existing.id)

        now = datetime.now(timezone.utc).replace(tzinfo=None)
        o = Order(
            user_id=int(user_id),
            symbol=sym,
            instrument=inst_enum,
            action=act_enum,
            strategy=(str(strategy).strip() if strategy else None),
            quantity=int(qty),
            limit_price=(float(limit_price) if limit_price is not None else None),
            status=OrderStatus.PENDING,
            created_at=now,
            filled_at=None,
            filled_price=None,
            trade_id=None,
            client_order_id=coid,
        )
        session.add(o)
        session.flush()  # assign order id for event history (and broker submission)
        _append_order_event(session, user_id=int(user_id), order=o, event_type="CREATED")

        # Execution-capable mode: submit to configured broker/OMS and persist linkage.
        if _broker_enabled():
            broker = get_broker()
            resp = broker.submit_order(
                user_id=int(user_id),
                req=SubmitOrderRequest(
                    symbol=sym,
                    instrument=str(inst_enum.value),
                    action=str(act_enum.value),
                    quantity=int(qty),
                    limit_price=(float(limit_price) if limit_price is not None else None),
                    client_order_id=(coid or f"order:{int(o.id)}"),
                ),
            )
            o.external_order_id = str(resp.external_order_id)
            o.venue = str(resp.venue)
            o.external_status = str(resp.external_status)
            o.last_synced_at = getattr(resp, "submitted_at", None)
            session.add(o)
            _append_order_event(session, user_id=int(user_id), order=o, event_type="SUBMITTED")

        session.commit()
        return int(o.id)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def list_orders(*, user_id: int, limit: int = 100, offset: int = 0) -> list[dict]:
    session = get_session()
    try:
        rows = (
            session.query(Order)
            .filter(Order.user_id == int(user_id))
            .order_by(Order.created_at.desc())
            .offset(int(offset))
            .limit(int(limit))
            .all()
        )
        out: list[dict] = []
        for o in rows:
            out.append(
                {
                    "id": int(getattr(o, "id")),
                    "symbol": str(getattr(o, "symbol", "") or ""),
                    "instrument": str(getattr(getattr(o, "instrument", None), "value", getattr(o, "instrument", "")) or ""),
                    "action": str(getattr(getattr(o, "action", None), "value", getattr(o, "action", "")) or ""),
                    "strategy": (str(getattr(o, "strategy", "") or "") or None),
                    "quantity": int(getattr(o, "quantity", 0) or 0),
                    "limit_price": (float(getattr(o, "limit_price")) if getattr(o, "limit_price", None) is not None else None),
                    "status": str(getattr(getattr(o, "status", None), "value", getattr(o, "status", "")) or ""),
                    "created_at": getattr(o, "created_at", None),
                    "filled_at": getattr(o, "filled_at", None),
                    "filled_price": (float(getattr(o, "filled_price")) if getattr(o, "filled_price", None) is not None else None),
                    "trade_id": (int(getattr(o, "trade_id")) if getattr(o, "trade_id", None) is not None else None),
                    "client_order_id": (str(getattr(o, "client_order_id", "") or "") or None),
                    "external_order_id": (str(getattr(o, "external_order_id", "") or "") or None),
                    "venue": (str(getattr(o, "venue", "") or "") or None),
                    "external_status": (str(getattr(o, "external_status", "") or "") or None),
                    "last_synced_at": getattr(o, "last_synced_at", None),
                }
            )
        return out
    finally:
        session.close()


def list_order_events(*, user_id: int, order_id: int, limit: int = 200) -> list[dict]:
    session = get_session()
    try:
        from database.models import OrderEvent

        rows = (
            session.query(OrderEvent)
            .filter(OrderEvent.user_id == int(user_id))
            .filter(OrderEvent.order_id == int(order_id))
            .order_by(OrderEvent.created_at.asc())
            .limit(int(limit))
            .all()
        )
        out: list[dict] = []
        for r in rows:
            out.append(
                {
                    "id": int(getattr(r, "id")),
                    "created_at": getattr(r, "created_at", None),
                    "event_type": str(getattr(r, "event_type", "") or ""),
                    "order_status": (str(getattr(r, "order_status", "") or "") or None),
                    "external_status": (str(getattr(r, "external_status", "") or "") or None),
                    "note": (str(getattr(r, "note", "") or "") or None),
                }
            )
        return out
    finally:
        session.close()


def cancel_order(*, user_id: int, order_id: int) -> bool:
    session = get_session()
    try:
        o = (
            session.query(Order)
            .filter(Order.id == int(order_id))
            .filter(Order.user_id == int(user_id))
            .first()
        )
        if o is None:
            return False
        if getattr(o, "status", None) != OrderStatus.PENDING:
            return False

        if _broker_enabled() and getattr(o, "external_order_id", None):
            broker = get_broker()
            broker.cancel_order(user_id=int(user_id), external_order_id=str(getattr(o, "external_order_id")))
            o.external_status = "CANCELLED"
            o.last_synced_at = datetime.now(timezone.utc).replace(tzinfo=None)

        o.status = OrderStatus.CANCELLED
        session.add(o)
        _append_order_event(session, user_id=int(user_id), order=o, event_type="CANCELLED")
        session.commit()
        return True
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def sync_order_status(*, user_id: int, order_id: int) -> bool:
    """Sync an order's external status from the configured broker/OMS adapter."""
    if not _broker_enabled():
        return False

    session = get_session()
    try:
        o = (
            session.query(Order)
            .filter(Order.user_id == int(user_id))
            .filter(Order.id == int(order_id))
            .first()
        )
        if o is None:
            return False
        if not getattr(o, "external_order_id", None):
            return False

        broker = get_broker()
        resp = broker.get_order_status(user_id=int(user_id), external_order_id=str(getattr(o, "external_order_id")))
        o.venue = str(resp.venue)
        o.external_status = str(resp.external_status)
        o.last_synced_at = resp.last_synced_at
        session.add(o)
        _append_order_event(session, user_id=int(user_id), order=o, event_type="SYNCED")
        session.commit()
        return True
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def sync_pending_orders(*, user_id: int, limit: int = 200) -> int:
    """Sync external status for all pending, broker-linked orders for a user."""
    if not _broker_enabled():
        return 0
    session = get_session()
    try:
        rows = (
            session.query(Order)
            .filter(Order.user_id == int(user_id))
            .filter(Order.status == OrderStatus.PENDING)
            .filter(Order.external_order_id.isnot(None))
            .order_by(Order.created_at.desc())
            .limit(int(limit))
            .all()
        )
        if not rows:
            return 0
        broker = get_broker()
        updated = 0
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        for o in rows:
            resp = broker.get_order_status(user_id=int(user_id), external_order_id=str(o.external_order_id))
            o.venue = str(resp.venue)
            o.external_status = str(resp.external_status)
            o.last_synced_at = getattr(resp, "last_synced_at", None) or now
            session.add(o)
            updated += 1
        session.commit()
        return int(updated)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def fill_order_via_broker(
    *,
    user_id: int,
    order_id: int,
    filled_price: float,
    filled_at=None,
) -> int:
    """Ask the broker/OMS to fill, then record the fill locally (creates Trade + marks Order FILLED)."""
    if not _broker_enabled():
        raise ValueError("broker disabled")

    session = get_session()
    try:
        o = (
            session.query(Order)
            .filter(Order.user_id == int(user_id))
            .filter(Order.id == int(order_id))
            .first()
        )
        if o is None:
            raise ValueError("order not found")
        if getattr(o, "status", None) != OrderStatus.PENDING:
            raise ValueError("order not fillable")
        if not getattr(o, "external_order_id", None):
            raise ValueError("order not linked to broker")

        broker = get_broker()
        resp = broker.fill_order(
            user_id=int(user_id),
            external_order_id=str(o.external_order_id),
            filled_price=float(filled_price),
            filled_at=filled_at,
        )

        # Update linkage fields first; then reuse our canonical fill path.
        o.external_status = str(resp.external_status)
        o.last_synced_at = getattr(resp, "filled_at", None)
        session.add(o)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

    # Canonical local fill: creates trade and marks order FILLED.
    return fill_order(user_id=int(user_id), order_id=int(order_id), filled_price=float(filled_price), filled_at=filled_at)


def fill_order(*, user_id: int, order_id: int, filled_price: float, filled_at=None) -> int:
    session = get_session()
    try:
        o = (
            session.query(Order)
            .filter(Order.id == int(order_id))
            .filter(Order.user_id == int(user_id))
            .first()
        )
        if o is None:
            raise ValueError("order not found")
        if getattr(o, "status", None) != OrderStatus.PENDING:
            raise ValueError("order is not fillable")

        px = float(filled_price)
        if px <= 0:
            raise ValueError("filled_price must be > 0")

        ts = pd.to_datetime(filled_at) if filled_at is not None else pd.to_datetime("today")

        # Create the trade row in the same transaction.
        inst_enum = getattr(o, "instrument", InstrumentType.STOCK)
        act_enum = getattr(o, "action", Action.BUY)
        sym = str(getattr(o, "symbol", "") or "").strip().upper()
        qty = int(getattr(o, "quantity", 0) or 0)
        strat = str(getattr(o, "strategy", "") or "Swing")

        # Ensure a client_order_id for the trade to prevent accidental duplication.
        trade_coid = (str(getattr(o, "client_order_id", "") or "").strip() or None)
        if trade_coid is None:
            trade_coid = f"order:{int(order_id)}"

        # If a trade already exists for this order, return it (defensive).
        existing_trade = (
            session.query(Trade)
            .filter(Trade.user_id == int(user_id))
            .filter(Trade.client_order_id == trade_coid)
            .first()
        )
        if existing_trade is not None:
            o.status = OrderStatus.FILLED
            o.filled_price = px
            o.filled_at = ts.to_pydatetime() if hasattr(ts, "to_pydatetime") else ts
            o.trade_id = int(getattr(existing_trade, "id"))
            session.add(o)
            _append_order_event(session, user_id=int(user_id), order=o, event_type="FILLED")
            session.commit()
            return int(getattr(existing_trade, "id"))

        new_trade = Trade(
            symbol=sym,
            quantity=int(qty),
            instrument=inst_enum,
            strategy=strat,
            action=act_enum,
            entry_date=ts,
            entry_price=float(px),
            option_type=None,
            strike_price=None,
            expiry_date=None,
            user_id=int(user_id),
            client_order_id=trade_coid,
        )
        session.add(new_trade)
        session.flush()  # assign id

        # Auto-sync holdings for STOCK trades.
        try:
            if inst_enum == InstrumentType.STOCK:
                signed_qty = _trade_signed_quantity(action=act_enum, quantity=int(qty))
                _apply_holding_delta(
                    session,
                    user_id=int(user_id),
                    symbol=sym,
                    delta_qty=float(signed_qty),
                    price=float(px),
                )
        except Exception:
            pass

        o.status = OrderStatus.FILLED
        o.filled_price = float(px)
        o.filled_at = ts.to_pydatetime() if hasattr(ts, "to_pydatetime") else ts
        o.trade_id = int(getattr(new_trade, "id"))
        session.add(o)
        _append_order_event(session, user_id=int(user_id), order=o, event_type="FILLED")
        session.commit()
        return int(getattr(new_trade, "id"))
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _utc_naive_from_epoch_seconds(epoch_seconds: int) -> datetime:
    return datetime.fromtimestamp(int(epoch_seconds), tz=timezone.utc).replace(tzinfo=None)


def _epoch_seconds_from_utc_naive(dt: datetime) -> int:
    # Treat naive datetimes as UTC.
    return int(dt.replace(tzinfo=timezone.utc).timestamp())

# NOTE: create engine/session per-call to ensure we respect the current
# `DATABASE_URL` environment variable at runtime. If `engine`/`Session`
# are created at import time they may point to a different DB (e.g. local
# sqlite) if env vars change between processes.

def get_session():
    """Default session — uses trades.db. Legacy alias kept for backwards compat."""
    try:
        if engine is not None:
            _engine = engine
        else:
            _engine = get_trades_engine()
    except NameError:
        _engine = get_trades_engine()
    Session = sessionmaker(bind=_engine)
    return Session()


def _users_session():
    """Session for users.db (auth, tokens, events)."""
    try:
        if engine is not None:
            return sessionmaker(bind=engine)()
    except NameError:
        pass
    return get_users_session()


def _budget_session():
    """Session for budget.db (budget, cc_weeks, cash_flow, ledger)."""
    try:
        if engine is not None:
            return sessionmaker(bind=engine)()
    except NameError:
        pass
    return get_budget_session()


def _portfolio_session():
    """Session for portfolio.db (holdings, option positions, premium ledger)."""
    try:
        if engine is not None:
            return sessionmaker(bind=engine)()
    except NameError:
        pass
    return get_portfolio_session()


# Compatibility placeholder: tests may monkeypatch `logic.services.engine`.
engine = None
# Compatibility placeholder: tests may also monkeypatch a Session factory
Session = None

try:
    from passlib.context import CryptContext
except Exception as e:
    raise ImportError(
        "passlib is required for secure password hashing. Install with: `pip install passlib[bcrypt]`"
    ) from e

# Use passlib CryptContext. Use PBKDF2-SHA256 to avoid system bcrypt backend issues
# (still secure and avoids the bcrypt 72-byte limitation and native backend compatibility).
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


def _refresh_token_pepper() -> str:
    # Prefer a dedicated pepper, fall back to JWT secret for convenience.
    return (
        os.getenv("REFRESH_TOKEN_PEPPER")
        or os.getenv("JWT_SECRET")
        or "dev-insecure-secret"
    )


def _hash_refresh_token(token: str) -> str:
    tok = str(token or "").strip()
    return hmac.new(_refresh_token_pepper().encode("utf-8"), tok.encode("utf-8"), hashlib.sha256).hexdigest()


def _refresh_token_ttl_days() -> int:
    try:
        return int(os.getenv("REFRESH_TOKEN_EXPIRES_DAYS", "30"))
    except Exception:
        return 30


def create_refresh_token(*, user_id: int, ip: str | None = None, user_agent: str | None = None) -> str:
    """Create and persist a new refresh token for a user.

    Returns the *raw* refresh token (store it securely client-side).
    """
    session = _users_session()
    try:
        from database.models import RefreshToken

        raw = f"rt_{secrets.token_urlsafe(32)}"
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        expires_at = (datetime.now(timezone.utc) + timedelta(days=_refresh_token_ttl_days())).replace(tzinfo=None)
        ua = (str(user_agent)[:500] if user_agent else None)
        ip_s = (str(ip).strip() if ip else None)
        rt = RefreshToken(
            user_id=int(user_id),
            token_hash=_hash_refresh_token(raw),
            created_at=now,
            created_ip=ip_s,
            created_user_agent=ua,
            last_used_at=now,
            last_used_ip=ip_s,
            last_used_user_agent=ua,
            expires_at=expires_at,
            revoked_at=None,
            revoked_reason=None,
            replaced_by_token_id=None,
        )
        session.add(rt)
        session.commit()
        return raw
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def validate_refresh_token(*, refresh_token: str) -> int | None:
    """Return user_id if the refresh token is valid, else None."""
    session = _users_session()
    try:
        from database.models import RefreshToken

        th = _hash_refresh_token(refresh_token)
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        rt = session.query(RefreshToken).filter(RefreshToken.token_hash == th).first()
        if not rt:
            return None
        if getattr(rt, "revoked_at", None) is not None:
            return None
        if getattr(rt, "expires_at", now) <= now:
            return None
        return int(getattr(rt, "user_id"))
    finally:
        session.close()


def rotate_refresh_token(
    *,
    refresh_token: str,
    ip: str | None = None,
    user_agent: str | None = None,
) -> tuple[int, str] | None:
    """Atomically rotate a refresh token.

    On success, revokes the old token and returns (user_id, new_refresh_token).
    """
    session = _users_session()
    try:
        from database.models import RefreshToken

        th = _hash_refresh_token(refresh_token)
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        rt = session.query(RefreshToken).filter(RefreshToken.token_hash == th).first()
        if not rt:
            return None
        if getattr(rt, "revoked_at", None) is not None:
            return None
        if getattr(rt, "expires_at", now) <= now:
            return None

        user_id = int(getattr(rt, "user_id"))
        new_raw = f"rt_{secrets.token_urlsafe(32)}"
        ua = (str(user_agent)[:500] if user_agent else None)
        ip_s = (str(ip).strip() if ip else None)
        new_rt = RefreshToken(
            user_id=user_id,
            token_hash=_hash_refresh_token(new_raw),
            created_at=now,
            created_ip=ip_s,
            created_user_agent=ua,
            last_used_at=now,
            last_used_ip=ip_s,
            last_used_user_agent=ua,
            expires_at=(datetime.now(timezone.utc) + timedelta(days=_refresh_token_ttl_days())).replace(tzinfo=None),
            revoked_at=None,
            revoked_reason=None,
            replaced_by_token_id=None,
        )
        session.add(new_rt)
        session.flush()  # assign id

        rt.revoked_at = now
        rt.revoked_reason = "rotated"
        rt.replaced_by_token_id = int(getattr(new_rt, "id"))
        session.add(rt)
        session.commit()
        return user_id, new_raw
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def revoke_refresh_token(*, user_id: int | None = None, refresh_token: str) -> None:
    """Revoke a single refresh token (best-effort, no error if missing)."""
    session = _users_session()
    try:
        from database.models import RefreshToken

        th = _hash_refresh_token(refresh_token)
        q = session.query(RefreshToken).filter(RefreshToken.token_hash == th)
        if user_id is not None:
            q = q.filter(RefreshToken.user_id == int(user_id))
        rt = q.first()
        if not rt:
            return
        if getattr(rt, "revoked_at", None) is not None:
            return
        rt.revoked_at = datetime.now(timezone.utc).replace(tzinfo=None)
        rt.revoked_reason = "revoked"
        session.add(rt)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def revoke_all_refresh_tokens(*, user_id: int) -> int:
    """Revoke all refresh tokens for a user. Returns count revoked."""
    session = _users_session()
    try:
        from database.models import RefreshToken

        now = datetime.now(timezone.utc).replace(tzinfo=None)
        tokens = (
            session.query(RefreshToken)
            .filter(RefreshToken.user_id == int(user_id))
            .filter(RefreshToken.revoked_at.is_(None))
            .all()
        )
        n = 0
        for rt in tokens:
            rt.revoked_at = now
            rt.revoked_reason = "revoked_all"
            session.add(rt)
            n += 1
        session.commit()
        return int(n)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def list_refresh_sessions(*, user_id: int, limit: int = 25) -> list[dict]:
    """List active (non-revoked, non-expired) refresh sessions for a user."""
    session = _users_session()
    try:
        from database.models import RefreshToken

        now = datetime.now(timezone.utc).replace(tzinfo=None)
        rows = (
            session.query(RefreshToken)
            .filter(RefreshToken.user_id == int(user_id))
            .filter(RefreshToken.revoked_at.is_(None))
            .filter(RefreshToken.expires_at > now)
            .order_by(RefreshToken.created_at.desc())
            .limit(int(limit))
            .all()
        )
        out: list[dict] = []
        for r in rows:
            out.append(
                {
                    "id": int(getattr(r, "id")),
                    "created_at": getattr(r, "created_at", None),
                    "last_used_at": getattr(r, "last_used_at", None),
                    "ip": str(getattr(r, "last_used_ip", "") or getattr(r, "created_ip", "") or "") or None,
                    "user_agent": str(getattr(r, "last_used_user_agent", "") or getattr(r, "created_user_agent", "") or "") or None,
                    "expires_at": getattr(r, "expires_at", None),
                }
            )
        return out
    finally:
        session.close()


def revoke_refresh_session_by_id(*, user_id: int, session_id: int, reason: str = "revoked") -> bool:
    session = _users_session()
    try:
        from database.models import RefreshToken

        rt = (
            session.query(RefreshToken)
            .filter(RefreshToken.user_id == int(user_id))
            .filter(RefreshToken.id == int(session_id))
            .first()
        )
        if not rt:
            return False
        if getattr(rt, "revoked_at", None) is not None:
            return True
        rt.revoked_at = datetime.now(timezone.utc).replace(tzinfo=None)
        rt.revoked_reason = str(reason)[:100]
        session.add(rt)
        session.commit()
        return True
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _rate_limit_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except Exception:
        return int(default)


def log_auth_event(
    *,
    event_type: str,
    success: bool,
    username: str | None = None,
    user_id: int | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
    detail: str | None = None,
) -> None:
    """Append an auth audit event (best-effort)."""
    session = _users_session()
    try:
        from database.models import AuthEvent

        ev = AuthEvent(
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
            event_type=str(event_type),
            success=bool(success),
            username=(str(username).strip() if username is not None else None),
            user_id=(int(user_id) if user_id is not None else None),
            ip=(str(ip).strip() if ip is not None else None),
            user_agent=(str(user_agent)[:500] if user_agent else None),
            detail=(str(detail)[:500] if detail else None),
        )
        session.add(ev)
        session.commit()
    except Exception:
        session.rollback()
        # Never block auth flows on logging failures.
        return
    finally:
        session.close()


def list_auth_events(*, user_id: int, limit: int = 25) -> list[dict]:
    session = _users_session()
    try:
        from database.models import AuthEvent

        rows = (
            session.query(AuthEvent)
            .filter(AuthEvent.user_id == int(user_id))
            .order_by(AuthEvent.created_at.desc())
            .limit(int(limit))
            .all()
        )
        out: list[dict] = []
        for r in rows:
            out.append(
                {
                    "created_at": getattr(r, "created_at", None),
                    "event_type": str(getattr(r, "event_type", "")),
                    "success": bool(getattr(r, "success", False)),
                    "ip": str(getattr(r, "ip", "") or ""),
                    "detail": str(getattr(r, "detail", "") or ""),
                }
            )
        return out
    finally:
        session.close()


def is_login_rate_limited(*, username: str, ip: str | None = None) -> bool:
    """Rate limit by counting failed login attempts in a window."""
    window_s = _rate_limit_int("LOGIN_RATE_LIMIT_WINDOW_SECONDS", 300)
    max_failures = _rate_limit_int("LOGIN_RATE_LIMIT_MAX_FAILURES", 10)
    if max_failures <= 0:
        return False

    since = datetime.now(timezone.utc) - timedelta(seconds=int(window_s))
    since_naive = since.replace(tzinfo=None)
    session = _users_session()
    try:
        from database.models import AuthEvent

        q = (
            session.query(AuthEvent)
            .filter(AuthEvent.event_type == "login")
            .filter(AuthEvent.success.is_(False))
            .filter(AuthEvent.created_at >= since_naive)
            .filter(AuthEvent.username == str(username).strip())
        )
        if ip:
            q = q.filter(AuthEvent.ip == str(ip).strip())
        count = int(q.count())
        return count >= int(max_failures)
    finally:
        session.close()


def is_refresh_rate_limited(*, ip: str | None = None) -> bool:
    """Rate limit refresh attempts in a short window (counts all refresh attempts)."""
    window_s = _rate_limit_int("REFRESH_RATE_LIMIT_WINDOW_SECONDS", 60)
    max_attempts = _rate_limit_int("REFRESH_RATE_LIMIT_MAX_ATTEMPTS", 60)
    if max_attempts <= 0:
        return False

    since = datetime.now(timezone.utc) - timedelta(seconds=int(window_s))
    since_naive = since.replace(tzinfo=None)
    session = _users_session()
    try:
        from database.models import AuthEvent

        q = (
            session.query(AuthEvent)
            .filter(AuthEvent.event_type == "refresh")
            .filter(AuthEvent.created_at >= since_naive)
        )
        if ip:
            q = q.filter(AuthEvent.ip == str(ip).strip())
        count = int(q.count())
        return count >= int(max_attempts)
    finally:
        session.close()


def create_user(username, password, role="user"):
    session = _users_session()
    try:
        username = str(username).strip().lower()
        if not username:
            raise ValueError('username required')
        from database.models import User
        existing = session.query(User).filter(User.username == username).first()
        if existing:
            raise ValueError('username already exists')
        password = str(password)
        if not password:
            raise ValueError('password required')
        _validate_password_policy(password)
        ph = pwd_context.hash(password)
        user = User(username=username, password_hash=ph, salt=None, role=str(role), is_active=True)
        session.add(user)
        session.commit()
        return user.id
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _normalize_str(x):
    """Return a stripped string or empty string for None/empty input."""
    if x is None:
        return ''
    return str(x).strip()


def authenticate_user(username, password):
    session = _users_session()
    try:
        from database.models import User
        uname = str(username).strip().lower()
        u = session.query(User).filter(User.username == uname).first()
        if not u:
            return None
        # Block disabled accounts
        if hasattr(u, 'is_active') and not u.is_active:
            return None
        ok = pwd_context.verify(password, u.password_hash)
        if not ok:
            return None
        role = str(getattr(u, 'role', None) or 'user')
        return {"user_id": u.id, "role": role}
    finally:
        session.close()


def get_user(user_id: int):
    session = _users_session()
    try:
        from database.models import User
        return session.query(User).filter(User.id == int(user_id)).first()
    finally:
        session.close()


def list_all_users():
    session = _users_session()
    try:
        from database.models import User
        return session.query(User).order_by(User.created_at.asc()).all()
    finally:
        session.close()


def patch_user_admin(user_id: int, *, role: str | None = None, is_active: bool | None = None):
    session = _users_session()
    try:
        from database.models import User
        u = session.query(User).filter(User.id == int(user_id)).first()
        if not u:
            raise ValueError("user not found")
        if role is not None:
            u.role = str(role)
        if is_active is not None:
            u.is_active = bool(is_active)
        session.add(u)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def delete_user_admin(user_id: int) -> None:
    session = _users_session()
    try:
        from database.models import User
        u = session.query(User).filter(User.id == int(user_id)).first()
        if not u:
            raise ValueError("user not found")
        session.delete(u)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def set_auth_valid_after_epoch(*, user_id: int, epoch_seconds: int) -> None:
    session = _users_session()
    try:
        from database.models import User
        u = session.query(User).filter(User.id == int(user_id)).first()
        if not u:
            raise ValueError("user not found")
        u.auth_valid_after = _utc_naive_from_epoch_seconds(int(epoch_seconds))
        session.add(u)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def is_token_time_valid(*, user_id: int, token_iat: int) -> bool:
    u = get_user(int(user_id))
    if u is None:
        return False
    ava = getattr(u, "auth_valid_after", None)
    if not ava:
        return True
    try:
        cutoff = _epoch_seconds_from_utc_naive(ava)
    except Exception:
        return True
    return int(token_iat) >= int(cutoff)


def change_password(
    *,
    user_id: int,
    old_password: str,
    new_password: str,
    invalidate_tokens_before_epoch: int | None = None,
) -> None:
    session = _users_session()
    try:
        from database.models import User
        u = session.query(User).filter(User.id == int(user_id)).first()
        if not u:
            raise ValueError("user not found")
        if not pwd_context.verify(str(old_password), u.password_hash):
            raise ValueError("current password is incorrect")
        new_password = str(new_password)
        if not new_password:
            raise ValueError("new password is required")
        _validate_password_policy(new_password)
        u.password_hash = pwd_context.hash(new_password)
        if invalidate_tokens_before_epoch is not None:
            u.auth_valid_after = _utc_naive_from_epoch_seconds(int(invalidate_tokens_before_epoch))
        else:
            # Best-effort: invalidate tokens issued before "now".
            u.auth_valid_after = datetime.now(timezone.utc).replace(tzinfo=None)
        session.add(u)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _policy_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except Exception:
        return int(default)


def _policy_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return bool(default)
    return str(raw).strip().lower() in {"1", "true", "yes", "y", "on"}


def _validate_password_policy(password: str) -> None:
    """Raise ValueError if password does not meet policy.

    Defaults (can be overridden via env):
    - PASSWORD_MIN_LENGTH=12
    - PASSWORD_REQUIRE_UPPER=true
    - PASSWORD_REQUIRE_LOWER=true
    - PASSWORD_REQUIRE_DIGIT=true
    - PASSWORD_REQUIRE_SPECIAL=false
    """

    pw = str(password or "")
    min_len = _policy_int("PASSWORD_MIN_LENGTH", 12)
    req_upper = _policy_bool("PASSWORD_REQUIRE_UPPER", True)
    req_lower = _policy_bool("PASSWORD_REQUIRE_LOWER", True)
    req_digit = _policy_bool("PASSWORD_REQUIRE_DIGIT", True)
    req_special = _policy_bool("PASSWORD_REQUIRE_SPECIAL", False)

    if len(pw) < int(min_len):
        raise ValueError(f"password must be at least {int(min_len)} characters")
    if req_upper and not any(c.isupper() for c in pw):
        raise ValueError("password must include an uppercase letter")
    if req_lower and not any(c.islower() for c in pw):
        raise ValueError("password must include a lowercase letter")
    if req_digit and not any(c.isdigit() for c in pw):
        raise ValueError("password must include a number")
    if req_special and not any((not c.isalnum()) for c in pw):
        raise ValueError("password must include a special character")


def revoke_token(*, user_id: int, jti: str, expires_at: datetime) -> None:
    session = _users_session()
    try:
        from database.models import RevokedToken
        jti = str(jti).strip()
        if not jti:
            return
        existing = session.query(RevokedToken).filter(RevokedToken.jti == jti).first()
        if existing:
            return
        rt = RevokedToken(
            user_id=int(user_id),
            jti=jti,
            revoked_at=datetime.now(timezone.utc).replace(tzinfo=None),
            expires_at=expires_at.replace(tzinfo=None),
        )
        session.add(rt)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def is_token_revoked(*, jti: str) -> bool:
    session = _users_session()
    try:
        from database.models import RevokedToken
        jti = str(jti).strip()
        if not jti:
            return False
        hit = session.query(RevokedToken).filter(RevokedToken.jti == jti).first()
        return hit is not None
    finally:
        session.close()


def normalize_instrument(instrument):
    """Normalize instrument input to InstrumentType enum.

    Accepts variants like: 'Stock', 'stock', 'Option', 'option'.
    Returns an `InstrumentType` member.
    """
    s = _normalize_str(instrument)
    if not s:
        return InstrumentType.STOCK
    s_up = s.upper()
    return InstrumentType.OPTION if s_up.startswith('OPT') else InstrumentType.STOCK


def normalize_action(action):
    """Normalize action input to Action enum.

    Accepts: 'Buy', 'BUY', 'buy', 'Sell', 'SELL', etc.
    """
    s = _normalize_str(action)
    if not s:
        return Action.BUY
    s_up = s.upper()
    return Action.BUY if s_up.startswith('B') else Action.SELL


def normalize_option_type(o_type):
    """Normalize option type to OptionType enum or None.

    Accepts: 'Call', 'CALL', 'Put', 'PUT', or None.
    """
    s = _normalize_str(o_type)
    if not s:
        return None
    s_up = s.upper()
    return OptionType.CALL if s_up.startswith('C') else OptionType.PUT


def normalize_cash_action(action):
    s = _normalize_str(action)
    if not s:
        return CashAction.DEPOSIT
    s_up = s.upper()
    return CashAction.DEPOSIT if s_up.startswith('D') else CashAction.WITHDRAW


def normalize_budget_type(b_type):
    s = _normalize_str(b_type)
    if not s:
        return BudgetType.EXPENSE
    s_up = s.upper()
    # Map common words to enums
    if 'INCOM' in s_up:
        return BudgetType.INCOME
    if 'ASSET' in s_up:
        return BudgetType.ASSET
    return BudgetType.EXPENSE


def _trades_create_filled_orders_enabled() -> bool:
    v = str(os.getenv("TRADES_CREATE_FILLED_ORDERS", "1") or "").strip().lower()
    return v not in {"0", "false", "no", "off"}


def _ensure_filled_order_for_trade(session, *, trade: Trade) -> None:
    """Best-effort: ensure a FILLED Order exists for this Trade.

    This is intentionally idempotent and should never block trade creation.
    """
    try:
        if trade is None or trade.user_id is None:
            return
        if trade.id is None:
            return

        coid = f"trade:{trade.client_order_id}" if trade.client_order_id else f"trade:{trade.id}"
        existing = (
            session.query(Order)
            .filter(Order.user_id == int(trade.user_id))
            .filter(Order.client_order_id == coid)
            .first()
        )
        if existing is not None:
            # Ensure it is linked.
            if existing.trade_id is None:
                existing.trade_id = int(trade.id)
                session.add(existing)
            return

        now = datetime.now(timezone.utc).replace(tzinfo=None)
        filled_at = getattr(trade, "entry_date", None) or now
        filled_price = getattr(trade, "entry_price", None)

        o = Order(
            user_id=int(trade.user_id),
            symbol=str(getattr(trade, "symbol", "") or "").upper(),
            instrument=getattr(trade, "instrument", None),
            action=getattr(trade, "action", None),
            strategy=str(getattr(trade, "strategy", "") or ""),
            quantity=int(getattr(trade, "quantity", 0) or 0),
            limit_price=None,
            status=OrderStatus.FILLED,
            created_at=filled_at,
            filled_at=filled_at,
            filled_price=float(filled_price) if filled_price is not None else None,
            trade_id=int(trade.id),
            client_order_id=coid,
        )
        session.add(o)
    except Exception:
        return

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
    """Return trades for a user with SQL-level pagination and optional filters."""
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
            inst_enum = normalize_instrument(instrument)
            q = q.filter(Trade.instrument == inst_enum)
        rows = (
            q
            .order_by(Trade.entry_date.desc())
            .offset(int(offset))
            .limit(int(limit))
            .all()
        )
        out: list[dict] = []
        for t in rows:
            out.append({
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
            })
        return out
    finally:
        session.close()


def get_trade(trade_id: int, *, user_id: int) -> dict | None:
    """Fetch a single trade by id. Returns None if not found or not owned by user."""
    session = get_session()
    try:
        t = (
            session.query(Trade)
            .filter(Trade.id == int(trade_id))
            .filter(Trade.user_id == int(user_id))
            .first()
        )
        if t is None:
            return None
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
    finally:
        session.close()


def save_trade(
    symbol,
    instrument,
    strategy,
    action,
    qty,
    price,
    date,
    o_type=None,
    strike=None,
    expiry=None,
    user_id=None,
    client_order_id=None,
    notes=None,
    account_id=None,
):
    session = get_session()
    try:
        inst_enum = normalize_instrument(instrument)
        act_enum = normalize_action(action)
        opt_enum = normalize_option_type(o_type)

        coid = None
        if client_order_id is not None:
            coid = str(client_order_id).strip() or None

        if coid and user_id is not None:
            existing = (
                session.query(Trade)
                .filter(Trade.user_id == int(user_id))
                .filter(Trade.client_order_id == coid)
                .first()
            )
            if existing:
                if _trades_create_filled_orders_enabled():
                    _ensure_filled_order_for_trade(session, trade=existing)
                    session.commit()
                return existing.id

        new_trade = Trade(
            symbol=str(symbol).upper(), quantity=int(qty), instrument=inst_enum, strategy=str(strategy),
            action=act_enum, entry_date=pd.to_datetime(date), entry_price=float(price),
            option_type=opt_enum, strike_price=float(strike) if strike else None,
            expiry_date=pd.to_datetime(expiry) if expiry else None,
            user_id=int(user_id) if user_id is not None else None,
            client_order_id=coid,
            notes=(str(notes)[:2000] if notes else None),
            account_id=(int(account_id) if account_id is not None else None),
        )
        session.add(new_trade)

        # Ensure the trade has an id before creating an Order row that references it.
        session.flush()

        # Auto-sync holdings for STOCK trades (best-effort). Uses a dedicated per-user account.
        try:
            if user_id is not None and inst_enum == InstrumentType.STOCK:
                signed_qty = _trade_signed_quantity(action=act_enum, quantity=int(qty))
                _apply_holding_delta(
                    session,
                    user_id=int(user_id),
                    symbol=str(symbol),
                    delta_qty=float(signed_qty),
                    price=float(price),
                )
        except Exception:
            # Never block trade creation if holdings sync fails.
            pass

        # Optional: create a FILLED Order record for the trade so Orders UI reflects trade submissions.
        if _trades_create_filled_orders_enabled():
            _ensure_filled_order_for_trade(session, trade=new_trade)

        session.commit()
        return new_trade.id
    except Exception as e:
        session.rollback()
        raise
    finally:
        session.close()

def save_cash(action, amount, date, notes, user_id=None) -> int:
    session = _budget_session()
    try:
        action_enum = normalize_cash_action(action)
        new_cash = CashFlow(
            action=action_enum,
            amount=float(amount), date=pd.to_datetime(date), notes=notes
        )
        if user_id is not None:
            new_cash.user_id = int(user_id)
        session.add(new_cash)
        session.flush()

        # Post to the double-entry ledger (cash only for now).
        if user_id is not None:
            try:
                eff = pd.to_datetime(date).to_pydatetime() if date is not None else None
            except Exception:
                eff = None
            _post_cash_ledger_entry(
                session,
                user_id=int(user_id),
                action=action_enum,
                amount=float(amount),
                effective_at=eff,
                notes=str(notes) if notes is not None else None,
                idempotency_key=f"cash_flow:{int(new_cash.id)}",
                source_type="cash_flow",
                source_id=int(new_cash.id),
                currency="USD",
            )

        session.commit()
        session.refresh(new_cash)
        return int(new_cash.id)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_cash_balance_ledger(*, user_id: int, currency: str = "USD") -> float:
    """Return cash balance derived from the ledger (cash-only MVP)."""
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
        rows = (
            session.query(LedgerLine.amount)
            .filter(LedgerLine.account_id == int(cash_acct.id))
            .all()
        )
        return float(sum(float(r[0] or 0.0) for r in rows))
    finally:
        session.close()


def get_cash_balance(*, user_id: int, currency: str = "USD") -> float:
    """Canonical cash balance for the product.

    Source of truth: double-entry ledger (cash-only for now).
    """
    return get_cash_balance_ledger(user_id=int(user_id), currency=str(currency or "USD"))


def list_ledger_entries(*, user_id: int, limit: int = 100, offset: int = 0) -> list[dict]:
    session = _budget_session()
    try:
        es = (
            session.query(LedgerEntry)
            .filter(LedgerEntry.user_id == int(user_id))
            .order_by(LedgerEntry.created_at.desc())
            .offset(int(offset))
            .limit(int(limit))
            .all()
        )
        out: list[dict] = []
        for e in es:
            lines = (
                session.query(LedgerLine, LedgerAccount)
                .join(LedgerAccount, LedgerAccount.id == LedgerLine.account_id)
                .filter(LedgerLine.entry_id == int(e.id))
                .all()
            )
            out.append(
                {
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
                }
            )
        return out
    finally:
        session.close()

def list_portfolio_snapshots(*, user_id: int, limit: int = 365, offset: int = 0) -> list[dict]:
    """Return portfolio value history snapshots for a user."""
    session = _portfolio_session()
    try:
        from database.models import PortfolioValueHistory
        rows = (
            session.query(PortfolioValueHistory)
            .filter(PortfolioValueHistory.user_id == int(user_id))
            .order_by(PortfolioValueHistory.snapshot_date.desc())
            .offset(int(offset))
            .limit(int(limit))
            .all()
        )
        return [
            {
                "id": int(r.id),
                "snapshot_date": r.snapshot_date,
                "total_value": (float(r.total_value) if r.total_value is not None else None),
                "cash": (float(r.cash) if r.cash is not None else None),
                "stock_value": (float(r.stock_value) if r.stock_value is not None else None),
                "options_value": (float(r.options_value) if r.options_value is not None else None),
                "realized_pnl": (float(r.realized_pnl) if r.realized_pnl is not None else None),
                "unrealized_pnl": (float(r.unrealized_pnl) if r.unrealized_pnl is not None else None),
                "notes": (str(r.notes) if r.notes else None),
                "created_at": r.created_at,
            }
            for r in rows
        ]
    finally:
        session.close()


def upsert_portfolio_snapshot(
    *,
    user_id: int,
    snapshot_date,
    total_value: float | None = None,
    cash: float | None = None,
    stock_value: float | None = None,
    options_value: float | None = None,
    realized_pnl: float | None = None,
    unrealized_pnl: float | None = None,
    notes: str | None = None,
) -> dict:
    """Insert or update a portfolio value history snapshot for a given date."""
    session = _portfolio_session()
    try:
        from database.models import PortfolioValueHistory
        snap_dt = pd.to_datetime(snapshot_date).to_pydatetime().replace(tzinfo=None) if snapshot_date is not None else None
        if snap_dt is None:
            raise ValueError("snapshot_date is required")
        # Normalize to midnight to match the unique index
        snap_dt = snap_dt.replace(hour=0, minute=0, second=0, microsecond=0)

        existing = (
            session.query(PortfolioValueHistory)
            .filter(PortfolioValueHistory.user_id == int(user_id))
            .filter(PortfolioValueHistory.snapshot_date == snap_dt)
            .first()
        )
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        if existing is None:
            row = PortfolioValueHistory(
                user_id=int(user_id),
                snapshot_date=snap_dt,
                total_value=(float(total_value) if total_value is not None else None),
                cash=(float(cash) if cash is not None else None),
                stock_value=(float(stock_value) if stock_value is not None else None),
                options_value=(float(options_value) if options_value is not None else None),
                realized_pnl=(float(realized_pnl) if realized_pnl is not None else None),
                unrealized_pnl=(float(unrealized_pnl) if unrealized_pnl is not None else None),
                notes=(str(notes)[:500] if notes else None),
                created_at=now,
            )
            session.add(row)
        else:
            row = existing
            if total_value is not None:
                row.total_value = float(total_value)
            if cash is not None:
                row.cash = float(cash)
            if stock_value is not None:
                row.stock_value = float(stock_value)
            if options_value is not None:
                row.options_value = float(options_value)
            if realized_pnl is not None:
                row.realized_pnl = float(realized_pnl)
            if unrealized_pnl is not None:
                row.unrealized_pnl = float(unrealized_pnl)
            if notes is not None:
                row.notes = str(notes)[:500]
            session.add(row)
        session.commit()
        session.refresh(row)
        return {
            "id": int(row.id),
            "snapshot_date": row.snapshot_date,
            "total_value": (float(row.total_value) if row.total_value is not None else None),
            "cash": (float(row.cash) if row.cash is not None else None),
            "stock_value": (float(row.stock_value) if row.stock_value is not None else None),
            "options_value": (float(row.options_value) if row.options_value is not None else None),
            "realized_pnl": (float(row.realized_pnl) if row.realized_pnl is not None else None),
            "unrealized_pnl": (float(row.unrealized_pnl) if row.unrealized_pnl is not None else None),
            "notes": (str(row.notes) if row.notes else None),
            "created_at": row.created_at,
        }
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def list_cash_flows(*, user_id: int, limit: int = 200, offset: int = 0) -> list[dict]:
    """Return cash flow rows for a user with SQL-level pagination."""
    session = _budget_session()
    try:
        rows = (
            session.query(CashFlow)
            .filter(CashFlow.user_id == int(user_id))
            .order_by(CashFlow.date.desc())
            .offset(int(offset))
            .limit(int(limit))
            .all()
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


def list_budget_entries(*, user_id: int, limit: int = 500, offset: int = 0) -> list[dict]:
    """Return budget rows for a user with SQL-level pagination."""
    session = _budget_session()
    try:
        rows = (
            session.query(Budget)
            .filter(Budget.user_id == int(user_id))
            .order_by(Budget.date.desc())
            .offset(int(offset))
            .limit(int(limit))
            .all()
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


def save_budget(category, b_type, amount, date, desc, user_id=None, entry_type=None, recurrence=None, merchant=None, active_until=None) -> int:
    session = _budget_session()
    try:
        type_enum = normalize_budget_type(b_type)

        new_item = Budget(
            category=str(category), type=type_enum, amount=float(amount),
            date=pd.to_datetime(date), description=str(desc),
            entry_type=entry_type, recurrence=recurrence,
            merchant=merchant or None,
            active_until=active_until or None,
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
            if k == 'type' and v is not None:
                v = normalize_budget_type(v)
            if k == 'date' and v is not None:
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


def list_budget_overrides(user_id: int):
    """Return all budget overrides for the user as a list of dicts."""
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
                "id": r.id,
                "budget_id": r.budget_id,
                "month_key": r.month_key,
                "amount": r.amount,
                "description": r.description,
            }
            for r in rows
        ]
    finally:
        session.close()


def upsert_budget_override(user_id: int, budget_id: int, month_key: str, amount: float, description: str = None):
    """Create or update an override for (budget_id, month_key). Returns the override id."""
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
        else:
            row = BudgetOverride(
                user_id=user_id,
                budget_id=budget_id,
                month_key=month_key,
                amount=float(amount),
                description=description,
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
    """Delete a specific override by id."""
    session = _budget_session()
    try:
        row = session.query(BudgetOverride).filter(
            BudgetOverride.id == override_id,
            BudgetOverride.user_id == user_id,
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
    """Cascade-delete all overrides for a budget entry (called when entry is deleted)."""
    session = _budget_session()
    try:
        session.query(BudgetOverride).filter(
            BudgetOverride.budget_id == budget_id,
            BudgetOverride.user_id == user_id,
        ).delete()
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def create_account(*, user_id: int, name: str, broker: str | None = None, currency: str = "USD") -> int:
    session = get_session()  # trades.db — Account is TradesBase
    try:
        nm = str(name or "").strip()
        if not nm:
            raise ValueError("account name is required")
        cur = str(currency or "USD").strip().upper() or "USD"
        acct = Account(
            user_id=int(user_id),
            name=nm,
            broker=(str(broker).strip() if broker else None),
            currency=cur,
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
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
    session = get_session()  # trades.db — Account is TradesBase
    try:
        rows = (
            session.query(Account)
            .filter(Account.user_id == int(user_id))
            .order_by(Account.created_at.desc())
            .all()
        )
        out: list[dict] = []
        for a in rows:
            out.append(
                {
                    "id": int(getattr(a, "id")),
                    "name": str(getattr(a, "name", "") or ""),
                    "broker": (str(getattr(a, "broker", "") or "") or None),
                    "currency": str(getattr(a, "currency", "") or "USD"),
                    "created_at": getattr(a, "created_at", None),
                }
            )
        return out
    finally:
        session.close()


def list_holdings(*, user_id: int, account_id: int) -> list[dict]:
    trades_session = get_session()    # Account is TradesBase (trades.db)
    portfolio_session = _portfolio_session()  # StockHolding is PortfolioBase (portfolio.db)
    try:
        # Ensure account belongs to user.
        acct = (
            trades_session.query(Account)
            .filter(Account.id == int(account_id))
            .filter(Account.user_id == int(user_id))
            .first()
        )
        if not acct:
            raise ValueError("account not found")

        rows = (
            portfolio_session.query(StockHolding)
            .filter(StockHolding.user_id == int(user_id))
            .filter(StockHolding.account_id == int(account_id))
            .order_by(StockHolding.symbol.asc())
            .all()
        )
        out: list[dict] = []
        for h in rows:
            out.append(
                {
                    "id": int(getattr(h, "id")),
                    "account_id": int(getattr(h, "account_id")),
                    "symbol": str(getattr(h, "symbol", "") or ""),
                    "quantity": float(getattr(h, "shares", 0.0) or 0.0),
                    "avg_cost": (float(getattr(h, "avg_cost", 0.0)) if getattr(h, "avg_cost", None) is not None else None),
                    "updated_at": getattr(h, "updated_at", None),
                }
            )
        return out
    finally:
        trades_session.close()
        portfolio_session.close()


def upsert_holding(
    *,
    user_id: int,
    account_id: int,
    symbol: str,
    quantity: float,
    avg_cost: float | None = None,
) -> dict:
    trades_session = get_session()    # Account is TradesBase (trades.db)
    portfolio_session = _portfolio_session()  # StockHolding is PortfolioBase (portfolio.db)
    try:
        sym = str(symbol or "").strip().upper()
        if not sym:
            raise ValueError("symbol is required")

        acct = (
            trades_session.query(Account)
            .filter(Account.id == int(account_id))
            .filter(Account.user_id == int(user_id))
            .first()
        )
        if not acct:
            raise ValueError("account not found")

        h = (
            portfolio_session.query(StockHolding)
            .filter(StockHolding.user_id == int(user_id))
            .filter(StockHolding.account_id == int(account_id))
            .filter(StockHolding.symbol == sym)
            .first()
        )
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        qty = float(quantity)
        cost = qty * (float(avg_cost) if avg_cost is not None else 0.0)
        if h is None:
            h = StockHolding(
                user_id=int(user_id),
                account_id=int(account_id),
                symbol=sym,
                shares=qty,
                cost_basis=cost,
                adjusted_cost_basis=cost,
                avg_cost=(float(avg_cost) if avg_cost is not None else None),
                updated_at=now,
            )
            portfolio_session.add(h)
            portfolio_session.commit()
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
    session = _portfolio_session()
    try:
        h = (
            session.query(StockHolding)
            .filter(StockHolding.id == int(holding_id))
            .filter(StockHolding.user_id == int(user_id))
            .first()
        )
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
def load_data(user_id=None):
    """Load trades, cash, budget. If `user_id` is provided, filter rows to that user."""
    try:
        # Trades come from trades.db; cash_flow and budget come from budget.db
        try:
            if engine is not None:
                _trades_engine = engine
                _budget_engine = engine
            else:
                _trades_engine = get_trades_engine()
                _budget_engine = get_budget_engine()
        except NameError:
            _trades_engine = get_trades_engine()
            _budget_engine = get_budget_engine()
        if user_id is None:
            trades = pd.read_sql("SELECT * FROM trades", _trades_engine)
            cash = pd.read_sql("SELECT * FROM cash_flow", _budget_engine)
            budget = pd.read_sql("SELECT * FROM budget", _budget_engine)
        else:
            trades = pd.read_sql("SELECT * FROM trades WHERE user_id = :uid", _trades_engine, params={"uid": int(user_id)})
            cash = pd.read_sql("SELECT * FROM cash_flow WHERE user_id = :uid", _budget_engine, params={"uid": int(user_id)})
            budget = pd.read_sql("SELECT * FROM budget WHERE user_id = :uid", _budget_engine, params={"uid": int(user_id)})

        if not trades.empty:
            trades['entry_date'] = pd.to_datetime(trades['entry_date'])
            if 'exit_date' in trades.columns:
                trades['exit_date'] = pd.to_datetime(trades['exit_date'], errors='coerce')
        if not cash.empty:
            cash['date'] = pd.to_datetime(cash['date'])
        if not budget.empty:
            budget['date'] = pd.to_datetime(budget['date'])

        return trades, cash, budget
    except Exception:
        return pd.DataFrame(), pd.DataFrame(), pd.DataFrame()


def close_trade(trade_id, exit_price, exit_date=None, user_id=None):
    """Close a single trade row by recording exit and realized P&L.

    Realized P&L convention:
    - BUY:  (exit - entry) * qty
    - SELL: (entry - exit) * qty
    """
    session = get_session()
    try:
        q = session.query(Trade).filter(Trade.id == int(trade_id))
        if user_id is not None:
            q = q.filter(Trade.user_id == int(user_id))
        trade = q.first()
        if not trade:
            return False

        if getattr(trade, 'is_closed', False) or getattr(trade, 'exit_price', None) is not None:
            # Already closed
            return False

        xp = float(exit_price)
        ed = pd.to_datetime(exit_date) if exit_date is not None else pd.to_datetime('today')

        qty = int(trade.quantity or 0)
        entry = float(trade.entry_price or 0.0)
        act = getattr(trade.action, 'value', str(trade.action))
        act_up = str(act).upper()

        if act_up == 'SELL':
            realized = (entry - xp) * qty
        else:
            realized = (xp - entry) * qty

        trade.exit_price = xp
        trade.exit_date = ed
        trade.realized_pnl = float(realized)
        trade.is_closed = True

        # Auto-sync holdings: closing a trade reduces/offsets the position.
        try:
            if user_id is not None and getattr(trade, "instrument", None) == InstrumentType.STOCK:
                signed_entry_qty = _trade_signed_quantity(action=trade.action, quantity=int(qty))
                _apply_holding_delta(
                    session,
                    user_id=int(user_id),
                    symbol=str(getattr(trade, "symbol", "")),
                    delta_qty=float(-signed_entry_qty),
                    price=float(xp),
                )
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
            # If the trade is still open, reverse its position impact.
            try:
                if (
                    user_id is not None
                    and getattr(trade_to_delete, "is_closed", False) is False
                    and getattr(trade_to_delete, "instrument", None) == InstrumentType.STOCK
                ):
                    signed_entry_qty = _trade_signed_quantity(
                        action=trade_to_delete.action,
                        quantity=int(getattr(trade_to_delete, "quantity", 0) or 0),
                    )
                    _apply_holding_delta(
                        session,
                        user_id=int(user_id),
                        symbol=str(getattr(trade_to_delete, "symbol", "")),
                        delta_qty=float(-signed_entry_qty),
                        price=float(getattr(trade_to_delete, "entry_price", 0.0) or 0.0),
                    )
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
            # Best-effort holdings sync for STOCK trades when editing an open trade.
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
                        _apply_holding_delta(
                            session,
                            user_id=int(user_id),
                            symbol=old_sym,
                            delta_qty=float(-old_signed),
                            price=float(getattr(trade, "entry_price", 0.0) or 0.0),
                        )
                        _apply_holding_delta(
                            session,
                            user_id=int(user_id),
                            symbol=new_sym,
                            delta_qty=float(new_signed),
                            price=float(price),
                        )
                    else:
                        delta = float(new_signed - old_signed)
                        if abs(delta) > 1e-12 and new_sym:
                            _apply_holding_delta(
                                session,
                                user_id=int(user_id),
                                symbol=new_sym,
                                delta_qty=float(delta),
                                price=float(price),
                            )
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


# ── Credit Card Weeksd: int, user_id: int) -> bool:
    """Delete a cash flow entry. Returns True if deleted, False if not found."""
    session = _budget_session()
    try:
        row = session.query(CashFlow).filter(
            CashFlow.id == int(cash_id),
            CashFlow.user_id == int(user_id),
        ).first()
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


def update_cash(cash_id: int, user_id: int, *, action: str | None = None, amount: float | None = None, date=None, notes: str | None = None) -> dict | None:
    """Update a cash flow entry. Returns the updated row dict or None if not found."""
    session = _budget_session()
    try:
        row = session.query(CashFlow).filter(
            CashFlow.id == int(cash_id),
            CashFlow.user_id == int(user_id),
        ).first()
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


def get_budget_summary(*, user_id: int) -> dict:
    """Return per-category and per-type totals for all budget entries."""
    session = _budget_session()
    try:
        rows = (
            session.query(Budget)
            .filter(Budget.user_id == int(user_id))
            .all()
        )
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


# ── Credit Card Weeks ─────────────────────────────────────────────────────────

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


def create_credit_card_week(user_id: int, week_start, balance: float, squared_off: bool = False,
                            paid_amount=None, note=None, card_name=None):
    session = _budget_session()
    try:
        row = CreditCardWeek(
            user_id=user_id,
            week_start=pd.to_datetime(week_start),
            card_name=str(card_name) if card_name else None,
            balance=float(balance),
            squared_off=bool(squared_off),
            paid_amount=float(paid_amount) if paid_amount is not None else None,
            note=str(note) if note else None,
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
            CreditCardWeek.id == row_id,
            CreditCardWeek.user_id == user_id,
        ).first()
        if not row:
            raise ValueError(f"CreditCardWeek {row_id} not found")
        for k, v in kwargs.items():
            if k == 'week_start' and v is not None:
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
            CreditCardWeek.id == row_id,
            CreditCardWeek.user_id == user_id,
        ).first()
        if row:
            session.delete(row)
            session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()