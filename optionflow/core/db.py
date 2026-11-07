"""optionflow/core/db.py — database engines and sessions.

Five data domains (users, trades, portfolio, budget, markets). In SQLite mode
each is its own file; with a Postgres DATABASE_URL they share one engine and
one connection pool. Plan step 5 merges the SQLite files into one database.

Tests point every domain at one engine with `use_engine(engine)` instead of
monkeypatching the getters.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Optional

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from optionflow.core.settings import DB_DOMAINS, get_settings

_engine_override: Optional[Engine] = None


@lru_cache(maxsize=None)
def _engine_for_url(url: str) -> Engine:
    if url.startswith("sqlite"):
        return create_engine(url, connect_args={"check_same_thread": False}, poolclass=NullPool)
    s = get_settings()
    return create_engine(
        url,
        pool_pre_ping=True,
        pool_size=s.db_pool_size,
        max_overflow=s.db_max_overflow,
        pool_timeout=s.db_pool_timeout,
    )


def get_engine(domain: str = "trades") -> Engine:
    """Engine for a data domain. Defaults to trades (the legacy get_engine())."""
    if _engine_override is not None:
        return _engine_override
    return _engine_for_url(get_settings().database_url_for(domain))


def get_session(domain: str) -> Session:
    """A new session on the given domain's engine. Callers close it."""
    return sessionmaker(bind=get_engine(domain))()


# ── Named helpers (one per domain) ─────────────────────────────────────────────
def get_users_engine() -> Engine:     return get_engine("users")
def get_trades_engine() -> Engine:    return get_engine("trades")
def get_portfolio_engine() -> Engine: return get_engine("portfolio")
def get_budget_engine() -> Engine:    return get_engine("budget")
def get_markets_engine() -> Engine:   return get_engine("markets")

def get_users_session() -> Session:     return get_session("users")
def get_trades_session() -> Session:    return get_session("trades")
def get_portfolio_session() -> Session: return get_session("portfolio")
def get_budget_session() -> Session:    return get_session("budget")
def get_markets_session() -> Session:   return get_session("markets")


# ── Test / tooling hooks ───────────────────────────────────────────────────────
def use_engine(engine: Optional[Engine]) -> None:
    """Route every domain to `engine` (pass None to restore normal engines)."""
    global _engine_override
    _engine_override = engine


def reset_engine_cache() -> None:
    """Drop cached engines so the next call re-reads the database settings."""
    _engine_for_url.cache_clear()


# ── Schema creation ────────────────────────────────────────────────────────────
def init_db() -> None:
    """Create all tables across all five domains. Safe to call repeatedly.

    In Postgres mode, also creates the logical schemas first.
    """
    from database.models import BudgetBase, MarketsBase, PortfolioBase, TradesBase, UsersBase

    bases = {
        "users": UsersBase, "trades": TradesBase, "portfolio": PortfolioBase,
        "budget": BudgetBase, "markets": MarketsBase,
    }
    if get_settings().is_postgres and _engine_override is None:
        eng = get_engine("users")  # every domain shares this engine
        with eng.connect() as conn:
            for schema in ("auth", "trades", "portfolio", "budget", "markets"):
                conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))
            conn.commit()
        for base in bases.values():
            base.metadata.create_all(eng)
        return
    for domain in DB_DOMAINS:
        bases[domain].metadata.create_all(get_engine(domain))
