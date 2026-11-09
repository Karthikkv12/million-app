"""
database/models.py — every table in OptionFlow's one database.

One declarative Base, real foreign keys (enforced on SQLite by
optionflow/core/db.py), and ON DELETE rules that match the app:
  - a user who owns data can't be deleted (RESTRICT); deactivate instead.
    Their login tokens go with them; auth events keep the record, unlinked.
  - deleting a position deletes its assignment and premium-ledger rows;
    history events keep the record, unlinked.
Engines, sessions and init_db() live in optionflow/core/db.py.
"""
from __future__ import annotations

from sqlalchemy import (
    Boolean, Column, Date, DateTime, Enum, Float,
    ForeignKey, Index, Integer, String, Text,
)
from sqlalchemy.orm import declarative_base
import enum
from datetime import datetime

_EPOCH_UTC_NAIVE = datetime(1970, 1, 1)



Base = declarative_base()

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

class User(Base):
    __tablename__ = "users"
    id               = Column(Integer, primary_key=True)
    username         = Column(String, unique=True, index=True, nullable=False)
    password_hash    = Column(String, nullable=False)
    salt             = Column(String, nullable=True)
    created_at       = Column(DateTime, nullable=False, default=datetime.utcnow)
    auth_valid_after = Column(DateTime, nullable=False, default=_EPOCH_UTC_NAIVE)
    role             = Column(String, nullable=False, default="user")
    is_active        = Column(Boolean, nullable=False, default=True)

class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    id                   = Column(Integer, primary_key=True)
    user_id              = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
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
    replaced_by_token_id = Column(Integer, ForeignKey("refresh_tokens.id", ondelete="SET NULL"), nullable=True)

class RevokedToken(Base):
    __tablename__ = "revoked_tokens"
    id         = Column(Integer, primary_key=True)
    user_id    = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    jti        = Column(String, nullable=False, unique=True, index=True)
    revoked_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False, index=True)

