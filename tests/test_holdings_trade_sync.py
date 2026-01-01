from logic import services


def _get_sync_account_id(user_id: int) -> int:
    accts = services.list_accounts(user_id=user_id)
    assert len(accts) >= 1
    return int(accts[0]["id"])


def test_holdings_sync_buy_create_and_close(db_engine_and_session):
    uid = services.create_user("hs1", "GoodPassword12")

    tid = services.save_trade("AAPL", "Stock", "Swing", "Buy", 10, 100.0, "2025-01-01", user_id=uid)
    assert isinstance(tid, int)

    acct_id = _get_sync_account_id(uid)
    rows = services.list_holdings(user_id=uid, account_id=acct_id)
    assert len(rows) == 1
    assert rows[0]["symbol"] == "AAPL"
    assert rows[0]["quantity"] == 10.0
    assert float(rows[0]["avg_cost"] or 0.0) == 100.0

    assert services.close_trade(tid, 110.0, "2025-01-02", user_id=uid) is True
    rows2 = services.list_holdings(user_id=uid, account_id=acct_id)
    assert rows2 == []


def test_holdings_sync_short_sell_create_and_close(db_engine_and_session):
    uid = services.create_user("hs2", "GoodPassword12")

    tid = services.save_trade("TSLA", "Stock", "Swing", "Sell", 2, 200.0, "2025-01-01", user_id=uid)
    acct_id = _get_sync_account_id(uid)
    rows = services.list_holdings(user_id=uid, account_id=acct_id)
    assert len(rows) == 1
    assert rows[0]["symbol"] == "TSLA"
    assert rows[0]["quantity"] == -2.0

    assert services.close_trade(tid, 150.0, "2025-01-02", user_id=uid) is True
    rows2 = services.list_holdings(user_id=uid, account_id=acct_id)
    assert rows2 == []


def test_holdings_sync_idempotent_trade_does_not_double_count(db_engine_and_session):
    uid = services.create_user("hs3", "GoodPassword12")
    coid = "coid-1"

    services.save_trade("NVDA", "Stock", "Swing", "Buy", 1, 500.0, "2025-01-01", user_id=uid, client_order_id=coid)
    services.save_trade("NVDA", "Stock", "Swing", "Buy", 1, 500.0, "2025-01-01", user_id=uid, client_order_id=coid)

    acct_id = _get_sync_account_id(uid)
    rows = services.list_holdings(user_id=uid, account_id=acct_id)
    assert len(rows) == 1
    assert rows[0]["symbol"] == "NVDA"
    assert rows[0]["quantity"] == 1.0


def test_holdings_sync_delete_open_trade_reverses_quantity(db_engine_and_session):
    uid = services.create_user("hs4", "GoodPassword12")

    tid = services.save_trade("AAPL", "Stock", "Swing", "Buy", 5, 100.0, "2025-01-01", user_id=uid)
    acct_id = _get_sync_account_id(uid)
    assert len(services.list_holdings(user_id=uid, account_id=acct_id)) == 1

    assert services.delete_trade(tid, user_id=uid) is True
    assert services.list_holdings(user_id=uid, account_id=acct_id) == []
