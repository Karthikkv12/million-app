import os

import json
from pathlib import Path

from database.models import Order
from logic import services


def _enable_paper_broker(tmp_path: Path) -> None:
    os.environ["BROKER_ENABLED"] = "1"
    os.environ["BROKER_PROVIDER"] = "paper"
    os.environ["PAPER_BROKER_STATE_FILE"] = str(tmp_path / "paper_state.json")


def test_broker_enabled_create_order_sets_external_fields(db_engine_and_session, tmp_path):
    _enable_paper_broker(tmp_path)
    try:
        _, Session = db_engine_and_session
        order_id = services.create_order(
            user_id=1,
            symbol="AAPL",
            instrument="STOCK",
            action="BUY",
            qty=2,
            limit_price=123.45,
            strategy=None,
            client_order_id="test:coid:1",
        )
        with Session() as session:
            o = session.query(Order).filter(Order.id == order_id).one()
        assert o.external_order_id
        assert o.venue
        assert o.external_status
        assert o.last_synced_at is not None

        state = json.loads(Path(os.environ["PAPER_BROKER_STATE_FILE"]).read_text("utf-8"))
        assert "orders" in state
        assert o.external_order_id in state["orders"]

        ev = services.list_order_events(user_id=1, order_id=int(order_id), limit=50)
        assert [e["event_type"] for e in ev] == ["CREATED", "SUBMITTED"]
    finally:
        os.environ.pop("BROKER_ENABLED", None)
        os.environ.pop("BROKER_PROVIDER", None)
        os.environ.pop("PAPER_BROKER_STATE_FILE", None)


def test_broker_enabled_cancel_order_sets_external_status(db_engine_and_session, tmp_path):
    _enable_paper_broker(tmp_path)
    try:
        _, Session = db_engine_and_session
        order_id = services.create_order(
            user_id=1,
            symbol="MSFT",
            instrument="STOCK",
            action="BUY",
            qty=1,
            limit_price=None,
            strategy=None,
            client_order_id="test:coid:2",
        )

        ok = services.cancel_order(user_id=1, order_id=order_id)
        assert ok is True

        with Session() as session:
            o = session.query(Order).filter(Order.id == order_id).one()
        assert o.status.name == "CANCELLED"
        assert o.external_status == "CANCELLED"
        assert o.last_synced_at is not None

        ev = services.list_order_events(user_id=1, order_id=int(order_id), limit=50)
        assert [e["event_type"] for e in ev][-1] == "CANCELLED"
    finally:
        os.environ.pop("BROKER_ENABLED", None)
        os.environ.pop("BROKER_PROVIDER", None)
        os.environ.pop("PAPER_BROKER_STATE_FILE", None)


def test_broker_enabled_sync_updates_last_synced_at(db_engine_and_session, tmp_path):
    _enable_paper_broker(tmp_path)
    try:
        _, Session = db_engine_and_session
        order_id = services.create_order(
            user_id=1,
            symbol="TSLA",
            instrument="STOCK",
            action="BUY",
            qty=1,
            limit_price=None,
            strategy=None,
            client_order_id="test:coid:3",
        )
        with Session() as session:
            before = session.query(Order).filter(Order.id == order_id).one()
            before_ts = before.last_synced_at
            assert before.external_order_id

        ok = services.sync_order_status(user_id=1, order_id=order_id)
        assert ok is True

        with Session() as session:
            after = session.query(Order).filter(Order.id == order_id).one()
            assert after.external_status in {"ACCEPTED", "CANCELLED", "UNKNOWN"}
            assert after.last_synced_at is not None
            if before_ts is not None:
                assert after.last_synced_at >= before_ts

        ev = services.list_order_events(user_id=1, order_id=int(order_id), limit=50)
        assert "SYNCED" in [e["event_type"] for e in ev]
    finally:
        os.environ.pop("BROKER_ENABLED", None)
        os.environ.pop("BROKER_PROVIDER", None)
        os.environ.pop("PAPER_BROKER_STATE_FILE", None)


def test_broker_enabled_sync_pending_updates_external_status(db_engine_and_session, tmp_path):
    _enable_paper_broker(tmp_path)
    try:
        _, Session = db_engine_and_session
        order_id = services.create_order(
            user_id=1,
            symbol="NVDA",
            instrument="STOCK",
            action="BUY",
            qty=1,
            limit_price=None,
            strategy=None,
            client_order_id="test:coid:pending-sync",
        )

        # Simulate an external cancel in the broker without updating our DB.
        from brokers import get_broker

        with Session() as session:
            o = session.query(Order).filter(Order.id == order_id).one()
            ext = str(o.external_order_id)
        broker = get_broker()
        broker.cancel_order(user_id=1, external_order_id=ext)

        n = services.sync_pending_orders(user_id=1)
        assert n >= 1

        with Session() as session:
            o2 = session.query(Order).filter(Order.id == order_id).one()
            assert o2.status.name == "PENDING"  # local status unchanged
            assert o2.external_status == "CANCELLED"
            assert o2.last_synced_at is not None
    finally:
        os.environ.pop("BROKER_ENABLED", None)
        os.environ.pop("BROKER_PROVIDER", None)
        os.environ.pop("PAPER_BROKER_STATE_FILE", None)


def test_broker_enabled_fill_via_broker_creates_trade_and_fills_order(db_engine_and_session, tmp_path):
    _enable_paper_broker(tmp_path)
    try:
        _, Session = db_engine_and_session
        order_id = services.create_order(
            user_id=1,
            symbol="META",
            instrument="STOCK",
            action="BUY",
            qty=1,
            limit_price=None,
            strategy=None,
            client_order_id="test:coid:fill-external",
        )

        trade_id = services.fill_order_via_broker(user_id=1, order_id=order_id, filled_price=10.5)
        assert trade_id > 0

        with Session() as session:
            o = session.query(Order).filter(Order.id == order_id).one()
            assert o.status.name == "FILLED"
            assert o.trade_id == trade_id
            assert o.external_status == "FILLED"
            assert o.last_synced_at is not None

        ev = services.list_order_events(user_id=1, order_id=int(order_id), limit=50)
        assert [e["event_type"] for e in ev][-1] == "FILLED"
    finally:
        os.environ.pop("BROKER_ENABLED", None)
        os.environ.pop("BROKER_PROVIDER", None)
        os.environ.pop("PAPER_BROKER_STATE_FILE", None)
