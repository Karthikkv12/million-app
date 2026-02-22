import pandas as pd
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timezone
from datetime import timedelta
from sqlalchemy.orm import sessionmaker

from brokers import broker_enabled as _broker_enabled
from brokers import get_broker
from brokers.base import SubmitOrderRequest
from database.models import (
    Trade, CashFlow, Budget,
    Order,
    Account, Holding,
    InstrumentType, OptionType, Action, CashAction, BudgetType,
    OrderStatus,
    LedgerAccount, LedgerAccountType,
    LedgerEntry, LedgerEntryType,
    LedgerLine,
    get_engine
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
        session.query(Holding)
        .filter(Holding.user_id == int(user_id))
        .filter(Holding.account_id == int(acct.id))
        .filter(Holding.symbol == sym)
        .first()
    )
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if h is None:
        h = Holding(
            user_id=int(user_id),
            account_id=int(acct.id),
            symbol=sym,
            quantity=0.0,
            avg_cost=None,
            updated_at=now,
        )
        session.add(h)
        session.flush()

    old_qty = float(getattr(h, "quantity", 0.0) or 0.0)
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

    h.quantity = float(new_qty)
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


def list_orders(*, user_id: int, limit: int = 100) -> list[dict]:
    session = get_session()
    try:
        rows = (
            session.query(Order)
            .filter(Order.user_id == int(user_id))
            .order_by(Order.created_at.desc())
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
    """Create a new SQLAlchemy Session bound to the engine returned by get_engine()."""
    # Allow tests (or other callers) to monkeypatch `logic.services.engine`.
    # If `engine` is set at module level, prefer it; otherwise create via get_engine().
    try:
        # module-level 'engine' may be set to a test engine by tests
        if engine is not None:
            _engine = engine
        else:
            _engine = get_engine()
    except NameError:
        _engine = get_engine()
    Session = sessionmaker(bind=_engine)
    return Session()

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
    session = get_session()
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
    session = get_session()
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
    session = get_session()
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
    session = get_session()
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
    session = get_session()
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
    session = get_session()
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
    session = get_session()
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
    session = get_session()
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
    session = get_session()
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
    session = get_session()
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
    session = get_session()
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


def create_user(username, password):
    session = get_session()
    try:
        username = str(username).strip()
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
        # Hash using passlib
        ph = pwd_context.hash(password)
        user = User(username=username, password_hash=ph, salt=None)
        session.add(user)
        session.commit()
        # return created user id
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
    session = get_session()
    try:
        from database.models import User
        uname = str(username).strip()
        u = session.query(User).filter(User.username == uname).first()
        if not u:
            return None
        # verify hash
        ok = pwd_context.verify(password, u.password_hash)
        return u.id if ok else None
    finally:
        session.close()


def get_user(user_id: int):
    session = get_session()
    try:
        from database.models import User
        return session.query(User).filter(User.id == int(user_id)).first()
    finally:
        session.close()


def set_auth_valid_after_epoch(*, user_id: int, epoch_seconds: int) -> None:
    session = get_session()
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
    session = get_session()
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
    session = get_session()
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
    session = get_session()
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

def save_cash(action, amount, date, notes, user_id=None):
    session = get_session()
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
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_cash_balance_ledger(*, user_id: int, currency: str = "USD") -> float:
    """Return cash balance derived from the ledger (cash-only MVP)."""
    session = get_session()
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


def list_ledger_entries(*, user_id: int, limit: int = 100) -> list[dict]:
    session = get_session()
    try:
        es = (
            session.query(LedgerEntry)
            .filter(LedgerEntry.user_id == int(user_id))
            .order_by(LedgerEntry.created_at.desc())
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

def save_budget(category, b_type, amount, date, desc, user_id=None):
    session = get_session()
    try:
        type_enum = normalize_budget_type(b_type)

        new_item = Budget(
            category=str(category), type=type_enum, amount=float(amount),
            date=pd.to_datetime(date), description=str(desc)
        )
        if user_id is not None:
            new_item.user_id = int(user_id)
        session.add(new_item)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def create_account(*, user_id: int, name: str, broker: str | None = None, currency: str = "USD") -> int:
    session = get_session()
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
    session = get_session()
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
    session = get_session()
    try:
        # Ensure account belongs to user.
        acct = (
            session.query(Account)
            .filter(Account.id == int(account_id))
            .filter(Account.user_id == int(user_id))
            .first()
        )
        if not acct:
            raise ValueError("account not found")

        rows = (
            session.query(Holding)
            .filter(Holding.user_id == int(user_id))
            .filter(Holding.account_id == int(account_id))
            .order_by(Holding.symbol.asc())
            .all()
        )
        out: list[dict] = []
        for h in rows:
            out.append(
                {
                    "id": int(getattr(h, "id")),
                    "account_id": int(getattr(h, "account_id")),
                    "symbol": str(getattr(h, "symbol", "") or ""),
                    "quantity": float(getattr(h, "quantity", 0.0) or 0.0),
                    "avg_cost": (float(getattr(h, "avg_cost", 0.0)) if getattr(h, "avg_cost", None) is not None else None),
                    "updated_at": getattr(h, "updated_at", None),
                }
            )
        return out
    finally:
        session.close()


def upsert_holding(
    *,
    user_id: int,
    account_id: int,
    symbol: str,
    quantity: float,
    avg_cost: float | None = None,
) -> dict:
    session = get_session()
    try:
        sym = str(symbol or "").strip().upper()
        if not sym:
            raise ValueError("symbol is required")

        acct = (
            session.query(Account)
            .filter(Account.id == int(account_id))
            .filter(Account.user_id == int(user_id))
            .first()
        )
        if not acct:
            raise ValueError("account not found")

        h = (
            session.query(Holding)
            .filter(Holding.user_id == int(user_id))
            .filter(Holding.account_id == int(account_id))
            .filter(Holding.symbol == sym)
            .first()
        )
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        if h is None:
            h = Holding(
                user_id=int(user_id),
                account_id=int(account_id),
                symbol=sym,
                quantity=float(quantity),
                avg_cost=(float(avg_cost) if avg_cost is not None else None),
                updated_at=now,
            )
            session.add(h)
            session.commit()
        else:
            h.quantity = float(quantity)
            h.avg_cost = (float(avg_cost) if avg_cost is not None else None)
            h.updated_at = now
            session.add(h)
            session.commit()

        return {
            "id": int(getattr(h, "id")),
            "account_id": int(getattr(h, "account_id")),
            "symbol": str(getattr(h, "symbol", "") or ""),
            "quantity": float(getattr(h, "quantity", 0.0) or 0.0),
            "avg_cost": (float(getattr(h, "avg_cost", 0.0)) if getattr(h, "avg_cost", None) is not None else None),
            "updated_at": getattr(h, "updated_at", None),
        }
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def delete_holding(*, user_id: int, holding_id: int) -> bool:
    session = get_session()
    try:
        h = (
            session.query(Holding)
            .filter(Holding.id == int(holding_id))
            .filter(Holding.user_id == int(user_id))
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
        # Prefer an overridden module-level engine (tests set this). Otherwise use configured engine.
        try:
            if engine is not None:
                _engine = engine
            else:
                _engine = get_engine()
        except NameError:
            _engine = get_engine()
        if user_id is None:
            trades = pd.read_sql("SELECT * FROM trades", _engine)
            cash = pd.read_sql("SELECT * FROM cash_flow", _engine)
            budget = pd.read_sql("SELECT * FROM budget", _engine)
        else:
            trades = pd.read_sql("SELECT * FROM trades WHERE user_id = :uid", _engine, params={"uid": int(user_id)})
            cash = pd.read_sql("SELECT * FROM cash_flow WHERE user_id = :uid", _engine, params={"uid": int(user_id)})
            budget = pd.read_sql("SELECT * FROM budget WHERE user_id = :uid", _engine, params={"uid": int(user_id)})

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
        print(f"Error closing trade: {e}")
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
        print(f"Error deleting trade: {e}")
        return False
    finally:
        session.close()


def update_trade(trade_id, symbol, strategy, action, qty, price, date, user_id=None):
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
            session.commit()
            return True
        return False
    except Exception as e:
        session.rollback()
        print(f"Error updating trade: {e}")
        return False
    finally:
        session.close()