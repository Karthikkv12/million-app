from __future__ import annotations

import os
from functools import lru_cache

from sqlalchemy import Boolean, Column, DateTime, Enum, Float, ForeignKey, Index, Integer, String, create_engine, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import declarative_base
from sqlalchemy.pool import NullPool
import enum
from datetime import datetime
from datetime import timedelta


_EPOCH_UTC_NAIVE = datetime(1970, 1, 1)

Base = declarative_base()

# --- ENUMS ---
class InstrumentType(enum.Enum):
    STOCK = "STOCK"
    OPTION = "OPTION"

class Action(enum.Enum):
    BUY = "BUY"
    SELL = "SELL"

class OptionType(enum.Enum):
    CALL = "CALL"
    PUT = "PUT"

class CashAction(enum.Enum):
    DEPOSIT = "DEPOSIT"
    WITHDRAW = "WITHDRAW"

class BudgetType(enum.Enum):
    EXPENSE = "EXPENSE"
    INCOME = "INCOME"
    ASSET = "ASSET"

# --- TABLES ---
class Trade(Base):
    __tablename__ = 'trades'
    id = Column(Integer, primary_key=True)
    symbol = Column(String)
    quantity = Column(Integer)
    instrument = Column(Enum(InstrumentType))
    strategy = Column(String)
    action = Column(Enum(Action))
    entry_date = Column(DateTime)
    entry_price = Column(Float)
    # Position lifecycle
    is_closed = Column(Boolean, default=False)
    exit_date = Column(DateTime, nullable=True)
    exit_price = Column(Float, nullable=True)
    realized_pnl = Column(Float, nullable=True)
    option_type = Column(Enum(OptionType), nullable=True)
    strike_price = Column(Float, nullable=True)
    expiry_date = Column(DateTime, nullable=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=True, index=True)
    # Brokerage foundation: idempotent order submission (client generated UUID).
    client_order_id = Column(String, nullable=True)


Index(
    "ux_trades_user_client_order_id",
    Trade.user_id,
    Trade.client_order_id,
    unique=True,
)

class CashFlow(Base):
    __tablename__ = 'cash_flow'
    id = Column(Integer, primary_key=True)
    action = Column(Enum(CashAction))
    amount = Column(Float)
    date = Column(DateTime)
    notes = Column(String)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=True, index=True)

class Budget(Base):
    __tablename__ = 'budget'
    id = Column(Integer, primary_key=True)
    category = Column(String)
    type = Column(Enum(BudgetType))
    amount = Column(Float)
    date = Column(DateTime)
    description = Column(String)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=True, index=True)


class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True)
    username = Column(String, unique=True, index=True)
    password_hash = Column(String)
    salt = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    # Tokens with iat < auth_valid_after are invalid (logout-everywhere / password-change).
    auth_valid_after = Column(DateTime, nullable=False, default=_EPOCH_UTC_NAIVE)


