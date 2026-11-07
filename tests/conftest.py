"""Shared pytest fixtures.

- Settings: every test runs with test settings that ignore the developer's
  `.env` (session-wide), and can change individual values with
  `settings_override(...)`.
- Database: `db_engine_and_session` routes every data domain to one shared
  in-memory SQLite engine through `optionflow.core.db.use_engine`.
"""
import pytest
from sqlalchemy import StaticPool, create_engine
from sqlalchemy.orm import sessionmaker

import database.models as dbmodels
from optionflow.core import db as core_db
from optionflow.core.settings import Settings, get_settings, override_settings

TEST_SETTINGS = dict(
    jwt_secret="test-secret-do-not-use-in-prod",
    jwt_audience="optionflow-app",
    jwt_issuer="optionflow-api",
)


@pytest.fixture(scope="session", autouse=True)
def test_settings():
    """Test settings for the whole run: environment variables still apply, `.env` does not."""
    with override_settings(Settings(_env_file=None, **TEST_SETTINGS)) as s:
        yield s


@pytest.fixture
def settings_override():
    """Change settings for one test: `settings_override(login_rate_limit_max_failures=3)`."""
    stack = []

    def _apply(**changes):
        cm = override_settings(get_settings().model_copy(update=changes))
        stack.append(cm)
        return cm.__enter__()

    yield _apply
    while stack:
        stack.pop().__exit__(None, None, None)


def make_memory_engine():
    """One in-memory SQLite engine with every domain's tables.

    StaticPool makes every session share the same connection, so cross-domain
    queries (e.g. Account on trades + StockHolding on portfolio) work.
    """
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    for base in (dbmodels.UsersBase, dbmodels.TradesBase, dbmodels.PortfolioBase,
                 dbmodels.BudgetBase, dbmodels.MarketsBase):
        base.metadata.create_all(engine)
    return engine


@pytest.fixture(scope="function")
def db_engine_and_session():
    """A fresh in-memory database used by every domain for one test."""
    engine = make_memory_engine()
    core_db.use_engine(engine)
    try:
        yield engine, sessionmaker(bind=engine)
    finally:
        core_db.use_engine(None)
        engine.dispose()
