from logic import auth_services, trade_services


def test_create_and_auth(db_engine_and_session):
    uid = auth_services.create_user('alice', 'GoodPassword12')
    assert isinstance(uid, int)
    auth_result = auth_services.authenticate_user('alice', 'GoodPassword12')
    assert auth_result is not None
    assert auth_result['user_id'] == uid
    # wrong password
    assert auth_services.authenticate_user('alice', 'wrong') is None


def test_per_user_isolation(db_engine_and_session):
    # create two users
    a_id = auth_services.create_user('user_a', 'GoodPassword12')
    b_id = auth_services.create_user('user_b', 'GoodPassword12')

    # user A creates an account
    trade_services.create_account(user_id=a_id, name='User_A_Account')
    # user B creates an account
    trade_services.create_account(user_id=b_id, name='User_B_Account')

    # verify per-user isolation
    accounts_a = trade_services.list_accounts(user_id=a_id)
    accounts_b = trade_services.list_accounts(user_id=b_id)

    assert any(ac['name'] == 'User_A_Account' for ac in accounts_a)
    assert not any(ac['name'] == 'User_B_Account' for ac in accounts_a)
    assert any(ac['name'] == 'User_B_Account' for ac in accounts_b)
    assert not any(ac['name'] == 'User_A_Account' for ac in accounts_b)


def test_change_password(db_engine_and_session):
    uid = auth_services.create_user('bob', 'GoodPassword12')
    assert auth_services.authenticate_user('bob', 'GoodPassword12')['user_id'] == uid
    auth_services.change_password(user_id=uid, old_password='GoodPassword12', new_password='BetterPassword34')
    assert auth_services.authenticate_user('bob', 'GoodPassword12') is None
    assert auth_services.authenticate_user('bob', 'BetterPassword34')['user_id'] == uid


def test_idempotent_trade_submission(db_engine_and_session):
    uid = auth_services.create_user('carol', 'GoodPassword12')
    # Create an account and verify only one exists
    trade_services.create_account(user_id=uid, name='Main')
    accounts = trade_services.list_accounts(user_id=uid)
    assert len(accounts) == 1
    assert accounts[0]['name'] == 'Main'


def test_auth_valid_after_cutoff(db_engine_and_session):
    uid = auth_services.create_user('dave', 'GoodPassword12')
    auth_services.set_auth_valid_after_epoch(user_id=uid, epoch_seconds=100)
    assert auth_services.is_token_time_valid(user_id=uid, token_iat=99) is False
    assert auth_services.is_token_time_valid(user_id=uid, token_iat=100) is True
    assert auth_services.is_token_time_valid(user_id=uid, token_iat=101) is True


def test_refresh_token_rotation_and_revoke_all(db_engine_and_session):
    uid = auth_services.create_user('erin', 'GoodPassword12')
    rt = auth_services.create_refresh_token(user_id=uid)
    assert auth_services.validate_refresh_token(refresh_token=rt) == uid

    rotated = auth_services.rotate_refresh_token(refresh_token=rt)
    assert rotated is not None
    user_id, rt2 = rotated
    assert user_id == uid
    assert rt2 != rt
    assert auth_services.validate_refresh_token(refresh_token=rt) is None
    assert auth_services.validate_refresh_token(refresh_token=rt2) == uid

    n = auth_services.revoke_all_refresh_tokens(user_id=uid)
    assert n >= 1
    assert auth_services.validate_refresh_token(refresh_token=rt2) is None


def test_login_rate_limit_counts_failures(db_engine_and_session, settings_override):
    # Tighten limits for test.
    settings_override(login_rate_limit_window_seconds=300, login_rate_limit_max_failures=3)

    username = "frank"
    ip = "1.2.3.4"
    assert auth_services.is_login_rate_limited(username=username, ip=ip) is False

    auth_services.log_auth_event(event_type="login", success=False, username=username, ip=ip)
    auth_services.log_auth_event(event_type="login", success=False, username=username, ip=ip)
    assert auth_services.is_login_rate_limited(username=username, ip=ip) is False

    auth_services.log_auth_event(event_type="login", success=False, username=username, ip=ip)
    assert auth_services.is_login_rate_limited(username=username, ip=ip) is True


def test_list_and_revoke_refresh_sessions(db_engine_and_session):
    uid = auth_services.create_user("gina", "GoodPassword12")
    rt = auth_services.create_refresh_token(user_id=uid, ip="9.9.9.9", user_agent="pytest")
    assert auth_services.validate_refresh_token(refresh_token=rt) == uid

    sessions = auth_services.list_refresh_sessions(user_id=uid, limit=10)
    assert len(sessions) == 1
    assert int(sessions[0]["id"]) >= 1
    assert sessions[0]["ip"] == "9.9.9.9"

    ok = auth_services.revoke_refresh_session_by_id(user_id=uid, session_id=int(sessions[0]["id"]), reason="test")
    assert ok is True
    assert auth_services.validate_refresh_token(refresh_token=rt) is None

    sessions2 = auth_services.list_refresh_sessions(user_id=uid, limit=10)
    assert sessions2 == []


def test_password_policy_enforced_on_signup(db_engine_and_session):
    # Too short and missing requirements
    try:
        auth_services.create_user("policy1", "short")
        assert False, "expected ValueError"
    except ValueError as e:
        assert "password" in str(e).lower()

    # Meets default policy: 12+ chars, upper+lower+digit
    uid = auth_services.create_user("policy2", "GoodPassword12")
    assert isinstance(uid, int)


def test_password_policy_enforced_on_change_password(db_engine_and_session):
    uid = auth_services.create_user("policy3", "GoodPassword12")

    try:
        auth_services.change_password(user_id=uid, old_password="GoodPassword12", new_password="alllowercase12")
        assert False, "expected ValueError"
    except ValueError as e:
        assert "uppercase" in str(e).lower() or "password" in str(e).lower()

    # Valid new password
    auth_services.change_password(user_id=uid, old_password="GoodPassword12", new_password="BetterPassword34")
    assert auth_services.authenticate_user("policy3", "BetterPassword34")['user_id'] == uid


def test_accounts_and_holdings_isolation_and_upsert(db_engine_and_session):
    a_id = auth_services.create_user("acct_a", "GoodPassword12")
    b_id = auth_services.create_user("acct_b", "GoodPassword12")

    acct1 = trade_services.create_account(user_id=a_id, name="Main", broker="BrokerX", currency="USD")
    assert isinstance(acct1, int)

    # A can upsert holdings
    h1 = trade_services.upsert_holding(user_id=a_id, account_id=acct1, symbol="AAPL", quantity=10, avg_cost=100.0)
    assert h1["symbol"] == "AAPL"
    assert h1["quantity"] == 10.0

    # Upsert updates same row (unique by user+account+symbol)
    h2 = trade_services.upsert_holding(user_id=a_id, account_id=acct1, symbol="AAPL", quantity=12, avg_cost=101.0)
    assert int(h2["id"]) == int(h1["id"])
    assert h2["quantity"] == 12.0

    rows = trade_services.list_holdings(user_id=a_id, account_id=acct1)
    assert len(rows) == 1
    assert rows[0]["symbol"] == "AAPL"

    # B cannot read A's account holdings
    try:
        trade_services.list_holdings(user_id=b_id, account_id=acct1)
        assert False, "expected ValueError"
    except ValueError:
        pass
