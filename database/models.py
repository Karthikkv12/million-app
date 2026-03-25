"""
database/models.py — Multi-database / multi-schema architecture for OptionFlow.

SQLite mode  (default, local dev & tests):
  Five separate .db files, no schemas, everything works as before.

PostgreSQL mode  (set DATABASE_URL=postgresql://... in environment):
  Single Postgres instance with five logical schemas:
    auth      — authentication & user management
    trades    — trade journal, orders, brokerage accounts
    portfolio — stock holdings, option positions, premium ledger, weekly snapshots
    budget    — budget, credit card weeks, cash flows, double-entry ledger
    markets   — market data, GEX/options-flow snapshots, price history

  All five domains share one connection pool.  Domain isolation is preserved
  via schemas rather than separate files.

The dialect switch is fully transparent to all business logic — session helpers,
engine getters, and the test monkeypatch fixtures all work identically in both
modes.
"""
from __future__ import annotations

import os
from functools import lru_cache

from sqlalchemy import (
    Boolean, Column, Date, DateTime, Enum, Float,
    Index, Integer, String, Text, create_engine,
    MetaData,
)
from sqlalchemy.engine import Engine
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.pool import NullPool
import enum
from datetime import datetime

_EPOCH_UTC_NAIVE = datetime(1970, 1, 1)

# ── Dialect helpers ────────────────────────────────────────────────────────────

def _is_postgres() -> bool:
    """Return True when a PostgreSQL DATABASE_URL is configured."""
    url = os.getenv("DATABASE_URL", "")
    return url.startswith("postgresql") or url.startswith("postgres")


def _schema(name: str) -> str | None:
    """Return the schema name for Postgres, or None for SQLite.

    SQLAlchemy treats schema=None as 'no schema' and generates plain
    CREATE TABLE statements — safe for SQLite and in-memory test engines.
    """
    return name if _is_postgres() else None


# ── Named metadata objects — carry the schema for Postgres DDL ─────────────
# We bind schema at MetaData level so Alembic's autogenerate sees it, and also
# set it per-table via __table_args__ so individual queries resolve correctly.

UsersBase     = declarative_base(metadata=MetaData(schema=_schema("auth")))
TradesBase    = declarative_base(metadata=MetaData(schema=_schema("trades")))
PortfolioBase = declarative_base(metadata=MetaData(schema=_schema("portfolio")))
BudgetBase    = declarative_base(metadata=MetaData(schema=_schema("budget")))
MarketsBase   = declarative_base(metadata=MetaData(schema=_schema("markets")))

# ── Enums ─────────────────────────────────────────────────────────────────────

class CashAction(enum.Enum):
    DEPOSIT  = "DEPOSIT"
    WITHDRAW = "WITHDRAW"

class BudgetType(enum.Enum):
    EXPENSE = "EXPENSE"
    INCOME  = "INCOME"
    ASSET   = "ASSET"

class LedgerAccountType(enum.Enum):
    ASSET     = "ASSET"
    LIABILITY = "LIABILITY"
    EQUITY    = "EQUITY"
    INCOME    = "INCOME"
    EXPENSE   = "EXPENSE"

class LedgerEntryType(enum.Enum):
    CASH_DEPOSIT  = "CASH_DEPOSIT"
    CASH_WITHDRAW = "CASH_WITHDRAW"

class OptionPositionStatus(enum.Enum):
    ACTIVE   = "ACTIVE"
    CLOSED   = "CLOSED"
    EXPIRED  = "EXPIRED"
    ASSIGNED = "ASSIGNED"
    ROLLED   = "ROLLED"

class HoldingEventType(enum.Enum):
    CC_EXPIRED   = "CC_EXPIRED"
    CC_ASSIGNED  = "CC_ASSIGNED"
    CSP_ASSIGNED = "CSP_ASSIGNED"
    MANUAL       = "MANUAL"

# ═══════════════════════════════════════════════════════════════════════════════
# USERS DATABASE  (users.db)
# ═══════════════════════════════════════════════════════════════════════════════