class AuthEvent(Base):
    __tablename__ = "auth_events"
    id         = Column(Integer, primary_key=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    event_type = Column(String, nullable=False, index=True)
    success    = Column(Boolean, nullable=False, default=False, index=True)
    username   = Column(String, nullable=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    ip         = Column(String, nullable=True, index=True)
    user_agent = Column(String, nullable=True)
    detail     = Column(String, nullable=True)

# ═══════════════════════════════════════════════════════════════════════════════
# TRADES DATABASE  (trades.db)
# ═══════════════════════════════════════════════════════════════════════════════

class Account(Base):
    __tablename__ = "accounts"
    id         = Column(Integer, primary_key=True)
    user_id    = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    name       = Column(String, nullable=False)
    broker     = Column(String, nullable=True)
    currency   = Column(String, nullable=False, default="USD")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

# ═══════════════════════════════════════════════════════════════════════════════
# PORTFOLIO DATABASE  (portfolio.db)
# ═══════════════════════════════════════════════════════════════════════════════

class StockHolding(Base):
    """Merged replacement for old `holdings` + `stock_holdings` tables."""
    __tablename__ = "stock_holdings"
    id                  = Column(Integer, primary_key=True)
    user_id             = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    account_id          = Column(Integer, ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True, index=True)
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

class HoldingEvent(Base):
    __tablename__ = "holding_events"
    id            = Column(Integer, primary_key=True)
    user_id       = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    holding_id    = Column(Integer, ForeignKey("stock_holdings.id", ondelete="CASCADE"), nullable=False, index=True)
    position_id   = Column(Integer, ForeignKey("option_positions.id", ondelete="SET NULL"), nullable=True, index=True)
    event_type    = Column(Enum(HoldingEventType), nullable=False, index=True)
    shares_delta  = Column(Float, nullable=True)
    basis_delta   = Column(Float, nullable=True)
    realized_gain = Column(Float, nullable=True)
    description   = Column(String, nullable=True)
    created_at    = Column(DateTime, nullable=False, default=datetime.utcnow)

class WeeklySnapshot(Base):
    __tablename__ = "weekly_snapshots"
    id            = Column(Integer, primary_key=True)
    user_id       = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
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


class BrokerAccount(Base):
    __tablename__ = "broker_accounts"
    id         = Column(Integer, primary_key=True)
    user_id    = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    name       = Column(String, nullable=False)
    color      = Column(String, nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    is_active  = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class AccountBalance(Base):
    __tablename__ = "account_balances"
    __table_args__ = (
        Index("ux_account_balances_acct_week", "account_id", "week_date", unique=True),
    )
    id         = Column(Integer, primary_key=True)
    user_id    = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    account_id = Column(Integer, ForeignKey("broker_accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    week_date  = Column(Date, nullable=False, index=True)
    balance    = Column(Float, nullable=False)


class CashDeposit(Base):
    """
    Records cash added to or withdrawn from the account on a specific Friday.

    These entries are used to distinguish true trading P&L from capital injections
    when computing Week-over-Week deltas and Total Growth.

    amount  > 0 = deposit (cash added)
    amount  < 0 = withdrawal (cash removed)
    """
    __tablename__ = "cash_deposits"
    id         = Column(Integer, primary_key=True)
    user_id    = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    week_date  = Column(Date, nullable=False, index=True)   # The Friday this deposit hit
    amount     = Column(Float, nullable=False)               # +ve deposit, -ve withdrawal
    note       = Column(String, nullable=True)               # e.g. "Wire transfer", "Withdrawal"
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

Index("ux_cash_deposits_user_week", CashDeposit.user_id, CashDeposit.week_date)


class WatchlistSymbol(Base):
    """
    Per-user watchlist of stock symbols.

    Symbols are auto-registered when a position or holding is created (source='position'
    or source='holding').  Users can also add symbols manually (source='manual').
    Once a symbol is in the watchlist it is NEVER auto-deleted — only the user can
    remove it.  is_active=False means soft-deleted by the user.
    """
    __tablename__ = "watchlist_symbols"
    id           = Column(Integer, primary_key=True)
    user_id      = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    symbol       = Column(String, nullable=False, index=True)
    company_name = Column(String, nullable=True)
    source       = Column(String, nullable=False, default="manual")   # manual | position | holding
    notes        = Column(String, nullable=True)
    is_active    = Column(Boolean, nullable=False, default=True, index=True)
    added_at     = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at   = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

Index("ux_watchlist_user_symbol", WatchlistSymbol.user_id, WatchlistSymbol.symbol, unique=True)


class OptionPosition(Base):
    __tablename__ = "option_positions"
    id              = Column(Integer, primary_key=True)
    user_id         = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    week_id         = Column(Integer, ForeignKey("weekly_snapshots.id", ondelete="RESTRICT"), nullable=False, index=True)
    holding_id      = Column(Integer, ForeignKey("stock_holdings.id", ondelete="SET NULL"), nullable=True, index=True)
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
    rolled_to_id    = Column(Integer, ForeignKey("option_positions.id", ondelete="SET NULL"), nullable=True)
    carried_from_id = Column(Integer, ForeignKey("option_positions.id", ondelete="SET NULL"), nullable=True)
    margin          = Column(Float, nullable=True)
    notes           = Column(Text, nullable=True)
    created_at      = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at      = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

class PremiumLedger(Base):
    __tablename__ = "premium_ledger"
    id                 = Column(Integer, primary_key=True)
    user_id            = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    holding_id         = Column(Integer, ForeignKey("stock_holdings.id", ondelete="CASCADE"), nullable=False, index=True)
    position_id        = Column(Integer, ForeignKey("option_positions.id", ondelete="CASCADE"), nullable=False, index=True)
    symbol             = Column(String, nullable=False, index=True)
    week_id            = Column(Integer, ForeignKey("weekly_snapshots.id", ondelete="SET NULL"), nullable=True, index=True)
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

class StockAssignment(Base):
    __tablename__ = "stock_assignments"
    id                 = Column(Integer, primary_key=True)
    user_id            = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    position_id        = Column(Integer, ForeignKey("option_positions.id", ondelete="CASCADE"), nullable=False, index=True)
    symbol             = Column(String, nullable=False, index=True)
    shares_acquired    = Column(Integer, nullable=False)
    acquisition_price  = Column(Float, nullable=False)
    additional_buys    = Column(Text, nullable=True)
    covered_calls      = Column(Text, nullable=True)
    net_option_premium = Column(Float, nullable=True, default=0.0)
    notes              = Column(Text, nullable=True)
    created_at         = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at         = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

class PortfolioValueHistory(Base):
    """Daily net-worth snapshot — new table, ensures we never lose portfolio history again."""
    __tablename__ = "portfolio_value_history"
    id             = Column(Integer, primary_key=True)
    user_id        = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
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

class Budget(Base):
    __tablename__ = "budget"
    id           = Column(Integer, primary_key=True)
    user_id      = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
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

class BudgetOverride(Base):
    __tablename__ = "budget_overrides"
    id          = Column(Integer, primary_key=True)
    user_id     = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    budget_id   = Column(Integer, ForeignKey("budget.id", ondelete="CASCADE"), nullable=False, index=True)
    month_key   = Column(String, nullable=False)
    amount      = Column(Float, nullable=False)
    description = Column(String, nullable=True)
    created_at  = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at  = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

Index("ux_budget_overrides_user_budget_month", BudgetOverride.user_id, BudgetOverride.budget_id, BudgetOverride.month_key, unique=True)

class CreditCardWeek(Base):
    __tablename__ = "credit_card_weeks"
    id          = Column(Integer, primary_key=True)
    user_id     = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    week_start  = Column(DateTime, nullable=False)
    card_name   = Column(String, nullable=True)
    balance     = Column(Float, nullable=False, default=0.0)
    squared_off = Column(Boolean, nullable=False, default=False)
    paid_amount = Column(Float, nullable=True)
    note        = Column(String, nullable=True)
    created_at  = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at  = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

class CashFlow(Base):
    __tablename__ = "cash_flow"
    id      = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    action  = Column(Enum(CashAction), nullable=False)
    amount  = Column(Float, nullable=False)
    date    = Column(DateTime, nullable=False)
    notes   = Column(String, nullable=True)

class LedgerAccount(Base):
    __tablename__ = "ledger_accounts"
    id         = Column(Integer, primary_key=True)
    user_id    = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    name       = Column(String, nullable=False)
    type       = Column(Enum(LedgerAccountType), nullable=False, index=True)
    currency   = Column(String, nullable=False, default="USD")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)

Index("ux_ledger_accounts_user_name_currency", LedgerAccount.user_id, LedgerAccount.name, LedgerAccount.currency, unique=True)

class LedgerEntry(Base):
    __tablename__ = "ledger_entries"
    id              = Column(Integer, primary_key=True)
    user_id         = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    entry_type      = Column(Enum(LedgerEntryType), nullable=False, index=True)
    created_at      = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    effective_at    = Column(DateTime, nullable=True, index=True)
    description     = Column(String, nullable=True)
    idempotency_key = Column(String, nullable=True)
    source_type     = Column(String, nullable=True, index=True)
    source_id       = Column(Integer, nullable=True, index=True)

Index("ux_ledger_entries_user_idempotency_key", LedgerEntry.user_id, LedgerEntry.idempotency_key, unique=True)

class LedgerLine(Base):
    __tablename__ = "ledger_lines"
    id         = Column(Integer, primary_key=True)
    entry_id   = Column(Integer, ForeignKey("ledger_entries.id", ondelete="CASCADE"), nullable=False, index=True)
    account_id = Column(Integer, ForeignKey("ledger_accounts.id", ondelete="RESTRICT"), nullable=False, index=True)
    amount     = Column(Float, nullable=False)
    memo       = Column(String, nullable=True)

# ═══════════════════════════════════════════════════════════════════════════════
# MARKETS DATABASE  (markets.db)
# ═══════════════════════════════════════════════════════════════════════════════

class NetFlowSnapshot(Base):
    __tablename__ = "net_flow_snapshots"
    id         = Column(Integer, primary_key=True)
    symbol     = Column(String, nullable=False, index=True)
    ts         = Column(String, nullable=False, index=True)
    price      = Column(Float, nullable=True)
    call_prem  = Column(Float, nullable=True)
    put_prem   = Column(Float, nullable=True)
    net_flow   = Column(Float, nullable=True)
    total_prem = Column(Float, nullable=True)
    volume     = Column(Integer, nullable=True)

class PriceSnapshot(Base):
    __tablename__ = "price_snapshots"
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


class GexSnapshot(Base):
    """GEX replay: at most one snapshot per symbol every 5 minutes (flow.history)."""
    __tablename__ = "gex_snapshots"
    id         = Column(Integer, primary_key=True)
    symbol     = Column(String, nullable=False)
    ts         = Column(String, nullable=False)            # ISO UTC, "…Z"
    spot       = Column(Float, nullable=False)
    net_gex    = Column(Float, nullable=True)
    zero_gamma = Column(Float, nullable=True)
    call_wall  = Column(Float, nullable=True)
    put_wall   = Column(Float, nullable=True)
    king       = Column(Float, nullable=True)
    profile    = Column(Text, nullable=False, default="[]")  # JSON [[strike, net_gex], …] near spot

Index("idx_gex_snap_sym_ts", GexSnapshot.symbol, GexSnapshot.ts)


class BrokerPosition(Base):
    """Positions synced from a broker (Robinhood) for the hedge module.

    Replaced wholesale per (user, source) on each sync; never edited by hand.
    quantity is signed: long > 0, short < 0 (shares for stock, contracts for options).
    avg_price is per share (option premium per share, always >= 0).
    """
    __tablename__ = "broker_positions"
    id          = Column(Integer, primary_key=True)
    user_id     = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    source      = Column(String, nullable=False, default="robinhood")
    account     = Column(String, nullable=True)                 # masked label, e.g. "Trading ••8453"
    symbol      = Column(String, nullable=False, index=True)
    kind        = Column(String, nullable=False)                # "stock" | "option"
    quantity    = Column(Float, nullable=False)
    avg_price   = Column(Float, nullable=True)
    option_type = Column(String, nullable=True)                 # "call" | "put"
    strike      = Column(Float, nullable=True)
    expiry      = Column(String, nullable=True)                 # YYYY-MM-DD
    multiplier  = Column(Float, nullable=False, default=100.0)
    opened_at   = Column(String, nullable=True)                 # ISO UTC
    synced_at   = Column(String, nullable=False)                # ISO UTC


class BrokerAccountSnapshot(Base):
    """One row per (user, account, day) from the broker sync: account value history for the Portfolio page."""
    __tablename__ = "broker_account_snapshots"
    id           = Column(Integer, primary_key=True)
    user_id      = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    source       = Column(String, nullable=False, default="robinhood")
    account      = Column(String, nullable=False)                 # masked label
    day          = Column(String, nullable=False)                 # YYYY-MM-DD (US Eastern trading day)
    total_value  = Column(Float, nullable=True)
    equity_value = Column(Float, nullable=True)
    options_value = Column(Float, nullable=True)
    crypto_value = Column(Float, nullable=True)
    cash         = Column(Float, nullable=True)
    buying_power = Column(Float, nullable=True)
    synced_at    = Column(String, nullable=False)

Index("ux_broker_snap_user_acct_day", BrokerAccountSnapshot.user_id, BrokerAccountSnapshot.source,
      BrokerAccountSnapshot.account, BrokerAccountSnapshot.day, unique=True)


class BrokerActivity(Base):
    """Broker history, upserted by (user, source, ext_id): option fills and realized (closing) trades."""
    __tablename__ = "broker_activity"
    id              = Column(Integer, primary_key=True)
    user_id         = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    source          = Column(String, nullable=False, default="robinhood")
    ext_id          = Column(String, nullable=False)              # broker id (order leg id / derived key)
    account         = Column(String, nullable=True)
    kind            = Column(String, nullable=False)              # "option_fill" | "realized"
    ts              = Column(String, nullable=False, index=True)  # ISO UTC
    symbol          = Column(String, nullable=False, index=True)
    side            = Column(String, nullable=True)               # buy | sell
    position_effect = Column(String, nullable=True)               # open | close (option fills)
    option_type     = Column(String, nullable=True)
    strike          = Column(Float, nullable=True)
    expiry          = Column(String, nullable=True)
    quantity        = Column(Float, nullable=True)
    price           = Column(Float, nullable=True)                # per share
    amount          = Column(Float, nullable=True)                # option fills: cash, + credit / − debit
    realized_gain   = Column(Float, nullable=True)                # realized trades
    strategy        = Column(String, nullable=True)               # e.g. short_call (opening/closing strategy)

Index("ux_broker_activity_ext", BrokerActivity.user_id, BrokerActivity.source, BrokerActivity.ext_id, unique=True)



class PushSubscription(Base):
    """A browser's Web Push subscription (notify module). One row per device; the endpoint is the push
    service URL the browser gave us, p256dh / auth its encryption keys (base64url). Deleted when the push
    service answers 404 / 410."""
    __tablename__ = "push_subscriptions"
    id         = Column(Integer, primary_key=True)
    user_id    = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    endpoint   = Column(String, nullable=False, unique=True)
    p256dh     = Column(String, nullable=False)
    auth       = Column(String, nullable=False)
    user_agent = Column(String, nullable=True)
    created_at = Column(String, nullable=False)                 # ISO UTC
    last_ok_at = Column(String, nullable=True)                  # last delivery the push service accepted
