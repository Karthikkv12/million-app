from logic import services


def test_orders_create_list_cancel_and_fill(db_engine_and_session):
    uid = services.create_user("ord1", "GoodPassword12")

    # Create (idempotent by client_order_id)
    oid1 = services.create_order(
        user_id=uid,
        symbol="AAPL",
        instrument="STOCK",
        action="BUY",
        strategy="Swing Trade",
        qty=3,
        limit_price=100.0,
        client_order_id="coid-xyz",
    )
    oid2 = services.create_order(
        user_id=uid,
        symbol="AAPL",
        instrument="STOCK",
        action="BUY",
        strategy="Swing Trade",
        qty=3,
        limit_price=100.0,
        client_order_id="coid-xyz",
    )
    assert int(oid1) == int(oid2)

    rows = services.list_orders(user_id=uid, limit=10)
    assert len(rows) == 1
    assert rows[0]["status"] == "PENDING"

    ev1 = services.list_order_events(user_id=uid, order_id=int(oid1), limit=50)
    assert [e["event_type"] for e in ev1] == ["CREATED"]

    # Cancel
    assert services.cancel_order(user_id=uid, order_id=int(oid1)) is True
    rows2 = services.list_orders(user_id=uid, limit=10)
    assert rows2[0]["status"] == "CANCELLED"

    ev2 = services.list_order_events(user_id=uid, order_id=int(oid1), limit=50)
    assert [e["event_type"] for e in ev2] == ["CREATED", "CANCELLED"]

    # New order -> fill creates a trade
    oid3 = services.create_order(
        user_id=uid,
        symbol="TSLA",
        instrument="STOCK",
        action="BUY",
        strategy="Swing Trade",
        qty=2,
        limit_price=None,
        client_order_id="coid-fill",
    )

    trade_id = services.fill_order(user_id=uid, order_id=int(oid3), filled_price=250.0, filled_at="2025-01-02")
    assert isinstance(trade_id, int)

    ev3 = services.list_order_events(user_id=uid, order_id=int(oid3), limit=50)
    assert [e["event_type"] for e in ev3] == ["CREATED", "FILLED"]

    orders = services.list_orders(user_id=uid, limit=10)
    filled = [o for o in orders if int(o["id"]) == int(oid3)][0]
    assert filled["status"] == "FILLED"
    assert int(filled["trade_id"]) == int(trade_id)

    # Trade row exists
    trades, _, _ = services.load_data(user_id=uid)
    assert len(trades) == 1
    assert "TSLA" in trades["symbol"].values

    # Holdings synced (TSLA +2)
    accts = services.list_accounts(user_id=uid)
    assert len(accts) >= 1
    acct_id = int(accts[0]["id"])
    holds = services.list_holdings(user_id=uid, account_id=acct_id)
    assert len(holds) == 1
    assert holds[0]["symbol"] == "TSLA"
    assert holds[0]["quantity"] == 2.0


def test_trade_submit_creates_filled_order(db_engine_and_session):
    uid = services.create_user("ord2", "GoodPassword12")

    trade_id = services.save_trade(
        symbol="AAPL",
        instrument="STOCK",
        strategy="Swing Trade",
        action="BUY",
        qty=1,
        price=123.45,
        date="2025-01-02",
        user_id=uid,
        client_order_id="client-trade-1",
    )
    assert isinstance(trade_id, int)

    orders = services.list_orders(user_id=uid, limit=20)
    # Trade submissions create a FILLED order with a prefixed client_order_id.
    filled = [o for o in orders if int(o.get("trade_id") or 0) == int(trade_id)]
    assert len(filled) == 1
    assert filled[0]["status"] == "FILLED"
