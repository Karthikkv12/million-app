#!/usr/bin/env python3
"""
Seed script for broker accounts and 2025 historical account balances.
Run from project root: python scripts/seed_broker_accounts.py
"""
import sys, os
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.models import (
    get_portfolio_session, BrokerAccount, AccountBalance, WeeklySnapshot
)
from datetime import datetime

USER_ID = 1

# ── Broker accounts to create ────────────────────────────────────────────────
ACCOUNTS = [
    {"name": "ROB Kar",   "color": "#00C805", "sort_order": 1},
    {"name": "ROB K-IRA", "color": "#7B61FF", "sort_order": 2},
    {"name": "ROB Bal",   "color": "#FF6B35", "sort_order": 3},
    {"name": "ROB Pooh",  "color": "#00B4D8", "sort_order": 4},
    {"name": "SCHWAB",    "color": "#1DB954", "sort_order": 5},
    {"name": "CHASE",     "color": "#117ACA", "sort_order": 6},
]

# ── 2025 weekly balance data ──────────────────────────────────────────────────
# Each entry: (friday_date_str, {account_name: balance})
BALANCES_2025 = [
    ("2025-02-28", {"ROB K-IRA": 26799, "CHASE": 4934}),
    ("2025-03-07", {"ROB K-IRA": 25304, "CHASE": 5396}),
    ("2025-03-14", {"ROB K-IRA": 22990, "CHASE": 5910}),
    ("2025-03-21", {"ROB K-IRA": 24740, "CHASE": 6494}),
    ("2025-03-28", {"ROB K-IRA": 24899, "CHASE": 10661}),
    ("2025-04-04", {"ROB K-IRA": 20354, "CHASE": 14840}),
    ("2025-04-11", {"CHASE": 15380}),
    ("2025-04-18", {"ROB Kar": 2561,  "CHASE": 16276}),
    ("2025-04-25", {"ROB Kar": 22995, "CHASE": 137}),
    ("2025-05-02", {"ROB Kar": 25070}),
    ("2025-05-09", {"ROB Kar": 22800}),
    ("2025-05-16", {"ROB Kar": 24468}),
    ("2025-05-23", {"ROB Kar": 24950, "ROB K-IRA": 23630}),
    ("2025-05-30", {"ROB Kar": 29590, "ROB K-IRA": 23830}),
    ("2025-06-06", {"ROB Kar": 30700, "ROB K-IRA": 23830}),
    ("2025-06-13", {"ROB Kar": 30700, "ROB K-IRA": 26600}),
    ("2025-06-20", {"ROB Kar": 33982, "ROB K-IRA": 28177}),
    ("2025-06-27", {"ROB Kar": 34090, "ROB K-IRA": 30250}),
    ("2025-07-04", {"ROB Kar": 36856, "ROB K-IRA": 32030}),
    ("2025-07-11", {"ROB Kar": 36378, "ROB K-IRA": 32112}),
    ("2025-07-18", {"ROB Kar": 41711, "ROB K-IRA": 35521}),
    ("2025-07-25", {"ROB Kar": 45356, "ROB K-IRA": 34602}),
    ("2025-08-01", {"ROB Kar": 41150, "ROB K-IRA": 33400}),
    ("2025-08-08", {"ROB Kar": 41468, "ROB K-IRA": 35681}),
    ("2025-08-15", {"ROB Kar": 39889, "ROB K-IRA": 36260}),
    ("2025-08-22", {"ROB Kar": 40345, "ROB K-IRA": 37098}),
    ("2025-08-29", {"ROB Kar": 40166, "ROB K-IRA": 37125}),
    ("2025-09-05", {"ROB Kar": 40187, "ROB K-IRA": 37217}),
    ("2025-09-12", {"ROB Kar": 40187, "ROB K-IRA": 37217}),
    ("2025-09-19", {"ROB Kar": 50000, "ROB K-IRA": 32000}),
    ("2025-09-26", {"ROB Kar": 73500, "ROB K-IRA": 9500}),
    ("2025-10-03", {"ROB Kar": 77553, "ROB K-IRA": 9260}),
    ("2025-10-10", {"ROB Kar": 79515, "ROB K-IRA": 10322}),
    ("2025-10-17", {"ROB Kar": 78000, "ROB K-IRA": 11300}),
    ("2025-10-24", {"ROB Kar": 76326, "ROB K-IRA": 9500}),
    ("2025-10-31", {"ROB Kar": 87800, "ROB K-IRA": 8800}),
    ("2025-11-07", {"ROB Kar": 77233, "ROB K-IRA": 6350}),
    ("2025-11-14", {"ROB Kar": 61000, "ROB K-IRA": 2000}),
    ("2025-11-21", {"ROB Kar": 42000, "ROB K-IRA": 850}),
    ("2025-11-28", {"ROB Kar": 38000}),
    ("2025-12-05", {"ROB Kar": 36000}),
    ("2025-12-12", {"ROB Kar": 28000}),
    ("2025-12-19", {"ROB Kar": 30000}),
    ("2025-12-26", {"ROB Kar": 30000}),
]


