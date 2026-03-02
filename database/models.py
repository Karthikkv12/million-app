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


class LedgerAccountType(enum.Enum):
    ASSET = "ASSET"
    LIABILITY = "LIABILITY"
    EQUITY = "EQUITY"
    INCOME = "INCOME"
    EXPENSE = "EXPENSE"


class LedgerEntryType(enum.Enum):
    CASH_DEPOSIT = "CASH_DEPOSIT"
    CASH_WITHDRAW = "CASH_WITHDRAW"


class OrderStatus(enum.Enum):
    PENDING = "PENDING"
    FILLED = "FILLED"
    CANCELLED = "CANCELLED"


class LedgerAccount(Base):
    __tablename__ = "ledger_accounts"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    name = Column(String, nullable=False)
    type = Column(Enum(LedgerAccountType), nullable=False, index=True)
    currency = Column(String, nullable=False, default="USD")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)


Index(
    "ux_ledger_accounts_user_name_currency",
    LedgerAccount.user_id,
    LedgerAccount.name,
    LedgerAccount.currency,
    unique=True,
)


class LedgerEntry(Base):
    __tablename__ = "ledger_entries"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    entry_type = Column(Enum(LedgerEntryType), nullable=False, index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    effective_at = Column(DateTime, nullable=True, index=True)
    description = Column(String, nullable=True)
    # Idempotency for safe retries.
    idempotency_key = Column(String, nullable=True)
    # Best-effort linkage to source record(s)
    source_type = Column(String, nullable=True, index=True)
    source_id = Column(Integer, nullable=True, index=True)


Index(
    "ux_ledger_entries_user_idempotency_key",
    LedgerEntry.user_id,
    LedgerEntry.idempotency_key,
    unique=True,
)


class LedgerLine(Base):
    __tablename__ = "ledger_lines"
    id = Column(Integer, primary_key=True)
    entry_id = Column(Integer, ForeignKey('ledger_entries.id'), nullable=False, index=True)
    account_id = Column(Integer, ForeignKey('ledger_accounts.id'), nullable=False, index=True)
    # Signed amount in the account currency.
    amount = Column(Float, nullable=False)
    memo = Column(String, nullable=True)

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
    entry_type = Column(String, nullable=True)   # FLOATING | RECURRING
    recurrence = Column(String, nullable=True)  # MONTHLY | SEMI_ANNUAL | ANNUAL
    amount = Column(Float)
    date = Column(DateTime)
    description = Column(String)
    merchant = Column(String, nullable=True)     # merchant / payee name (for one-off rows)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=True, index=True)


class CreditCardWeek(Base):
    """Tracks weekly Robinhood credit card balance and whether it was squared off by trading."""
    __tablename__ = 'credit_card_weeks'
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    week_start = Column(DateTime, nullable=False)   # Monday of the week
    card_name = Column(String, nullable=True)        # e.g. 'Robinhood Gold', 'Robinhood Cash'
    balance = Column(Float, nullable=False, default=0.0)
    squared_off = Column(Boolean, nullable=False, default=False)
    paid_amount = Column(Float, nullable=True)       # how much was paid from trading
    note = Column(String, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class BudgetOverride(Base):
    """Per-month override for a recurring budget entry.
    If a row exists here for (budget_id, month_key), use its amount instead of the base amount.
    month_key is a string like '2026-03'.
    """
    __tablename__ = 'budget_overrides'
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    budget_id = Column(Integer, ForeignKey('budget.id'), nullable=False, index=True)
    month_key = Column(String, nullable=False)   # 'YYYY-MM'
    amount = Column(Float, nullable=False)
    description = Column(String, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


Index(
    'ux_budget_overrides_user_budget_month',
    BudgetOverride.user_id,
    BudgetOverride.budget_id,
    BudgetOverride.month_key,
    unique=True,
)


class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True)
    username = Column(String, unique=True, index=True)
    password_hash = Column(String)
    salt = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    # Tokens with iat < auth_valid_after are invalid (logout-everywhere / password-change).
    auth_valid_after = Column(DateTime, nullable=False, default=_EPOCH_UTC_NAIVE)
    # Role: "admin" | "user"
    role = Column(String, nullable=False, default="user")
    # Soft-disable without deleting
    is_active = Column(Boolean, nullable=False, default=True)


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


class Order(Base):
    __tablename__ = "orders"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    symbol = Column(String, nullable=False, index=True)
    instrument = Column(Enum(InstrumentType), nullable=False)
    action = Column(Enum(Action), nullable=False)
    strategy = Column(String, nullable=True)
    quantity = Column(Integer, nullable=False)
    limit_price = Column(Float, nullable=True)
    status = Column(Enum(OrderStatus), nullable=False, default=OrderStatus.PENDING, index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    filled_at = Column(DateTime, nullable=True, index=True)
    filled_price = Column(Float, nullable=True)
    trade_id = Column(Integer, ForeignKey('trades.id'), nullable=True, index=True)
    # Brokerage foundation: client-generated idempotency key (UUID) per user.
    client_order_id = Column(String, nullable=True)

    # External OMS linkage (rentable OMS adapters)
    external_order_id = Column(String, nullable=True, index=True)
    venue = Column(String, nullable=True, index=True)
    external_status = Column(String, nullable=True, index=True)
    last_synced_at = Column(DateTime, nullable=True, index=True)


Index(
    "ux_orders_user_client_order_id",
    Order.user_id,
    Order.client_order_id,
    unique=True,
)


class OrderEvent(Base):
    __tablename__ = "order_events"
    id = Column(Integer, primary_key=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    order_id = Column(Integer, ForeignKey('orders.id'), nullable=False, index=True)
    # Append-only event type: CREATED, SUBMITTED, SYNCED, CANCELLED, FILLED, etc.
    event_type = Column(String, nullable=False, index=True)
    # Snapshot fields for convenience/debugging.
    order_status = Column(String, nullable=True, index=True)
    external_status = Column(String, nullable=True, index=True)
    note = Column(String, nullable=True)


Index(
    "ix_order_events_user_order_created_at",
    OrderEvent.user_id,
    OrderEvent.order_id,
    OrderEvent.created_at,
)


# ── Weekly Options Portfolio ──────────────────────────────────────────────────

class OptionPositionStatus(enum.Enum):
    ACTIVE   = "ACTIVE"    # still open, carries forward each week
    CLOSED   = "CLOSED"    # bought back before expiry
    EXPIRED  = "EXPIRED"   # expired worthless — full premium kept
    ASSIGNED = "ASSIGNED"  # put assigned → stock acquired
    ROLLED   = "ROLLED"    # this leg closed; new_position_id points to replacement


class WeeklySnapshot(Base):
    """One row per Friday.  Created when user opens a new week or marks one complete."""
    __tablename__ = "weekly_snapshots"
    id             = Column(Integer, primary_key=True)
    user_id        = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    week_start     = Column(DateTime, nullable=False, index=True)   # Monday 00:00 UTC
    week_end       = Column(DateTime, nullable=False, index=True)   # Friday 23:59 UTC
    account_value  = Column(Float, nullable=True)                   # Friday close — manual entry
    is_complete    = Column(Boolean, nullable=False, default=False, index=True)
    completed_at   = Column(DateTime, nullable=True)
    notes          = Column(String, nullable=True)
    created_at     = Column(DateTime, nullable=False, default=datetime.utcnow)


Index(
    "ux_weekly_snapshots_user_week_end",
    WeeklySnapshot.user_id,
    WeeklySnapshot.week_end,
    unique=True,
)


class OptionPosition(Base):
    """One row per option leg (one sell-to-open).  Active positions are carried
    forward automatically when a week is marked complete."""
    __tablename__ = "option_positions"
    id               = Column(Integer, primary_key=True)
    user_id          = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    week_id          = Column(Integer, ForeignKey('weekly_snapshots.id'), nullable=False, index=True)
    symbol           = Column(String, nullable=False, index=True)
    contracts        = Column(Integer, nullable=False, default=1)
    strike           = Column(Float, nullable=False)
    option_type      = Column(String, nullable=False)               # "CALL" | "PUT"
    sold_date        = Column(DateTime, nullable=True)
    buy_date         = Column(DateTime, nullable=True)              # close / buy-back date
    expiry_date      = Column(DateTime, nullable=True, index=True)
    premium_in       = Column(Float, nullable=True)                 # credit received (positive)
    premium_out      = Column(Float, nullable=True)                 # debit paid to close / roll (negative stored as-is)
    is_roll          = Column(Boolean, nullable=False, default=False)
    # Lifecycle
    status           = Column(Enum(OptionPositionStatus), nullable=False,
                               default=OptionPositionStatus.ACTIVE, index=True)
    # If rolled: points to the new leg that replaced this one
    rolled_to_id     = Column(Integer, ForeignKey('option_positions.id'), nullable=True)
    # If carried forward from a prior week's position
    carried_from_id  = Column(Integer, ForeignKey('option_positions.id'), nullable=True)
    # Linked stock holding lot (optional — for CC/CSP tracking against a specific lot)
    holding_id       = Column(Integer, ForeignKey('stock_holdings.id'), nullable=True, index=True)
    # Margin used (manual entry)
    margin           = Column(Float, nullable=True)
    notes            = Column(String, nullable=True)
    created_at       = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at       = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class HoldingEventType(enum.Enum):
    CC_EXPIRED   = "CC_EXPIRED"    # CC expired worthless → cost basis reduced
    CC_ASSIGNED  = "CC_ASSIGNED"   # CC assigned → shares called away, realized gain recorded
    CSP_ASSIGNED = "CSP_ASSIGNED"  # CSP assigned → cash converts to shares, basis blended
    MANUAL       = "MANUAL"        # Manual adjustment


class StockHolding(Base):
    """A stock lot held by the user.  One row per lot (separately tracked)."""
    __tablename__ = "stock_holdings"
    id                   = Column(Integer, primary_key=True)
    user_id              = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    symbol               = Column(String, nullable=False, index=True)
    company_name         = Column(String, nullable=True)                   # full company name from ticker search
    shares               = Column(Float, nullable=False)                   # current shares (auto-decrements on CC assignment)
    cost_basis           = Column(Float, nullable=False)                   # original per-share cost (never changes)
    adjusted_cost_basis  = Column(Float, nullable=False)                   # reduces as CC premiums expire worthless
    acquired_date        = Column(DateTime, nullable=True)
    status               = Column(String, nullable=False, default="ACTIVE", index=True)  # ACTIVE | CLOSED
    notes                = Column(String, nullable=True)
    created_at           = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at           = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class HoldingEvent(Base):
    """Audit log of every automatic change to a StockHolding (basis reductions, share changes)."""
    __tablename__ = "holding_events"
    id                  = Column(Integer, primary_key=True)
    user_id             = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    holding_id          = Column(Integer, ForeignKey('stock_holdings.id'), nullable=False, index=True)
    position_id         = Column(Integer, ForeignKey('option_positions.id'), nullable=True, index=True)
    event_type          = Column(Enum(HoldingEventType), nullable=False, index=True)
    shares_delta        = Column(Float, nullable=True)     # +/- shares change
    basis_delta         = Column(Float, nullable=True)     # per-share basis change (negative = reduction)
    realized_gain       = Column(Float, nullable=True)     # for CC_ASSIGNED events
    description         = Column(String, nullable=True)
    created_at          = Column(DateTime, nullable=False, default=datetime.utcnow)


class PremiumLedger(Base):
    """
    One row per (holding × option_position) pair.

    Captures the full premium story for every option sold against a holding:
      - premium_sold:      total credit received when the position was opened
                           (premium_in × contracts × 100)
      - realized_premium:  portion that has been locked in (position CLOSED/EXPIRED/ASSIGNED).
                           For a fully closed position = premium_sold (net of any buyback debit).
                           For a partially rolled position = net credit on the closed leg.
      - unrealized_premium: portion still in-flight (ACTIVE positions).
                           = premium_sold when status is ACTIVE, 0 once realized.
      - status:            mirrors OptionPosition.status (ACTIVE / CLOSED / EXPIRED / ASSIGNED / ROLLED)

    adj_basis (stored) = cost_basis - SUM(realized_premium) / shares
    live_adj_basis     = adj_basis  - SUM(unrealized_premium) / shares
    """
    __tablename__ = "premium_ledger"

    id                  = Column(Integer, primary_key=True)
    user_id             = Column(Integer, ForeignKey("users.id"),            nullable=False, index=True)
    holding_id          = Column(Integer, ForeignKey("stock_holdings.id"),   nullable=False, index=True)
    position_id         = Column(Integer, ForeignKey("option_positions.id"), nullable=False, index=True)
    symbol              = Column(String,  nullable=False, index=True)
    week_id             = Column(Integer, ForeignKey("weekly_snapshots.id"), nullable=True,  index=True)
    option_type         = Column(String,  nullable=False)           # CALL | PUT
    strike              = Column(Float,   nullable=False)
    contracts           = Column(Integer, nullable=False, default=1)
    expiry_date         = Column(DateTime, nullable=True)
    # Premium amounts (total dollar value, not per-share)
    premium_sold        = Column(Float,   nullable=False, default=0.0)  # credit when opened
    realized_premium    = Column(Float,   nullable=False, default=0.0)  # locked-in (closed/expired)
    unrealized_premium  = Column(Float,   nullable=False, default=0.0)  # still in-flight (active)
    # Position status snapshot
    status              = Column(String,  nullable=False, default="ACTIVE", index=True)
    notes               = Column(String,  nullable=True)
    created_at          = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at          = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


Index(
    "ux_premium_ledger_holding_position",
    PremiumLedger.holding_id,
    PremiumLedger.position_id,
    unique=True,
)


class StockAssignment(Base):
    """Tracks stock acquired via put assignment, plus any additional buys.
    Computes upside / downside breakeven automatically."""
    __tablename__ = "stock_assignments"
    id                    = Column(Integer, primary_key=True)
    user_id               = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    position_id           = Column(Integer, ForeignKey('option_positions.id'), nullable=False, index=True)
    symbol                = Column(String, nullable=False, index=True)
    # Initial assignment
    shares_acquired       = Column(Integer, nullable=False)
    acquisition_price     = Column(Float, nullable=False)           # price per share at assignment
    # Additional buys (average down / up) stored as JSON string: [{shares, price}, ...]
    additional_buys       = Column(String, nullable=True)
    # Covered calls sold against this stock position (reduces cost basis)
    # Stored as JSON: [{contracts, strike, premium, sold_date, status}, ...]
    covered_calls         = Column(String, nullable=True)
    # Net premium collected from options on this symbol (reduces cost basis)
    net_option_premium    = Column(Float, nullable=True, default=0.0)
    notes                 = Column(String, nullable=True)
    created_at            = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at            = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

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

        def _safe_execute(conn, stmt: str) -> None:
            try:
                conn.execute(text(stmt))
            except Exception:
                # Best-effort: ignore DDL failures (e.g., existing dupes preventing unique indexes).
                return

        def _add_columns(table: str, columns: list[tuple[str, str]]) -> None:
            if table not in tables:
                return
            existing_cols = {c["name"] for c in insp.get_columns(table)}
            to_add = [(n, d) for (n, d) in columns if n not in existing_cols]
            if not to_add:
                return
            with engine.begin() as conn:
                for col_name, col_def in to_add:
                    try:
                        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_def}"))
                    except Exception:
                        continue

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
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_trades_user_id ON trades(user_id)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_cash_flow_user_id ON cash_flow(user_id)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_budget_user_id ON budget(user_id)")
            # Allow multiple NULL client_order_id values; ensures idempotency when provided.
            _safe_execute(
                conn,
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_trades_user_client_order_id ON trades(user_id, client_order_id)",
            )

        # users: auth validity cutoff
        _add_columns("users", [("auth_valid_after", "DATETIME")])

        # refresh_tokens: new table (best-effort)
        with engine.begin() as conn:
            _safe_execute(
                conn,
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
                """.strip(),
            )
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_refresh_tokens_user_id ON refresh_tokens(user_id)")
            _safe_execute(conn, "CREATE UNIQUE INDEX IF NOT EXISTS ux_refresh_tokens_token_hash ON refresh_tokens(token_hash)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_refresh_tokens_expires_at ON refresh_tokens(expires_at)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_refresh_tokens_created_ip ON refresh_tokens(created_ip)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_refresh_tokens_last_used_at ON refresh_tokens(last_used_at)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_refresh_tokens_last_used_ip ON refresh_tokens(last_used_ip)")

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
            _safe_execute(
                conn,
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
                """.strip(),
            )
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_holdings_user_id ON holdings(user_id)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_holdings_account_id ON holdings(account_id)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_holdings_symbol ON holdings(symbol)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_holdings_updated_at ON holdings(updated_at)")
            _safe_execute(
                conn,
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_holdings_user_account_symbol ON holdings(user_id, account_id, symbol)",
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

        # orders: new table (best-effort)
        with engine.begin() as conn:
            _safe_execute(
                conn,
                """
                CREATE TABLE IF NOT EXISTS orders (
                    id INTEGER PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    symbol TEXT NOT NULL,
                    instrument TEXT NOT NULL,
                    action TEXT NOT NULL,
                    strategy TEXT,
                    quantity INTEGER NOT NULL,
                    limit_price REAL,
                    status TEXT NOT NULL,
                    created_at DATETIME NOT NULL,
                    filled_at DATETIME,
                    filled_price REAL,
                    trade_id INTEGER,
                    client_order_id TEXT,
                    external_order_id TEXT,
                    venue TEXT,
                    external_status TEXT,
                    last_synced_at DATETIME
                )
                """.strip(),
            )
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_orders_user_id ON orders(user_id)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_orders_symbol ON orders(symbol)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_orders_status ON orders(status)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_orders_created_at ON orders(created_at)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_orders_filled_at ON orders(filled_at)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_orders_trade_id ON orders(trade_id)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_orders_external_order_id ON orders(external_order_id)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_orders_venue ON orders(venue)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_orders_external_status ON orders(external_status)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_orders_last_synced_at ON orders(last_synced_at)")
            # Allow multiple NULL client_order_id values; ensures idempotency when provided.
            _safe_execute(conn, "CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_user_client_order_id ON orders(user_id, client_order_id)")

        _add_columns(
            "orders",
            [
                ("user_id", "INTEGER"),
                ("symbol", "TEXT"),
                ("instrument", "TEXT"),
                ("action", "TEXT"),
                ("strategy", "TEXT"),
                ("quantity", "INTEGER"),
                ("limit_price", "REAL"),
                ("status", "TEXT"),
                ("created_at", "DATETIME"),
                ("filled_at", "DATETIME"),
                ("filled_price", "REAL"),
                ("trade_id", "INTEGER"),
                ("client_order_id", "TEXT"),
                ("external_order_id", "TEXT"),
                ("venue", "TEXT"),
                ("external_status", "TEXT"),
                ("last_synced_at", "DATETIME"),
            ],
        )

        # ── Weekly Options Portfolio ──────────────────────────────────────
        with engine.begin() as conn:
            _safe_execute(
                conn,
                """
                CREATE TABLE IF NOT EXISTS weekly_snapshots (
                    id INTEGER PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    week_start DATETIME NOT NULL,
                    week_end DATETIME NOT NULL,
                    account_value REAL,
                    is_complete INTEGER NOT NULL DEFAULT 0,
                    completed_at DATETIME,
                    notes TEXT,
                    created_at DATETIME NOT NULL
                )
                """.strip(),
            )
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_weekly_snapshots_user_id ON weekly_snapshots(user_id)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_weekly_snapshots_week_start ON weekly_snapshots(week_start)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_weekly_snapshots_week_end ON weekly_snapshots(week_end)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_weekly_snapshots_is_complete ON weekly_snapshots(is_complete)")
            _safe_execute(conn, "CREATE UNIQUE INDEX IF NOT EXISTS ux_weekly_snapshots_user_week_end ON weekly_snapshots(user_id, week_end)")

        with engine.begin() as conn:
            _safe_execute(
                conn,
                """
                CREATE TABLE IF NOT EXISTS option_positions (
                    id INTEGER PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    week_id INTEGER NOT NULL,
                    symbol TEXT NOT NULL,
                    contracts INTEGER NOT NULL DEFAULT 1,
                    strike REAL NOT NULL,
                    option_type TEXT NOT NULL,
                    sold_date DATETIME,
                    buy_date DATETIME,
                    expiry_date DATETIME,
                    premium_in REAL,
                    premium_out REAL,
                    is_roll INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'ACTIVE',
                    rolled_to_id INTEGER,
                    carried_from_id INTEGER,
                    margin REAL,
                    notes TEXT,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                )
                """.strip(),
            )
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_option_positions_user_id ON option_positions(user_id)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_option_positions_week_id ON option_positions(week_id)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_option_positions_symbol ON option_positions(symbol)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_option_positions_status ON option_positions(status)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_option_positions_expiry_date ON option_positions(expiry_date)")

        with engine.begin() as conn:
            _safe_execute(
                conn,
                """
                CREATE TABLE IF NOT EXISTS stock_assignments (
                    id INTEGER PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    position_id INTEGER NOT NULL,
                    symbol TEXT NOT NULL,
                    shares_acquired INTEGER NOT NULL,
                    acquisition_price REAL NOT NULL,
                    additional_buys TEXT,
                    covered_calls TEXT,
                    net_option_premium REAL DEFAULT 0,
                    notes TEXT,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                )
                """.strip(),
            )
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_stock_assignments_user_id ON stock_assignments(user_id)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_stock_assignments_position_id ON stock_assignments(position_id)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_stock_assignments_symbol ON stock_assignments(symbol)")

        # stock_holdings: new table (best-effort)
        with engine.begin() as conn:
            _safe_execute(
                conn,
                """
                CREATE TABLE IF NOT EXISTS stock_holdings (
                    id INTEGER PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    symbol TEXT NOT NULL,
                    company_name TEXT,
                    shares REAL NOT NULL,
                    cost_basis REAL NOT NULL,
                    adjusted_cost_basis REAL NOT NULL,
                    acquired_date DATETIME,
                    status TEXT NOT NULL DEFAULT 'ACTIVE',
                    notes TEXT,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                )
                """.strip(),
            )
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_stock_holdings_user_id ON stock_holdings(user_id)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_stock_holdings_symbol ON stock_holdings(symbol)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_stock_holdings_status ON stock_holdings(status)")

        # holding_events: audit log table (best-effort)
        with engine.begin() as conn:
            _safe_execute(
                conn,
                """
                CREATE TABLE IF NOT EXISTS holding_events (
                    id INTEGER PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    holding_id INTEGER NOT NULL,
                    position_id INTEGER,
                    event_type TEXT NOT NULL,
                    shares_delta REAL,
                    basis_delta REAL,
                    realized_gain REAL,
                    description TEXT,
                    created_at DATETIME NOT NULL
                )
                """.strip(),
            )
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_holding_events_user_id ON holding_events(user_id)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_holding_events_holding_id ON holding_events(holding_id)")
            _safe_execute(conn, "CREATE INDEX IF NOT EXISTS ix_holding_events_position_id ON holding_events(position_id)")

        # holding_id column on option_positions
        _add_columns("option_positions", [("holding_id", "INTEGER")])
        # company_name column on stock_holdings (for existing DBs)
        _add_columns("stock_holdings", [("company_name", "TEXT")])
    except Exception:
        # Best-effort: never break app startup due to migration helpers.
        return