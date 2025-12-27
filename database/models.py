from __future__ import annotations

import os
from functools import lru_cache

from sqlalchemy import Column, DateTime, Enum, Float, ForeignKey, Integer, String, create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import declarative_base
from sqlalchemy.pool import NullPool
import enum
from datetime import datetime

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
    option_type = Column(Enum(OptionType), nullable=True)
    strike_price = Column(Float, nullable=True)
    expiry_date = Column(DateTime, nullable=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=True, index=True)

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
    return engine