class User(UsersBase):
    __tablename__ = "users"
    __table_args__ = {"schema": _schema("auth")}
    id               = Column(Integer, primary_key=True)
    username         = Column(String, unique=True, index=True, nullable=False)
    password_hash    = Column(String, nullable=False)
    salt             = Column(String, nullable=True)
    created_at       = Column(DateTime, nullable=False, default=datetime.utcnow)
    auth_valid_after = Column(DateTime, nullable=False, default=_EPOCH_UTC_NAIVE)
    role             = Column(String, nullable=False, default="user")
    is_active        = Column(Boolean, nullable=False, default=True)

class RefreshToken(UsersBase):
    __tablename__ = "refresh_tokens"
    __table_args__ = {"schema": _schema("auth")}
    id                   = Column(Integer, primary_key=True)
    user_id              = Column(Integer, nullable=False, index=True)
    token_hash           = Column(String, nullable=False, unique=True, index=True)
    created_at           = Column(DateTime, nullable=False, default=datetime.utcnow)
    created_ip           = Column(String, nullable=True, index=True)
    created_user_agent   = Column(String, nullable=True)
    last_used_at         = Column(DateTime, nullable=True, index=True)
    last_used_ip         = Column(String, nullable=True, index=True)
    last_used_user_agent = Column(String, nullable=True)
    expires_at           = Column(DateTime, nullable=False, index=True)
    revoked_at           = Column(DateTime, nullable=True)
    revoked_reason       = Column(String, nullable=True)
    replaced_by_token_id = Column(Integer, nullable=True)

class RevokedToken(UsersBase):
    __tablename__ = "revoked_tokens"
    __table_args__ = {"schema": _schema("auth")}
    id         = Column(Integer, primary_key=True)
    user_id    = Column(Integer, nullable=False, index=True)
    jti        = Column(String, nullable=False, unique=True, index=True)
    revoked_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False, index=True)

