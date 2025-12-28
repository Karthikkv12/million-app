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


def test_change_password(db_engine_and_session):
    uid = services.create_user('bob', 'oldpass')
    assert services.authenticate_user('bob', 'oldpass') == uid
    services.change_password(user_id=uid, old_password='oldpass', new_password='newpass')
    assert services.authenticate_user('bob', 'oldpass') is None
    assert services.authenticate_user('bob', 'newpass') == uid


def test_idempotent_trade_submission(db_engine_and_session):
    uid = services.create_user('carol', 'pw')
    coid = 'order-123'
    services.save_trade('AAPL', 'Stock', 'Swing', 'Buy', 1, 100.0, '2025-01-01', user_id=uid, client_order_id=coid)
    services.save_trade('AAPL', 'Stock', 'Swing', 'Buy', 1, 100.0, '2025-01-01', user_id=uid, client_order_id=coid)
    trades, _, _ = services.load_data(user_id=uid)
    assert len(trades) == 1


def test_auth_valid_after_cutoff(db_engine_and_session):
    uid = services.create_user('dave', 'pw')
    services.set_auth_valid_after_epoch(user_id=uid, epoch_seconds=100)
    assert services.is_token_time_valid(user_id=uid, token_iat=99) is False
    assert services.is_token_time_valid(user_id=uid, token_iat=100) is True
    assert services.is_token_time_valid(user_id=uid, token_iat=101) is True


def test_refresh_token_rotation_and_revoke_all(db_engine_and_session):
    uid = services.create_user('erin', 'pw')
    rt = services.create_refresh_token(user_id=uid)
    assert services.validate_refresh_token(refresh_token=rt) == uid

    rotated = services.rotate_refresh_token(refresh_token=rt)
    assert rotated is not None
    user_id, rt2 = rotated
    assert user_id == uid
    assert rt2 != rt
    assert services.validate_refresh_token(refresh_token=rt) is None
    assert services.validate_refresh_token(refresh_token=rt2) == uid

    n = services.revoke_all_refresh_tokens(user_id=uid)
    assert n >= 1
    assert services.validate_refresh_token(refresh_token=rt2) is None


def test_login_rate_limit_counts_failures(db_engine_and_session, monkeypatch):
    # Tighten limits for test.
    monkeypatch.setenv("LOGIN_RATE_LIMIT_WINDOW_SECONDS", "300")
    monkeypatch.setenv("LOGIN_RATE_LIMIT_MAX_FAILURES", "3")

    username = "frank"
    ip = "1.2.3.4"
    assert services.is_login_rate_limited(username=username, ip=ip) is False

    services.log_auth_event(event_type="login", success=False, username=username, ip=ip)
    services.log_auth_event(event_type="login", success=False, username=username, ip=ip)
    assert services.is_login_rate_limited(username=username, ip=ip) is False

    services.log_auth_event(event_type="login", success=False, username=username, ip=ip)
    assert services.is_login_rate_limited(username=username, ip=ip) is True
