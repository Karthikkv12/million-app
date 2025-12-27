from logic import services


def test_create_and_auth(db_engine_and_session):
    uid = services.create_user('alice', 'password123')
    assert isinstance(uid, int)
    auth_id = services.authenticate_user('alice', 'password123')
    assert auth_id == uid
    # wrong password
    assert services.authenticate_user('alice', 'wrong') is None


def test_per_user_isolation(db_engine_and_session):
    # create two users
    a_id = services.create_user('user_a', 'a')
    b_id = services.create_user('user_b', 'b')

    # user A creates a trade
    services.save_trade('AAPL', 'Stock', 'Swing', 'Buy', 1, 100.0, '2025-01-01', user_id=a_id)
    # user B creates a trade
    services.save_trade('TSLA', 'Stock', 'Swing', 'Buy', 2, 200.0, '2025-01-02', user_id=b_id)

    # load per user
    trades_a, _, _ = services.load_data(user_id=a_id)
    trades_b, _, _ = services.load_data(user_id=b_id)

    assert 'AAPL' in trades_a['symbol'].values
    assert 'TSLA' not in trades_a['symbol'].values
    assert 'TSLA' in trades_b['symbol'].values
    assert 'AAPL' not in trades_b['symbol'].values