class AuthEvent(UsersBase):
    __tablename__ = "auth_events"
    __table_args__ = {"schema": _schema("auth")}
    id         = Column(Integer, primary_key=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    event_type = Column(String, nullable=False, index=True)
    success    = Column(Boolean, nullable=False, default=False, index=True)
    username   = Column(String, nullable=True, index=True)
    user_id    = Column(Integer, nullable=True, index=True)
    ip         = Column(String, nullable=True, index=True)
    user_agent = Column(String, nullable=True)
    detail     = Column(String, nullable=True)

# ═══════════════════════════════════════════════════════════════════════════════
# TRADES DATABASE  (trades.db)
# ═══════════════════════════════════════════════════════════════════════════════

class Account(TradesBase):
    __tablename__ = "accounts"
    __table_args__ = {"schema": _schema("trades")}
    id         = Column(Integer, primary_key=True)
    user_id    = Column(Integer, nullable=False, index=True)
    name       = Column(String, nullable=False)
    broker     = Column(String, nullable=True)
    currency   = Column(String, nullable=False, default="USD")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

# ═══════════════════════════════════════════════════════════════════════════════
# PORTFOLIO DATABASE  (portfolio.db)
# ═══════════════════════════════════════════════════════════════════════════════

class StockHolding(PortfolioBase):
    """Merged replacement for old `holdings` + `stock_holdings` tables."""
    __tablename__ = "stock_holdings"
    __table_args__ = {"schema": _schema("portfolio")}
    id                  = Column(Integer, primary_key=True)
    user_id             = Column(Integer, nullable=False, index=True)
    account_id          = Column(Integer, nullable=True, index=True)
    symbol              = Column(String, nullable=False, index=True)
    company_name        = Column(String, nullable=True)
    shares              = Column(Float, nullable=False)
    cost_basis          = Column(Float, nullable=False)
    adjusted_cost_basis = Column(Float, nullable=False)
    avg_cost            = Column(Float, nullable=True)
    acquired_date       = Column(DateTime, nullable=True)
    status              = Column(String, nullable=False, default="ACTIVE", index=True)
    notes               = Column(Text, nullable=True)
    created_at          = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at          = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

class HoldingEvent(PortfolioBase):
    __tablename__ = "holding_events"
    __table_args__ = {"schema": _schema("portfolio")}
    id            = Column(Integer, primary_key=True)
    user_id       = Column(Integer, nullable=False, index=True)
    holding_id    = Column(Integer, nullable=False, index=True)
    position_id   = Column(Integer, nullable=True, index=True)
    event_type    = Column(Enum(HoldingEventType), nullable=False, index=True)
    shares_delta  = Column(Float, nullable=True)
    basis_delta   = Column(Float, nullable=True)
    realized_gain = Column(Float, nullable=True)
    description   = Column(String, nullable=True)
    created_at    = Column(DateTime, nullable=False, default=datetime.utcnow)

class WeeklySnapshot(PortfolioBase):
    __tablename__ = "weekly_snapshots"
    __table_args__ = {"schema": _schema("portfolio")}
    id            = Column(Integer, primary_key=True)
    user_id       = Column(Integer, nullable=False, index=True)
    week_start    = Column(DateTime, nullable=False, index=True)
    week_end      = Column(DateTime, nullable=False, index=True)
    account_value = Column(Float, nullable=True)   # auto-computed sum of acct_val_1+2+3
    acct_label_1  = Column(String, nullable=True)
    acct_val_1    = Column(Float, nullable=True)
    acct_label_2  = Column(String, nullable=True)
    acct_val_2    = Column(Float, nullable=True)
    acct_label_3  = Column(String, nullable=True)
    acct_val_3    = Column(Float, nullable=True)
    is_complete   = Column(Boolean, nullable=False, default=False, index=True)
    completed_at  = Column(DateTime, nullable=True)
    notes         = Column(Text, nullable=True)
    created_at    = Column(DateTime, nullable=False, default=datetime.utcnow)

Index("ux_weekly_snapshots_user_week_end", WeeklySnapshot.user_id, WeeklySnapshot.week_end, unique=True)


class BrokerAccount(PortfolioBase):
    __tablename__ = "broker_accounts"
    __table_args__ = {"schema": _schema("portfolio")}
    id         = Column(Integer, primary_key=True)
    user_id    = Column(Integer, nullable=False, index=True)
    name       = Column(String, nullable=False)
    color      = Column(String, nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    is_active  = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class AccountBalance(PortfolioBase):
    __tablename__ = "account_balances"
    __table_args__ = (
        Index("ux_account_balances_acct_week", "account_id", "week_date", unique=True),
        {"schema": _schema("portfolio")},
    )
    id         = Column(Integer, primary_key=True)
    user_id    = Column(Integer, nullable=False, index=True)
    account_id = Column(Integer, nullable=False, index=True)
    week_date  = Column(Date, nullable=False, index=True)
    balance    = Column(Float, nullable=False)

class OptionPosition(PortfolioBase):
    __tablename__ = "option_positions"
    __table_args__ = {"schema": _schema("portfolio")}
    id              = Column(Integer, primary_key=True)
    user_id         = Column(Integer, nullable=False, index=True)
    week_id         = Column(Integer, nullable=False, index=True)
    holding_id      = Column(Integer, nullable=True, index=True)
    symbol          = Column(String, nullable=False, index=True)
    contracts       = Column(Integer, nullable=False, default=1)
    strike          = Column(Float, nullable=False)
    option_type     = Column(String, nullable=False)
    sold_date       = Column(DateTime, nullable=True)
    buy_date        = Column(DateTime, nullable=True)
    expiry_date     = Column(DateTime, nullable=True, index=True)
    premium_in      = Column(Float, nullable=True)
    premium_out     = Column(Float, nullable=True)
    spot_price      = Column(Float, nullable=True)
    is_roll         = Column(Boolean, nullable=False, default=False)
    status          = Column(Enum(OptionPositionStatus), nullable=False, default=OptionPositionStatus.ACTIVE, index=True)
    rolled_to_id    = Column(Integer, nullable=True)
    carried_from_id = Column(Integer, nullable=True)
    margin          = Column(Float, nullable=True)
    notes           = Column(Text, nullable=True)
    created_at      = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at      = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

class PremiumLedger(PortfolioBase):
    __tablename__ = "premium_ledger"
    __table_args__ = {"schema": _schema("portfolio")}
    id                 = Column(Integer, primary_key=True)
    user_id            = Column(Integer, nullable=False, index=True)
    holding_id         = Column(Integer, nullable=False, index=True)
    position_id        = Column(Integer, nullable=False, index=True)
    symbol             = Column(String, nullable=False, index=True)
    week_id            = Column(Integer, nullable=True, index=True)
    option_type        = Column(String, nullable=False)
    strike             = Column(Float, nullable=False)
    contracts          = Column(Integer, nullable=False, default=1)
    expiry_date        = Column(DateTime, nullable=True)
    premium_sold       = Column(Float, nullable=False, default=0.0)
    realized_premium   = Column(Float, nullable=False, default=0.0)
    unrealized_premium = Column(Float, nullable=False, default=0.0)
    status             = Column(String, nullable=False, default="ACTIVE", index=True)
    notes              = Column(Text, nullable=True)
    created_at         = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at         = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

Index("ux_premium_ledger_holding_position", PremiumLedger.holding_id, PremiumLedger.position_id, unique=True)

class StockAssignment(PortfolioBase):
    __tablename__ = "stock_assignments"
    __table_args__ = {"schema": _schema("portfolio")}
    id                 = Column(Integer, primary_key=True)
    user_id            = Column(Integer, nullable=False, index=True)
    position_id        = Column(Integer, nullable=False, index=True)
    symbol             = Column(String, nullable=False, index=True)
    shares_acquired    = Column(Integer, nullable=False)
    acquisition_price  = Column(Float, nullable=False)
    additional_buys    = Column(Text, nullable=True)
    covered_calls      = Column(Text, nullable=True)
    net_option_premium = Column(Float, nullable=True, default=0.0)
    notes              = Column(Text, nullable=True)
    created_at         = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at         = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

class PortfolioValueHistory(PortfolioBase):
    """Daily net-worth snapshot — new table, ensures we never lose portfolio history again."""
    __tablename__ = "portfolio_value_history"
    __table_args__ = {"schema": _schema("portfolio")}
    id             = Column(Integer, primary_key=True)
    user_id        = Column(Integer, nullable=False, index=True)
    snapshot_date  = Column(DateTime, nullable=False, index=True)
    total_value    = Column(Float, nullable=True)
    cash           = Column(Float, nullable=True)
    stock_value    = Column(Float, nullable=True)
    options_value  = Column(Float, nullable=True)
    realized_pnl   = Column(Float, nullable=True)
    unrealized_pnl = Column(Float, nullable=True)
    notes          = Column(Text, nullable=True)
    created_at     = Column(DateTime, nullable=False, default=datetime.utcnow)

Index("ux_portfolio_value_history_user_date", PortfolioValueHistory.user_id, PortfolioValueHistory.snapshot_date, unique=True)

# ═══════════════════════════════════════════════════════════════════════════════
# BUDGET DATABASE  (budget.db)
# ═══════════════════════════════════════════════════════════════════════════════

class Budget(BudgetBase):
    __tablename__ = "budget"
    __table_args__ = {"schema": _schema("budget")}
    id           = Column(Integer, primary_key=True)
    user_id      = Column(Integer, nullable=False, index=True)
    category     = Column(String, nullable=True)
    type         = Column(Enum(BudgetType), nullable=True)
    entry_type   = Column(String, nullable=True)
    recurrence   = Column(String, nullable=True)
    amount       = Column(Float, nullable=False)
    date         = Column(DateTime, nullable=True)
    description  = Column(String, nullable=True)
    merchant     = Column(String, nullable=True)
    active_until = Column(String, nullable=True)
    created_at   = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at   = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

class BudgetOverride(BudgetBase):
    __tablename__ = "budget_overrides"
    __table_args__ = {"schema": _schema("budget")}
    id          = Column(Integer, primary_key=True)
    user_id     = Column(Integer, nullable=False, index=True)
    budget_id   = Column(Integer, nullable=False, index=True)
    month_key   = Column(String, nullable=False)
    amount      = Column(Float, nullable=False)
    description = Column(String, nullable=True)
    created_at  = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at  = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

Index("ux_budget_overrides_user_budget_month", BudgetOverride.user_id, BudgetOverride.budget_id, BudgetOverride.month_key, unique=True)

class CreditCardWeek(BudgetBase):
    __tablename__ = "credit_card_weeks"
    __table_args__ = {"schema": _schema("budget")}
    id          = Column(Integer, primary_key=True)
    user_id     = Column(Integer, nullable=False, index=True)
    week_start  = Column(DateTime, nullable=False)
    card_name   = Column(String, nullable=True)
    balance     = Column(Float, nullable=False, default=0.0)
    squared_off = Column(Boolean, nullable=False, default=False)
    paid_amount = Column(Float, nullable=True)
    note        = Column(String, nullable=True)
    created_at  = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at  = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

class CashFlow(BudgetBase):
    __tablename__ = "cash_flow"
    __table_args__ = {"schema": _schema("budget")}
    id      = Column(Integer, primary_key=True)
    user_id = Column(Integer, nullable=False, index=True)
    action  = Column(Enum(CashAction), nullable=False)
    amount  = Column(Float, nullable=False)
    date    = Column(DateTime, nullable=False)
    notes   = Column(String, nullable=True)

class LedgerAccount(BudgetBase):
    __tablename__ = "ledger_accounts"
    __table_args__ = {"schema": _schema("budget")}
    id         = Column(Integer, primary_key=True)
    user_id    = Column(Integer, nullable=False, index=True)
    name       = Column(String, nullable=False)
    type       = Column(Enum(LedgerAccountType), nullable=False, index=True)
    currency   = Column(String, nullable=False, default="USD")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)

Index("ux_ledger_accounts_user_name_currency", LedgerAccount.user_id, LedgerAccount.name, LedgerAccount.currency, unique=True)

class LedgerEntry(BudgetBase):
    __tablename__ = "ledger_entries"
    __table_args__ = {"schema": _schema("budget")}
    id              = Column(Integer, primary_key=True)
    user_id         = Column(Integer, nullable=False, index=True)
    entry_type      = Column(Enum(LedgerEntryType), nullable=False, index=True)
    created_at      = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    effective_at    = Column(DateTime, nullable=True, index=True)
    description     = Column(String, nullable=True)
    idempotency_key = Column(String, nullable=True)
    source_type     = Column(String, nullable=True, index=True)
    source_id       = Column(Integer, nullable=True, index=True)

Index("ux_ledger_entries_user_idempotency_key", LedgerEntry.user_id, LedgerEntry.idempotency_key, unique=True)

class LedgerLine(BudgetBase):
    __tablename__ = "ledger_lines"
    __table_args__ = {"schema": _schema("budget")}
    id         = Column(Integer, primary_key=True)
    entry_id   = Column(Integer, nullable=False, index=True)
    account_id = Column(Integer, nullable=False, index=True)
    amount     = Column(Float, nullable=False)
    memo       = Column(String, nullable=True)

# ═══════════════════════════════════════════════════════════════════════════════
# MARKETS DATABASE  (markets.db)
# ═══════════════════════════════════════════════════════════════════════════════

class NetFlowSnapshot(MarketsBase):
    __tablename__ = "net_flow_snapshots"
    __table_args__ = {"schema": _schema("markets")}
    id         = Column(Integer, primary_key=True)
    symbol     = Column(String, nullable=False, index=True)
    ts         = Column(String, nullable=False, index=True)
    price      = Column(Float, nullable=True)
    call_prem  = Column(Float, nullable=True)
    put_prem   = Column(Float, nullable=True)
    net_flow   = Column(Float, nullable=True)
    total_prem = Column(Float, nullable=True)
    volume     = Column(Integer, nullable=True)

class PriceSnapshot(MarketsBase):
    __tablename__ = "price_snapshots"
    __table_args__ = {"schema": _schema("markets")}
    id         = Column(Integer, primary_key=True)
    symbol     = Column(String, nullable=False, index=True)
    date       = Column(DateTime, nullable=False, index=True)
    open       = Column(Float, nullable=True)
    high       = Column(Float, nullable=True)
    low        = Column(Float, nullable=True)
    close      = Column(Float, nullable=False)
    volume     = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

Index("ux_price_snapshots_symbol_date", PriceSnapshot.symbol, PriceSnapshot.date, unique=True)

# ═══════════════════════════════════════════════════════════════════════════════
# ENGINE FACTORY
# ═══════════════════════════════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════════════════════════════
# ENGINE FACTORY
# ═══════════════════════════════════════════════════════════════════════════════

def _db_path(filename: str) -> str:
    """Return a SQLite URL for the given filename, respecting DB_DIR and per-db overrides."""
    env_key  = f"DATABASE_URL_{filename.upper().replace('.DB','').replace('-','_')}"
    override = os.getenv(env_key)
    if override:
        return override
    base = os.getenv("DB_DIR", ".")
    return f"sqlite:///{base}/{filename}"


def _make_engine(url: str) -> Engine:
    if url.startswith("sqlite"):
        return create_engine(url, connect_args={"check_same_thread": False}, poolclass=NullPool)
    return create_engine(
        url,
        pool_pre_ping=True,
        pool_size=int(os.getenv("DB_POOL_SIZE", "5")),
        max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "10")),
        pool_timeout=int(os.getenv("DB_POOL_TIMEOUT", "30")),
    )