class RevokedToken(Base):
    __tablename__ = "revoked_tokens"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    jti = Column(String, nullable=False, unique=True, index=True)
    revoked_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False, index=True)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    token_hash = Column(String, nullable=False, unique=True, index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    created_ip = Column(String, nullable=True, index=True)
    created_user_agent = Column(String, nullable=True)
    last_used_at = Column(DateTime, nullable=True, index=True)
    last_used_ip = Column(String, nullable=True, index=True)
    last_used_user_agent = Column(String, nullable=True)
    expires_at = Column(DateTime, nullable=False, index=True)
    revoked_at = Column(DateTime, nullable=True)
    revoked_reason = Column(String, nullable=True)
    replaced_by_token_id = Column(Integer, nullable=True)


class AuthEvent(Base):
    __tablename__ = "auth_events"
    id = Column(Integer, primary_key=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    event_type = Column(String, nullable=False, index=True)
    success = Column(Boolean, nullable=False, default=False, index=True)
    username = Column(String, nullable=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=True, index=True)
    ip = Column(String, nullable=True, index=True)
    user_agent = Column(String, nullable=True)
    detail = Column(String, nullable=True)


class Account(Base):
    __tablename__ = "accounts"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    name = Column(String, nullable=False)
    broker = Column(String, nullable=True)
    currency = Column(String, nullable=False, default="USD")
    created_at = Column(DateTime, default=datetime.utcnow)


class Holding(Base):
    __tablename__ = "holdings"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    account_id = Column(Integer, ForeignKey('accounts.id'), nullable=False, index=True)
    symbol = Column(String, nullable=False, index=True)
    quantity = Column(Float, nullable=False, default=0.0)
    avg_cost = Column(Float, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, index=True)


Index(
    "ux_holdings_user_account_symbol",
    Holding.user_id,
    Holding.account_id,
    Holding.symbol,
    unique=True,
)

# Database Connection Setup
@lru_cache(maxsize=1)
def get_engine() -> Engine:
    url = os.getenv("DATABASE_URL", "sqlite:///trading_journal.db")

    if url.startswith("sqlite"):
        # Use NullPool for sqlite to avoid cross-thread pooling issues in dev.
        return create_engine(
            url,
            connect_args={"check_same_thread": False},
            poolclass=NullPool,
        )

    # Postgres / MySQL / etc.
    pool_size = int(os.getenv("DB_POOL_SIZE", "5"))
    max_overflow = int(os.getenv("DB_MAX_OVERFLOW", "10"))
    pool_timeout = int(os.getenv("DB_POOL_TIMEOUT", "30"))

    return create_engine(
        url,
        pool_pre_ping=True,
        pool_size=pool_size,
        max_overflow=max_overflow,
        pool_timeout=pool_timeout,
    )


def reset_engine_cache() -> None:
    """Clear cached engine (useful for tests)."""
    get_engine.cache_clear()

def init_db():
    engine = get_engine()
    url = os.getenv("DATABASE_URL", "sqlite:///trading_journal.db")
    auto_default = "1" if url.startswith("sqlite") else "0"
    auto_create = os.getenv("AUTO_CREATE_DB", auto_default)
    if str(auto_create).strip() in {"1", "true", "TRUE", "yes", "YES"}:
        Base.metadata.create_all(engine)

    # Ensure backwards-compatible schema upgrades for local SQLite DBs.
    if url.startswith("sqlite"):
        _ensure_sqlite_schema(engine)
    return engine


def _ensure_sqlite_schema(engine: Engine) -> None:
    """Best-effort schema upgrades for existing SQLite DBs.

    Streamlit dev environments often rely on `create_all()`, which won't ALTER existing
    tables. This keeps upgrades automatic and safe.
    """
    try:
        insp = inspect(engine)
        tables = set(insp.get_table_names())

        def _add_columns(table: str, columns: list[tuple[str, str]]) -> None:
            if table not in tables:
                return
            existing_cols = {c["name"] for c in insp.get_columns(table)}
            to_add = [(n, d) for (n, d) in columns if n not in existing_cols]
            if not to_add:
                return
            with engine.begin() as conn:
                for col_name, col_def in to_add:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_def}"))

        # trades: per-user + close lifecycle
        _add_columns(
            "trades",
            [
                ("user_id", "INTEGER"),
                ("is_closed", "INTEGER DEFAULT 0"),
                ("exit_date", "DATETIME"),
                ("exit_price", "REAL"),
                ("realized_pnl", "REAL"),
                ("client_order_id", "TEXT"),
            ],
        )

        # cash_flow/budget: per-user
        _add_columns("cash_flow", [("user_id", "INTEGER")])
        _add_columns("budget", [("user_id", "INTEGER")])

        # Add indexes if missing (safe no-op if already exists)
        with engine.begin() as conn:
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_trades_user_id ON trades(user_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_cash_flow_user_id ON cash_flow(user_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_budget_user_id ON budget(user_id)"))
            # Allow multiple NULL client_order_id values; ensures idempotency when provided.
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS ux_trades_user_client_order_id ON trades(user_id, client_order_id)"
                )
            )

        # users: auth validity cutoff
        _add_columns("users", [("auth_valid_after", "DATETIME")])

        # refresh_tokens: new table (best-effort)
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS refresh_tokens (
                        id INTEGER PRIMARY KEY,
                        user_id INTEGER NOT NULL,
                        token_hash TEXT NOT NULL,
                        created_at DATETIME NOT NULL,
                        created_ip TEXT,
                        created_user_agent TEXT,
                        last_used_at DATETIME,
                        last_used_ip TEXT,
                        last_used_user_agent TEXT,
                        expires_at DATETIME NOT NULL,
                        revoked_at DATETIME,
                        revoked_reason TEXT,
                        replaced_by_token_id INTEGER
                    )
                    """
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_refresh_tokens_user_id ON refresh_tokens(user_id)"))
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ux_refresh_tokens_token_hash ON refresh_tokens(token_hash)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_refresh_tokens_expires_at ON refresh_tokens(expires_at)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_refresh_tokens_created_ip ON refresh_tokens(created_ip)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_refresh_tokens_last_used_at ON refresh_tokens(last_used_at)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_refresh_tokens_last_used_ip ON refresh_tokens(last_used_ip)"))

        _add_columns(
            "refresh_tokens",
            [
                ("created_ip", "TEXT"),
                ("created_user_agent", "TEXT"),
                ("last_used_at", "DATETIME"),
                ("last_used_ip", "TEXT"),
                ("last_used_user_agent", "TEXT"),
                ("revoked_reason", "TEXT"),
            ],
        )

        # auth_events: new table (best-effort)
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS auth_events (
                        id INTEGER PRIMARY KEY,
                        created_at DATETIME NOT NULL,
                        event_type TEXT NOT NULL,
                        success INTEGER NOT NULL DEFAULT 0,
                        username TEXT,
                        user_id INTEGER,
                        ip TEXT,
                        user_agent TEXT,
                        detail TEXT
                    )
                    """
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_auth_events_created_at ON auth_events(created_at)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_auth_events_event_type ON auth_events(event_type)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_auth_events_success ON auth_events(success)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_auth_events_username ON auth_events(username)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_auth_events_user_id ON auth_events(user_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_auth_events_ip ON auth_events(ip)"))

        # accounts: new table (best-effort)
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS accounts (
                        id INTEGER PRIMARY KEY,
                        user_id INTEGER NOT NULL,
                        name TEXT NOT NULL,
                        broker TEXT,
                        currency TEXT NOT NULL DEFAULT 'USD',
                        created_at DATETIME
                    )
                    """
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_accounts_user_id ON accounts(user_id)"))

        _add_columns(
            "accounts",
            [
                ("user_id", "INTEGER"),
                ("name", "TEXT"),
                ("broker", "TEXT"),
                ("currency", "TEXT DEFAULT 'USD'"),
                ("created_at", "DATETIME"),
            ],
        )

        # holdings: new table (best-effort)
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS holdings (
                        id INTEGER PRIMARY KEY,
                        user_id INTEGER NOT NULL,
                        account_id INTEGER NOT NULL,
                        symbol TEXT NOT NULL,
                        quantity REAL NOT NULL DEFAULT 0,
                        avg_cost REAL,
                        updated_at DATETIME
                    )
                    """
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_holdings_user_id ON holdings(user_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_holdings_account_id ON holdings(account_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_holdings_symbol ON holdings(symbol)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_holdings_updated_at ON holdings(updated_at)"))
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS ux_holdings_user_account_symbol ON holdings(user_id, account_id, symbol)"
                )
            )

        _add_columns(
            "holdings",
            [
                ("user_id", "INTEGER"),
                ("account_id", "INTEGER"),
                ("symbol", "TEXT"),
                ("quantity", "REAL DEFAULT 0"),
                ("avg_cost", "REAL"),
                ("updated_at", "DATETIME"),
            ],
        )
    except Exception:
        # Best-effort: never break app startup due to migration helpers.
        return