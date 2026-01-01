import pandas as pd

import logic.services as services


def test_cash_flow_posts_balanced_ledger_entry(db_engine_and_session):
    _, _ = db_engine_and_session

    user_id = 1
    services.save_cash("DEPOSIT", 100.0, pd.Timestamp("2025-01-01"), "seed", user_id=user_id)

    bal = services.get_cash_balance_ledger(user_id=user_id, currency="USD")
    assert bal == 100.0

    bal2 = services.get_cash_balance(user_id=user_id, currency="USD")
    assert bal2 == 100.0

    entries = services.list_ledger_entries(user_id=user_id, limit=10)
    assert len(entries) == 1
    e = entries[0]
    assert e["entry_type"] == "CASH_DEPOSIT"
    assert e["source_type"] == "cash_flow"
    assert isinstance(e["lines"], list)
    assert len(e["lines"]) == 2
    assert round(sum(float(l["amount"]) for l in e["lines"]), 10) == 0.0


def test_cash_withdraw_posts_and_updates_balance(db_engine_and_session):
    _, _ = db_engine_and_session

    user_id = 7
    services.save_cash("DEPOSIT", 100.0, pd.Timestamp("2025-01-01"), "seed", user_id=user_id)
    services.save_cash("WITHDRAW", 40.0, pd.Timestamp("2025-01-02"), "atm", user_id=user_id)

    bal = services.get_cash_balance_ledger(user_id=user_id, currency="USD")
    assert bal == 60.0

    bal2 = services.get_cash_balance(user_id=user_id, currency="USD")
    assert bal2 == 60.0

    entries = services.list_ledger_entries(user_id=user_id, limit=10)
    assert len(entries) == 2
    assert {e["entry_type"] for e in entries} == {"CASH_DEPOSIT", "CASH_WITHDRAW"}