def _postgres_url() -> str:
    """Return the single shared Postgres URL (DATABASE_URL env var)."""
    return os.environ["DATABASE_URL"]


@lru_cache(maxsize=1)
def get_users_engine() -> Engine:
    if _is_postgres():
        return _make_engine(_postgres_url())
    return _make_engine(_db_path("users.db"))

@lru_cache(maxsize=1)
def get_trades_engine() -> Engine:
    if _is_postgres():
        return _make_engine(_postgres_url())
    return _make_engine(_db_path("trades.db"))

@lru_cache(maxsize=1)
def get_portfolio_engine() -> Engine:
    if _is_postgres():
        return _make_engine(_postgres_url())
    return _make_engine(_db_path("portfolio.db"))

@lru_cache(maxsize=1)
def get_budget_engine() -> Engine:
    if _is_postgres():
        return _make_engine(_postgres_url())
    return _make_engine(_db_path("budget.db"))

@lru_cache(maxsize=1)
def get_markets_engine() -> Engine:
    if _is_postgres():
        return _make_engine(_postgres_url())
    return _make_engine(_db_path("markets.db"))

# Legacy alias — points to trades.db for backwards compat
def get_engine() -> Engine:
    return get_trades_engine()


# ── Session factories ──────────────────────────────────────────────────────────