def get_or_create_week(session, user_id: int, friday: date) -> WeeklySnapshot:
    """Find or create a WeeklySnapshot row for the given Friday (week_end)."""
    # week_start = Monday (4 days before Friday)
    monday = friday - timedelta(days=4)
    snap = (
        session.query(WeeklySnapshot)
        .filter(
            WeeklySnapshot.user_id == user_id,
            WeeklySnapshot.week_end == datetime(friday.year, friday.month, friday.day),
        )
        .first()
    )
    if not snap:
        snap = WeeklySnapshot(
            user_id=user_id,
            week_start=datetime(monday.year, monday.month, monday.day),
            week_end=datetime(friday.year, friday.month, friday.day),
            is_complete=False,
            created_at=datetime.utcnow(),
        )
        session.add(snap)
        session.flush()
        print(f"  Created WeeklySnapshot for {friday} (Mon={monday})")
    return snap


def main():
    session = get_portfolio_session()
    try:
        # ── 1. Create broker accounts (skip if already exist) ────────────────
        print("=== Creating broker accounts ===")
        acct_map: dict[str, int] = {}  # name → id

        for acct_def in ACCOUNTS:
            existing = (
                session.query(BrokerAccount)
                .filter_by(user_id=USER_ID, name=acct_def["name"])
                .first()
            )
            if existing:
                acct_map[acct_def["name"]] = existing.id
                print(f"  Already exists: {acct_def['name']} (id={existing.id})")
            else:
                new_acct = BrokerAccount(
                    user_id=USER_ID,
                    name=acct_def["name"],
                    color=acct_def["color"],
                    sort_order=acct_def["sort_order"],
                    is_active=True,
                    created_at=datetime.utcnow(),
                )
                session.add(new_acct)
                session.flush()
                acct_map[acct_def["name"]] = new_acct.id
                print(f"  Created: {acct_def['name']} (id={new_acct.id})")

        # ── 2. Seed 2025 balance rows ────────────────────────────────────────
        print("\n=== Seeding 2025 account balances ===")

        for week_date_str, balances in BALANCES_2025:
            week_date = date.fromisoformat(week_date_str)

            # Ensure WeeklySnapshot exists for this Friday
            get_or_create_week(session, USER_ID, week_date)

            for acct_name, balance in balances.items():
                acct_id = acct_map.get(acct_name)
                if acct_id is None:
                    print(f"  WARNING: Unknown account '{acct_name}', skipping")
                    continue

                existing_bal = (
                    session.query(AccountBalance)
                    .filter_by(account_id=acct_id, week_date=week_date)
                    .first()
                )
                if existing_bal:
                    existing_bal.balance = balance
                    print(f"  Updated  {week_date_str} | {acct_name}: ${balance:,.0f}")
                else:
                    new_bal = AccountBalance(
                        user_id=USER_ID,
                        account_id=acct_id,
                        week_date=week_date,
                        balance=float(balance),
                    )
                    session.add(new_bal)
                    print(f"  Inserted {week_date_str} | {acct_name}: ${balance:,.0f}")

        # ── 3. Recompute account_value on WeeklySnapshots for 2025 ───────────
        print("\n=== Recomputing weekly totals ===")
        for week_date_str, _ in BALANCES_2025:
            week_date = date.fromisoformat(week_date_str)
            rows = (
                session.query(AccountBalance)
                .filter_by(user_id=USER_ID, week_date=week_date)
                .all()
            )
            total = sum(float(r.balance) for r in rows)

            # WeeklySnapshot stores friday as week_end (DateTime), not week_start
            snap = (
                session.query(WeeklySnapshot)
                .filter(
                    WeeklySnapshot.user_id == USER_ID,
                    WeeklySnapshot.week_end == datetime(week_date.year, week_date.month, week_date.day),
                )
                .first()
            )
            if snap:
                snap.account_value = total
                print(f"  {week_date_str}: account_value = ${total:,.0f}")
            else:
                print(f"  WARNING: No WeeklySnapshot for {week_date_str} (looked up as week_end)")

        session.commit()
        print("\n✅ Seed complete!")

    except Exception as e:
        session.rollback()
        print(f"\n❌ Error: {e}")
        raise
    finally:
        session.close()


if __name__ == "__main__":
    main()
