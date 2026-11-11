"""Regression tests for portfolio holdings.create_holding.

Commit c967a1f moved `return result` out of the reactivation branch, so
creating a holding for a symbol with no prior closed lot raised
UnboundLocalError and the "create fresh" path was unreachable.
"""
from optionflow.modules.portfolio import holdings
from optionflow.modules.watchlist import service as watchlist


def test_create_new_holding(user_id):
    h = holdings.create_holding(user_id=user_id, data={"symbol": "aapl", "shares": 100, "cost_basis": 150.0,
                                                 "company_name": "Apple"})
    assert h["symbol"] == "AAPL" and h["shares"] == 100 and h["status"] == "ACTIVE"
    assert h["cost_basis"] == 150.0 and h["adjusted_cost_basis"] == 150.0
    assert [w["symbol"] for w in watchlist.list_watchlist(user_id=user_id)] == ["AAPL"]   # auto-registered


def test_reactivates_closed_holding(user_id):
    h = holdings.create_holding(user_id=user_id, data={"symbol": "MSFT", "shares": 100, "cost_basis": 400.0})
    holdings.update_holding(user_id=user_id, holding_id=h["id"], data={"status": "CLOSED", "close_price": 410.0})
    again = holdings.create_holding(user_id=user_id, data={"symbol": "MSFT", "shares": 50, "cost_basis": 420.0})
    assert again["id"] == h["id"] and again["status"] == "ACTIVE"