def get_users_session():
    return sessionmaker(bind=get_users_engine())()

def get_trades_session():
    return sessionmaker(bind=get_trades_engine())()

def get_portfolio_session():
    return sessionmaker(bind=get_portfolio_engine())()

def get_budget_session():
    return sessionmaker(bind=get_budget_engine())()

def get_markets_session():
    return sessionmaker(bind=get_markets_engine())()

def reset_engine_cache() -> None:
    get_users_engine.cache_clear()
    get_trades_engine.cache_clear()
    get_portfolio_engine.cache_clear()
    get_budget_engine.cache_clear()
    get_markets_engine.cache_clear()

# ═══════════════════════════════════════════════════════════════════════════════
# INIT
# ═══════════════════════════════════════════════════════════════════════════════

def init_db():
    """Create all tables across all five domains. Safe to call multiple times.

    In Postgres mode, also creates the logical schemas (auth, trades, portfolio,
    budget, markets) if they don't already exist, then runs CREATE TABLE IF NOT
    EXISTS for every model — all on the shared engine.
    """
    if _is_postgres():
        eng = get_users_engine()  # all engines point to the same URL
        from sqlalchemy import text
        with eng.connect() as conn:
            for schema in ("auth", "trades", "portfolio", "budget", "markets"):
                conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))
            conn.commit()
        for base in (UsersBase, TradesBase, PortfolioBase, BudgetBase, MarketsBase):
            base.metadata.create_all(eng)
    else:
        UsersBase.metadata.create_all(get_users_engine())
        TradesBase.metadata.create_all(get_trades_engine())
        PortfolioBase.metadata.create_all(get_portfolio_engine())
        BudgetBase.metadata.create_all(get_budget_engine())
        MarketsBase.metadata.create_all(get_markets_engine())
