"""Golden HTTP tests for the portfolio, accounts and budget modules.

A fixed scenario exercises every route; the full JSON of every response is
compared with tests/golden/portfolio_budget_api.json, which was recorded from
the routers before they moved into modules (plan step 4b). Run with
UPDATE_GOLDEN=1 to re-record (only when a response change is intended).
"""
import json
import os
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from conftest import make_memory_engine
from optionflow.core import db as core_db
from optionflow.core.settings import Settings
from optionflow.main import create_app

GOLDEN = Path(__file__).parent / "golden" / "portfolio_budget_api.json"
PASSWORD = "GoodPassword12"
PREFIXES = ["", "/api/v1"]

_TIME_KEYS = re.compile(r"(_at|^ts|^updated|^created|^last_|^as_of)$")


def _normalize(value, key=""):
    """Hide timestamps the server sets from the clock (created_at, updated_at, …).

    Every other value, including dates derived from the scenario's fixed
    dates, is compared exactly, so the test gives the same result on any day.
    """
    if isinstance(value, dict):
        return {k: _normalize(v, k) for k, v in sorted(value.items())}
    if isinstance(value, list):
        return [_normalize(v, key) for v in value]
    if isinstance(value, str) and _TIME_KEYS.search(key):
        return "<time>"
    return value


