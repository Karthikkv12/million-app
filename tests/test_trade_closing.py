from logic import services


def test_close_trade_records_exit_and_realized_pnl(db_engine_and_session):
    # Open a BUY position
    services.save_trade('AAPL', 'Stock', 'Swing', 'Buy', 10, 100.0, '2025-01-01')
    trades, _, _ = services.load_data()
    tid = int(trades.iloc[0]['id'])

    # Close at a higher price
    assert services.close_trade(tid, 110.0, '2025-01-02') is True

    trades2, _, _ = services.load_data()
    row = trades2[trades2['id'] == tid].iloc[0]

    assert float(row['exit_price']) == 110.0
    assert bool(row['is_closed']) is True
    assert float(row['realized_pnl']) == 100.0  # (110-100)*10


def test_close_trade_sell_direction(db_engine_and_session):
    # Open a SELL position (short)
    services.save_trade('TSLA', 'Stock', 'Swing', 'Sell', 2, 200.0, '2025-01-01')
    trades, _, _ = services.load_data()
    tid = int(trades.iloc[0]['id'])

    # Close at a lower price => profit
    assert services.close_trade(tid, 150.0, '2025-01-02') is True

    trades2, _, _ = services.load_data()
    row = trades2[trades2['id'] == tid].iloc[0]

    assert float(row['exit_price']) == 150.0
    assert bool(row['is_closed']) is True
    assert float(row['realized_pnl']) == 100.0  # (200-150)*2


def test_close_trade_idempotent(db_engine_and_session):
    services.save_trade('NVDA', 'Stock', 'Swing', 'Buy', 1, 100.0, '2025-01-01')
    trades, _, _ = services.load_data()
    tid = int(trades.iloc[0]['id'])

    assert services.close_trade(tid, 120.0, '2025-01-02') is True
    # Closing again should fail
    assert services.close_trade(tid, 130.0, '2025-01-03') is False
