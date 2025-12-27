import pandas as pd
from sqlalchemy.orm import sessionmaker
from database.models import (
    Trade, CashFlow, Budget,
    InstrumentType, OptionType, Action, CashAction, BudgetType,
    get_engine
)

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
        u = session.query(User).filter(User.username == str(username)).first()
        if not u:
            return None
        # verify hash
        ok = pwd_context.verify(password, u.password_hash)
        return u.id if ok else None
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

def save_trade(symbol, instrument, strategy, action, qty, price, date, o_type=None, strike=None, expiry=None, user_id=None):
    session = get_session()
    try:
        inst_enum = normalize_instrument(instrument)
        act_enum = normalize_action(action)
        opt_enum = normalize_option_type(o_type)

        new_trade = Trade(
            symbol=str(symbol).upper(), quantity=int(qty), instrument=inst_enum, strategy=str(strategy),
            action=act_enum, entry_date=pd.to_datetime(date), entry_price=float(price),
            option_type=opt_enum, strike_price=float(strike) if strike else None,
            expiry_date=pd.to_datetime(expiry) if expiry else None,
            user_id=int(user_id) if user_id is not None else None
        )
        session.add(new_trade)
        session.commit()
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
        if not cash.empty:
            cash['date'] = pd.to_datetime(cash['date'])
        if not budget.empty:
            budget['date'] = pd.to_datetime(budget['date'])

        return trades, cash, budget
    except Exception:
        return pd.DataFrame(), pd.DataFrame(), pd.DataFrame()


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