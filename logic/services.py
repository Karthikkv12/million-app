import pandas as pd
from datetime import datetime, timezone
from datetime import timedelta
from sqlalchemy.orm import sessionmaker
from database.models import (
    Trade, CashFlow, Budget,
    InstrumentType, OptionType, Action, CashAction, BudgetType,
    get_engine
)


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
        session.commit()
    except Exception:
        session.rollback()
        raise
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