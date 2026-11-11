"""Foreign keys and ON DELETE rules of the one database (plan step 5)."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from database.models import AuthEvent, OptionPosition, RefreshToken, StockAssignment, StockHolding
from optionflow.core.db import get_session
from optionflow.modules.auth import service as auth
from optionflow.modules.portfolio import assignments, holdings, positions, weeks
from optionflow.modules.watchlist import service as watchlist


def test_foreign_keys_are_enforced(user_id):
    with pytest.raises(IntegrityError):
        weeks.get_or_create_week(user_id=999)                      # no such user
    s = get_session()
    try:
        assert s.execute(text("PRAGMA foreign_keys")).scalar() == 1
    finally:
        s.close()


def test_user_with_data_cannot_be_deleted(user_id):
    watchlist.upsert_symbol(user_id=user_id, symbol="SPY", source="manual")
    with pytest.raises(Exception) as exc:
        auth.admin_delete_user(user_id)
    assert getattr(exc.value, "status_code", None) == 409 and "deactivate" in str(exc.value)
    assert auth.get_user(user_id) is not None


def test_user_without_data_is_deleted_with_tokens_and_unlinked_events(user_id):
    auth.create_refresh_token(user_id=user_id)
    auth.log_auth_event(event_type="login", success=True, username="fixture_user", user_id=user_id)
    auth.admin_delete_user(user_id)
    s = get_session()
    try:
        assert s.query(RefreshToken).count() == 0                               # CASCADE
        assert [e.user_id for e in s.query(AuthEvent).all()] == [None]          # SET NULL: audit trail kept
    finally:
        s.close()


def test_deleting_position_removes_its_assignment(user_id):
    week = weeks.get_or_create_week(user_id=user_id)
    pos = positions.create_position(user_id=user_id, week_id=week["id"], data={
        "symbol": "AAPL", "contracts": 1, "strike": 100, "option_type": "PUT", "premium_in": 1.0})
    assignments.create_assignment(user_id=user_id, position_id=pos["id"], data={
        "symbol": "AAPL", "shares_acquired": 100, "acquisition_price": 100})
    positions.delete_position(user_id=user_id, position_id=pos["id"])
    s = get_session()
    try:
        assert s.query(OptionPosition).count() == 0 and s.query(StockAssignment).count() == 0
    finally:
        s.close()


def test_deleting_holding_keeps_positions_unlinked(user_id):
    h = holdings.create_holding(user_id=user_id, data={"symbol": "MSFT", "shares": 10, "cost_basis": 400.0})
    week = weeks.get_or_create_week(user_id=user_id)
    pos = positions.create_position(user_id=user_id, week_id=week["id"], data={
        "symbol": "MSFT", "contracts": 1, "strike": 420, "option_type": "CALL", "premium_in": 2.0, "holding_id": h["id"]})
    s = get_session()
    try:
        s.query(StockHolding).filter(StockHolding.id == h["id"]).delete()      # hard delete at DB level
        s.commit()
        assert s.query(OptionPosition).filter(OptionPosition.id == pos["id"]).one().holding_id is None   # SET NULL
    finally:
        s.close()


def test_admin_api_returns_409_for_user_with_data(db_engine_and_session):
    from optionflow.main import app
    root = auth.create_user("root", "RootPassword123", role="admin")
    other = auth.create_user("bob", "BobPassword1234")
    watchlist.upsert_symbol(user_id=other, symbol="QQQ", source="manual")
    client = TestClient(app)
    tok = client.post("/api/v1/auth/login", json={"username": "root", "password": "RootPassword123"}).json()["access_token"]
    r = client.delete(f"/api/v1/admin/users/{other}", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"
    assert root
