"""optionflow/core/db.py — the database engine and sessions.

One database (plan step 5): SQLite at DB_DIR/optionflow.db by default, or any
SQLAlchemy URL in DATABASE_URL (e.g. Postgres). SQLite connections enforce
foreign keys.

Tests point the app at another engine with `use_engine(engine)`.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Optional

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from optionflow.core.settings import get_settings

_engine_override: Optional[Engine] = None


@event.listens_for(Engine, "connect")
def _sqlite_foreign_keys(dbapi_connection, connection_record) -> None:
    """SQLite ignores foreign keys unless each connection turns them on."""
    if type(dbapi_connection).__module__.startswith(("sqlite3", "pysqlite")):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


@lru_cache(maxsize=None)
def _engine_for_url(url: str) -> Engine:
    if url.startswith("sqlite"):
        return create_engine(url, connect_args={"check_same_thread": False}, poolclass=NullPool)
    s = get_settings()
    return create_engine(url, pool_pre_ping=True, pool_size=s.db_pool_size,
                         max_overflow=s.db_max_overflow, pool_timeout=s.db_pool_timeout)


def get_engine() -> Engine:
    if _engine_override is not None:
        return _engine_override
    return _engine_for_url(get_settings().resolved_database_url)


def get_session() -> Session:
    """A new session. Callers close it."""
    return sessionmaker(bind=get_engine())()


def use_engine(engine: Optional[Engine]) -> None:
    """Point the app at `engine` (tests, tools); None restores the configured one."""
    global _engine_override
    _engine_override = engine


def reset_engine_cache() -> None:
    _engine_for_url.cache_clear()


def init_db() -> None:
    """Create any missing tables. Safe to call repeatedly (schema changes go through Alembic)."""
    from database.models import Base
    Base.metadata.create_all(get_engine())
