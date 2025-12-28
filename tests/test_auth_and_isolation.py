from logic import services


def test_create_and_auth(db_engine_and_session):
    uid = services.create_user('alice', 'GoodPassword12')
    assert isinstance(uid, int)
    auth_id = services.authenticate_user('alice', 'GoodPassword12')
    assert auth_id == uid
    # wrong password
    assert services.authenticate_user('alice', 'wrong') is None


def test_per_user_isolation(db_engine_and_session):
    # create two users
    a_id = services.create_user('user_a', 'GoodPassword12')
    b_id = services.create_user('user_b', 'GoodPassword12')

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
    uid = services.create_user('bob', 'GoodPassword12')
    assert services.authenticate_user('bob', 'GoodPassword12') == uid
    services.change_password(user_id=uid, old_password='GoodPassword12', new_password='BetterPassword34')
    assert services.authenticate_user('bob', 'GoodPassword12') is None
    assert services.authenticate_user('bob', 'BetterPassword34') == uid


def test_idempotent_trade_submission(db_engine_and_session):
    uid = services.create_user('carol', 'GoodPassword12')
    coid = 'order-123'
    services.save_trade('AAPL', 'Stock', 'Swing', 'Buy', 1, 100.0, '2025-01-01', user_id=uid, client_order_id=coid)
    services.save_trade('AAPL', 'Stock', 'Swing', 'Buy', 1, 100.0, '2025-01-01', user_id=uid, client_order_id=coid)
    trades, _, _ = services.load_data(user_id=uid)
    assert len(trades) == 1


def test_auth_valid_after_cutoff(db_engine_and_session):
    uid = services.create_user('dave', 'GoodPassword12')
    services.set_auth_valid_after_epoch(user_id=uid, epoch_seconds=100)
    assert services.is_token_time_valid(user_id=uid, token_iat=99) is False
    assert services.is_token_time_valid(user_id=uid, token_iat=100) is True
    assert services.is_token_time_valid(user_id=uid, token_iat=101) is True


def test_refresh_token_rotation_and_revoke_all(db_engine_and_session):
    uid = services.create_user('erin', 'GoodPassword12')
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


def test_list_and_revoke_refresh_sessions(db_engine_and_session):
    uid = services.create_user("gina", "GoodPassword12")
    rt = services.create_refresh_token(user_id=uid, ip="9.9.9.9", user_agent="pytest")
    assert services.validate_refresh_token(refresh_token=rt) == uid

    sessions = services.list_refresh_sessions(user_id=uid, limit=10)
    assert len(sessions) == 1
    assert int(sessions[0]["id"]) >= 1
    assert sessions[0]["ip"] == "9.9.9.9"

    ok = services.revoke_refresh_session_by_id(user_id=uid, session_id=int(sessions[0]["id"]), reason="test")
    assert ok is True
    assert services.validate_refresh_token(refresh_token=rt) is None

    sessions2 = services.list_refresh_sessions(user_id=uid, limit=10)
    assert sessions2 == []


def test_password_policy_enforced_on_signup(db_engine_and_session):
    # Too short and missing requirements
    try:
        services.create_user("policy1", "short")
        assert False, "expected ValueError"
    except ValueError as e:
        assert "password" in str(e).lower()

    # Meets default policy: 12+ chars, upper+lower+digit
    uid = services.create_user("policy2", "GoodPassword12")
    assert isinstance(uid, int)


def test_password_policy_enforced_on_change_password(db_engine_and_session):
    uid = services.create_user("policy3", "GoodPassword12")

    try:
        services.change_password(user_id=uid, old_password="GoodPassword12", new_password="alllowercase12")
        assert False, "expected ValueError"
    except ValueError as e:
        assert "uppercase" in str(e).lower() or "password" in str(e).lower()

    # Valid new password
    services.change_password(user_id=uid, old_password="GoodPassword12", new_password="BetterPassword34")
    assert services.authenticate_user("policy3", "BetterPassword34") == uid


def test_accounts_and_holdings_isolation_and_upsert(db_engine_and_session):
    a_id = services.create_user("acct_a", "GoodPassword12")
    b_id = services.create_user("acct_b", "GoodPassword12")

    acct1 = services.create_account(user_id=a_id, name="Main", broker="BrokerX", currency="USD")
    assert isinstance(acct1, int)

    # A can upsert holdings
    h1 = services.upsert_holding(user_id=a_id, account_id=acct1, symbol="AAPL", quantity=10, avg_cost=100.0)
    assert h1["symbol"] == "AAPL"
    assert h1["quantity"] == 10.0

    # Upsert updates same row (unique by user+account+symbol)
    h2 = services.upsert_holding(user_id=a_id, account_id=acct1, symbol="AAPL", quantity=12, avg_cost=101.0)
    assert int(h2["id"]) == int(h1["id"])
    assert h2["quantity"] == 12.0

    rows = services.list_holdings(user_id=a_id, account_id=acct1)
    assert len(rows) == 1
    assert rows[0]["symbol"] == "AAPL"

    # B cannot read A's account holdings
    try:
        services.list_holdings(user_id=b_id, account_id=acct1)
        assert False, "expected ValueError"
    except ValueError:
        pass