def run_scenario(prefix: str) -> list:
    app = create_app(Settings(_env_file=None, enabled_modules="auth,portfolio,budget"))
    client = TestClient(app)
    from optionflow.modules.auth import service as auth_service
    auth_service.create_user("trader", PASSWORD)
    tok = client.post(prefix + "/auth/login", json={"username": "trader", "password": PASSWORD}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    log = []

    def call(method, path, body=None, params=None, name=None):
        r = client.request(method, prefix + path, json=body, params=params, headers=h)
        try:
            payload = r.json()
        except ValueError:
            payload = r.text or None
        if isinstance(payload, dict) and "error" in payload and set(payload) == {"error"}:
            payload = {"detail": payload["error"]["message"]}       # compare v1 errors by message
        log.append({"step": name or f"{method} {path}", "status": r.status_code, "body": _normalize(payload)})
        return payload

    # ── Portfolio: weeks ──────────────────────────────────────────────────────
    week = call("POST", "/portfolio/weeks", {"for_date": "2026-11-02T00:00:00"})
    wid = week["id"]
    call("GET", "/portfolio/weeks")
    call("GET", f"/portfolio/weeks/{wid}")
    call("GET", "/portfolio/weeks/9999")
    call("PATCH", f"/portfolio/weeks/{wid}", {"account_value": 50000, "notes": "week one",
                                               "acct_label_1": "IBKR", "acct_val_1": 30000})
    call("PATCH", "/portfolio/weeks/9999", {"notes": "x"})

    # ── Holdings + positions ──────────────────────────────────────────────────
    hold = call("POST", "/portfolio/holdings", {"symbol": "aapl", "shares": 100, "cost_basis": 15000,
                                                "company_name": "Apple"})
    hid = hold["id"]
    call("POST", "/portfolio/holdings", {"symbol": "", "shares": 1}, name="POST holdings invalid")
    p1 = call("POST", f"/portfolio/weeks/{wid}/positions", {
        "symbol": "AAPL", "contracts": 1, "strike": 160, "option_type": "CALL",
        "sold_date": "2026-11-03T00:00:00", "expiry_date": "2026-11-07T00:00:00",
        "premium_in": 2.5, "spot_price": 155, "holding_id": hid})["id"]
    p2 = call("POST", f"/portfolio/weeks/{wid}/positions", {
        "symbol": "MSFT", "contracts": 2, "strike": 400, "option_type": "PUT",
        "sold_date": "2026-11-03T00:00:00", "expiry_date": "2026-11-07T00:00:00", "premium_in": 3.0})["id"]
    call("POST", "/portfolio/weeks/9999/positions", {"symbol": "X", "strike": 1, "option_type": "CALL"})
    call("GET", f"/portfolio/weeks/{wid}/positions")
    call("GET", "/portfolio/positions")
    call("PATCH", f"/portfolio/positions/{p1}", {"premium_out": 0.5, "status": "CLOSED"})
    call("PATCH", "/portfolio/positions/9999", {"notes": "x"})

    # ── Assignments ───────────────────────────────────────────────────────────
    a = call("POST", f"/portfolio/positions/{p2}/assign", {"symbol": "MSFT", "shares_acquired": 200,
                                                          "acquisition_price": 400, "net_option_premium": 600})
    call("GET", f"/portfolio/positions/{p2}/assignment")
    call("GET", f"/portfolio/positions/{p1}/assignment")
    call("PATCH", f"/portfolio/assignments/{a['id']}", {"notes": "assigned"})
    call("PATCH", "/portfolio/assignments/9999", {"notes": "x"})

    # ── Summaries, holdings, ledger ───────────────────────────────────────────
    call("GET", "/portfolio/summary")
    call("GET", "/portfolio/symbols")
    call("POST", "/portfolio/holdings/seed-from-positions")
    call("POST", "/portfolio/holdings/recalculate")
    call("POST", "/portfolio/holdings/sync-ledger")
    call("GET", "/portfolio/holdings")
    call("PATCH", f"/portfolio/holdings/{hid}", {"notes": "core position"})
    call("PATCH", "/portfolio/holdings/9999", {"notes": "x"})
    call("GET", f"/portfolio/holdings/{hid}/events")
    call("GET", "/portfolio/premium-dashboard")
    call("GET", f"/portfolio/holdings/{hid}/premium-ledger")

    # ── Week completion ───────────────────────────────────────────────────────
    call("POST", f"/portfolio/weeks/{wid}/complete", {"account_value": 51000})
    call("POST", f"/portfolio/weeks/{wid}/reopen")
    call("POST", "/portfolio/weeks/9999/reopen")
    call("POST", "/portfolio/weeks/9999/complete", {})

    # ── Value history ─────────────────────────────────────────────────────────
    call("POST", "/portfolio/value-history", {"snapshot_date": "2026-11-06T00:00:00", "total_value": 51000,
                                              "cash": 1000, "realized_pnl": 250})
    call("GET", "/portfolio/value-history")

    # ── Broker accounts, balances, deposits ───────────────────────────────────
    acct = call("POST", "/portfolio/broker-accounts", {"name": "IBKR", "color": "#123456", "sort_order": 1})
    call("GET", "/portfolio/broker-accounts")
    call("PATCH", f"/portfolio/broker-accounts/{acct['id']}", {"name": "IBKR Pro"})
    call("PATCH", "/portfolio/broker-accounts/9999", {"name": "x"})
    call("PUT", "/portfolio/account-balances", {"account_id": acct["id"], "week_date": "2026-11-06", "balance": 1234.5})
    call("PUT", "/portfolio/account-balances", {"week_date": "2026-11-06"}, name="PUT account-balances missing")
    call("GET", "/portfolio/account-balances/years")
    call("GET", "/portfolio/account-balances", params={"year": 2026})
    call("GET", "/portfolio/account-balances/all")
    call("DELETE", f"/portfolio/account-balances/{acct['id']}/2026-11-06")
    dep = call("PUT", "/portfolio/cash-deposits", {"week_date": "2026-11-06", "amount": 1000, "note": "deposit"})
    call("PUT", "/portfolio/cash-deposits", {"id": dep["id"], "week_date": "2026-11-06", "amount": 1500, "note": "edited"})
    call("PUT", "/portfolio/cash-deposits", {"amount": 5}, name="PUT cash-deposits missing")
    call("GET", "/portfolio/cash-deposits")
    call("DELETE", f"/portfolio/cash-deposits/{dep['id']}")
    call("DELETE", "/portfolio/cash-deposits/9999")
    call("DELETE", f"/portfolio/broker-accounts/{acct['id']}")
    call("DELETE", "/portfolio/broker-accounts/9999")

    # ── Deletes ───────────────────────────────────────────────────────────────
    call("DELETE", f"/portfolio/positions/{p1}")
    call("DELETE", "/portfolio/positions/9999")
    call("DELETE", f"/portfolio/holdings/{hid}")
    call("DELETE", "/portfolio/holdings/9999")

    # ── Accounts (trades) ─────────────────────────────────────────────────────
    acc = call("POST", "/accounts", {"name": "Main", "broker": "IBKR", "currency": "usd"})
    call("GET", "/accounts")
    hh = call("PUT", f"/accounts/{acc['id']}/holdings", {"symbol": "spy", "quantity": 10, "avg_cost": 500})
    call("GET", f"/accounts/{acc['id']}/holdings")
    call("GET", "/accounts/9999/holdings")
    call("DELETE", f"/holdings/{hh['id']}")
    call("DELETE", f"/holdings/{hh['id']}", name="DELETE holdings again")

    # ── Budget: cash ──────────────────────────────────────────────────────────
    cash = call("POST", "/cash", {"action": "DEPOSIT", "amount": 1000, "date": "2026-11-02T00:00:00", "notes": "pay"})
    call("POST", "/cash", {"action": "WITHDRAW", "amount": 200, "date": "2026-11-03T00:00:00"})
    call("GET", "/cash")
    call("GET", "/cash/balance")
    call("PATCH", f"/cash/{cash['id']}", {"amount": 1500})
    call("PATCH", "/cash/9999", {"amount": 1})
    call("GET", "/ledger/cash-balance")
    call("GET", "/ledger/entries")
    call("DELETE", f"/cash/{cash['id']}")
    call("DELETE", "/cash/9999")

    # ── Budget entries + overrides ────────────────────────────────────────────
    rent = call("POST", "/budget", {"category": "Rent", "type": "EXPENSE", "entry_type": "RECURRING",
                                    "recurrence": "MONTHLY", "amount": 1500, "date": "2026-11-01T00:00:00",
                                    "description": "rent", "merchant": "Landlord"})
    call("POST", "/budget", {"category": "Salary", "type": "INCOME", "amount": 6000,
                             "date": "2026-11-01T00:00:00", "description": "pay"})
    call("POST", "/budget", {"category": "X", "type": "BOGUS", "amount": 1, "date": "2026-11-01T00:00:00"},
         name="POST budget invalid type")
    call("GET", "/budget")
    call("GET", "/budget/summary")
    call("PATCH", f"/budget/{rent['id']}", {"category": "Rent", "type": "EXPENSE", "amount": 1550,
                                            "date": "2026-11-01T00:00:00", "description": "rent up"})
    ov = call("POST", "/budget-overrides", {"budget_id": rent["id"], "month_key": "2026-12", "amount": 1600})
    call("GET", "/budget-overrides")
    call("DELETE", f"/budget-overrides/{ov['id']}")

    # ── Credit card weeks ─────────────────────────────────────────────────────
    cc = call("POST", "/credit-card/weeks", {"week_start": "2026-11-02T00:00:00", "balance": 500, "card_name": "Amex"})
    call("GET", "/credit-card/weeks")
    call("PATCH", f"/credit-card/weeks/{cc['id']}", {"week_start": "2026-11-02T00:00:00", "balance": 450,
                                                     "squared_off": True, "paid_amount": 450, "card_name": "Amex"})
    call("GET", "/credit-card/weeks", name="GET credit-card/weeks after patch")
    call("DELETE", f"/credit-card/weeks/{cc['id']}")
    call("DELETE", f"/budget/{rent['id']}")
    call("GET", "/budget", name="GET budget after delete")
    return log


@pytest.fixture
def fresh_db():
    engine = make_memory_engine()
    core_db.use_engine(engine)
    try:
        yield
    finally:
        core_db.use_engine(None)
        engine.dispose()


@pytest.mark.parametrize("prefix", PREFIXES, ids=lambda p: p or "legacy")
def test_portfolio_and_budget_routes_match_golden(prefix, fresh_db):
    log = run_scenario(prefix)
    if os.environ.get("UPDATE_GOLDEN") and prefix == "":
        GOLDEN.parent.mkdir(exist_ok=True)
        GOLDEN.write_text(json.dumps(log, indent=1, sort_keys=True) + "\n")
    expected = json.loads(GOLDEN.read_text())
    assert [s["step"] for s in log] == [s["step"] for s in expected]
    for got, want in zip(log, expected):
        if prefix and want["status"] == 422:
            # /api/v1 reports validation errors as one message, not FastAPI's list
            assert got["status"] == 422, got["step"]
            continue
        assert got == want, f"{got['step']} differs"
