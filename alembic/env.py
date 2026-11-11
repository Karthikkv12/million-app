"""Alembic environment for OptionFlow's one database.

The URL comes from the app settings (DATABASE_URL, or SQLite at DB_DIR/DB_FILE),
so `alembic upgrade head` migrates the same database the app uses.

    alembic upgrade head                      # apply migrations
    alembic revision --autogenerate -m "…"    # new migration from model changes
"""
import os
import sys
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from database.models import Base  # noqa: E402
from optionflow.core.settings import get_settings  # noqa: E402

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata
URL = get_settings().resolved_database_url
SQLITE = URL.startswith("sqlite")


def run_migrations_offline() -> None:
    context.configure(url=URL, target_metadata=target_metadata, literal_binds=True,
                      dialect_opts={"paramstyle": "named"}, compare_type=True, render_as_batch=SQLITE)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = engine_from_config({"sqlalchemy.url": URL}, prefix="sqlalchemy.", poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata,
                          compare_type=True, render_as_batch=SQLITE)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
