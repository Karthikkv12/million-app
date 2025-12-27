import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import models as dbmodels
import logic.services as services


@pytest.fixture(scope='function')
def db_engine_and_session(monkeypatch):
    """Provide an in-memory SQLite engine and Session for tests and patch services to use them."""
    engine = create_engine('sqlite:///:memory:')
    Session = sessionmaker(bind=engine)
    # Create tables
    dbmodels.Base.metadata.create_all(engine)

    # Monkeypatch the services module to use this engine/session
    monkeypatch.setattr(services, 'engine', engine)
    monkeypatch.setattr(services, 'Session', Session)

    yield engine, Session
