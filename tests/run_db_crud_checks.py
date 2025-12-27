import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import models as dbmodels
from logic import services


def run_db_crud_checks():
    # Use an in-memory SQLite DB for tests
    engine = create_engine('sqlite:///:memory:')
    Session = sessionmaker(bind=engine)

    # Point services to this test engine/session
    services.engine = engine
    services.Session = Session

    # Create tables
    dbmodels.Base.metadata.create_all(engine)

    # Ensure DB starts empty
    t, c, b = services.load_data()
    assert t.empty and c.empty and b.empty

    # Create a trade
    services.save_trade('AAPL', 'Stock', 'Swing Trade', 'Buy', 10, 150.0, '2025-01-01')
    trades, _, _ = services.load_data()
    print('TRADES AFTER SAVE:\n', trades)
    assert not trades.empty
    assert 'AAPL' in trades['symbol'].values

    # Delete the trade
    tid = trades.iloc[0]['id']
    print('Deleting trade id:', tid, 'type:', type(tid))
    ok = services.delete_trade(int(tid))
    print('delete_trade returned:', ok)
    trades2, _, _ = services.load_data()
    print('TRADES AFTER DELETE:\n', trades2)
    assert trades2.empty

    print('OK: DB CRUD checks passed')


if __name__ == '__main__':
    run_db_crud_checks()
