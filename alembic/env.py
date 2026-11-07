"""alembic/env.py — Dual-mode migration environment.

SQLite mode  (no DATABASE_URL set, default):
  Select a domain via ALEMBIC_DB env var (users / trades / portfolio / budget / markets).
  Migrations run against the matching local .db file.

    ALEMBIC_DB=portfolio alembic upgrade head
    ALEMBIC_DB=budget    alembic upgrade head

PostgreSQL mode  (DATABASE_URL=postgresql://... is set):
  All five domains live in one Postgres instance, each in its own schema.
  Select a domain via ALEMBIC_DB — the env automatically:
    1. Connects to the shared DATABASE_URL
    2. Creates the target schema if needed
    3. Sets search_path so all DDL resolves to the right schema
    4. Stores alembic_version in a per-schema table
       (e.g. portfolio.alembic_version, budget.alembic_version)

    DATABASE_URL=postgresql://user:pass@host:5432/optionflow \\
      ALEMBIC_DB=portfolio alembic upgrade head

  Run all five schemas in one shot (bash):
    for db in users trades portfolio budget markets; do
        ALEMBIC_DB=$db alembic upgrade head
    done
"""
from __future__ import annotations

import os
import sys
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool, text

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from database.models import (  # noqa: E402
    UsersBase, TradesBase, PortfolioBase, BudgetBase, MarketsBase,
    _is_postgres,
)

# ── Domain map: db-name → (schema, metadata) ─────────────────────────────────
_DOMAIN_MAP = {
    "users":     ("auth",      UsersBase.metadata),
    "trades":    ("trades",    TradesBase.metadata),
    "portfolio": ("portfolio", PortfolioBase.metadata),
    "budget":    ("budget",    BudgetBase.metadata),
    "markets":   ("markets",   MarketsBase.metadata),
}

# ── Active domain selection ───────────────────────────────────────────────────
_active_db = os.getenv("ALEMBIC_DB", "users")
if _active_db not in _DOMAIN_MAP:
    raise ValueError(
        f"ALEMBIC_DB='{_active_db}' is not valid. Choose one of: {list(_DOMAIN_MAP)}"
    )
_pg_schema, target_metadata = _DOMAIN_MAP[_active_db]

# ── SQLite fallback URLs (used when DATABASE_URL is not set) ──────────────────
_DB_ROOT = os.getenv("DB_DIR") or os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_SQLITE_URLS = {
    "users":     f"sqlite:///{_DB_ROOT}/users.db",
    "trades":    f"sqlite:///{_DB_ROOT}/trades.db",
    "portfolio": f"sqlite:///{_DB_ROOT}/portfolio.db",
    "budget":    f"sqlite:///{_DB_ROOT}/budget.db",
    "markets":   f"sqlite:///{_DB_ROOT}/markets.db",
}

_pg_url    = os.getenv("DATABASE_URL")
_effective_url = _pg_url if _pg_url else _SQLITE_URLS[_active_db]

# ── Alembic config ────────────────────────────────────────────────────────────
config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def _configure_context(connection, **kwargs):
    """Shared context configuration for both online and offline modes."""
    cfg = dict(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        **kwargs,
    )
    if _is_postgres():
        # Each schema gets its own alembic_version table so all 5 domains can
        # track their migration history independently in one Postgres database.
        cfg["version_table_schema"] = _pg_schema
        cfg["include_schemas"] = True
    context.configure(**cfg)


def run_migrations_offline() -> None:
    """Run migrations without a live DB connection (SQL script generation)."""
    cfg = dict(
        url=_effective_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    if _is_postgres():
        cfg["version_table_schema"] = _pg_schema
        cfg["include_schemas"] = True
    context.configure(**cfg)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against a live DB connection."""
    connectable = engine_from_config(
        {"sqlalchemy.url": _effective_url},
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        if _is_postgres():
            # 1. Ensure the schema exists
            connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{_pg_schema}"'))
            connection.commit()
            # 2. Set search_path so unqualified names (e.g. in FK constraints)
            #    resolve to this schema for the duration of this connection.
            connection.execute(text(f'SET search_path TO "{_pg_schema}", public'))
            connection.commit()
        _configure_context(connection)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
