"""
scripts/migrate_to_split_dbs.py

Migrates all data from the old monolithic trading_journal.db
into the new split databases:
  users.db, trades.db, portfolio.db, budget.db, markets.db

Safe to run multiple times (uses INSERT OR IGNORE).
Run from project root:
    python scripts/migrate_to_split_dbs.py
"""
import os, sys, sqlite3
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

SRC = os.path.join(os.path.dirname(__file__), "..", "trading_journal.db")

def migrate():
    if not os.path.exists(SRC):
        print(f"Source not found: {SRC}")
        return

    # Initialise all 5 new DBs first (create tables if not exist)
    from database.models import init_db
    init_db()
    print("✅ All 5 DBs initialised")

    src = sqlite3.connect(SRC)
    src.row_factory = sqlite3.Row

    # ── USERS DB ─────────────────────────────────────────────────────────────
    users_db = sqlite3.connect("users.db")

    # users
    rows = src.execute("SELECT * FROM users").fetchall()
    for r in rows:
        users_db.execute("""
            INSERT OR IGNORE INTO users
              (id, username, password_hash, salt, created_at, auth_valid_after, role, is_active)
            VALUES (?,?,?,?,?,?,?,?)
        """, (r["id"], r["username"], r["password_hash"], r["salt"],
              r["created_at"], r["auth_valid_after"], r["role"], r["is_active"]))
    users_db.commit()
    print(f"  users: {len(rows)} rows migrated")

    # refresh_tokens
    rows = src.execute("SELECT * FROM refresh_tokens").fetchall()
    for r in rows:
        users_db.execute("""
            INSERT OR IGNORE INTO refresh_tokens
              (id, user_id, token_hash, created_at, created_ip, created_user_agent,
               last_used_at, last_used_ip, last_used_user_agent, expires_at,
               revoked_at, revoked_reason, replaced_by_token_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (r["id"], r["user_id"], r["token_hash"], r["created_at"],
              r["created_ip"], r["created_user_agent"], r["last_used_at"],
              r["last_used_ip"], r["last_used_user_agent"], r["expires_at"],
              r["revoked_at"], r["revoked_reason"], r["replaced_by_token_id"]))
    users_db.commit()
    print(f"  refresh_tokens: {len(rows)} rows migrated")

    # revoked_tokens
    rows = src.execute("SELECT * FROM revoked_tokens").fetchall()
    for r in rows:
        users_db.execute("""
            INSERT OR IGNORE INTO revoked_tokens (id, user_id, jti, revoked_at, expires_at)
            VALUES (?,?,?,?,?)
        """, (r["id"], r["user_id"], r["jti"], r["revoked_at"], r["expires_at"]))
    users_db.commit()
    print(f"  revoked_tokens: {len(rows)} rows migrated")

    # auth_events
    rows = src.execute("SELECT * FROM auth_events").fetchall()
    for r in rows:
        users_db.execute("""
            INSERT OR IGNORE INTO auth_events
              (id, created_at, event_type, success, username, user_id, ip, user_agent, detail)
            VALUES (?,?,?,?,?,?,?,?,?)
        """, (r["id"], r["created_at"], r["event_type"], r["success"],
              r["username"], r["user_id"], r["ip"], r["user_agent"], r["detail"]))
    users_db.commit()
    print(f"  auth_events: {len(rows)} rows migrated")
    users_db.close()

    # ── TRADES DB ─────────────────────────────────────────────────────────────
    trades_db = sqlite3.connect("trades.db")

    # accounts
    rows = src.execute("SELECT * FROM accounts").fetchall()
    for r in rows:
        trades_db.execute("""
            INSERT OR IGNORE INTO accounts (id, user_id, name, broker, currency, created_at)
            VALUES (?,?,?,?,?,?)
        """, (r["id"], r["user_id"], r["name"], r["broker"], r["currency"], r["created_at"]))
    trades_db.commit()
    print(f"  accounts: {len(rows)} rows migrated")

    # trades
    rows = src.execute("SELECT * FROM trades").fetchall()
    cols = [d[0] for d in src.execute("PRAGMA table_info(trades)").fetchall()]
    for r in rows:
        trades_db.execute("""
            INSERT OR IGNORE INTO trades
              (id, user_id, symbol, quantity, instrument, strategy, action,
               entry_date, entry_price, is_closed, exit_date, exit_price,
               realized_pnl, option_type, strike_price, expiry_date, client_order_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (r["id"], r["user_id"], r["symbol"], r["quantity"],
              r["instrument"], r["strategy"], r["action"],
              r["entry_date"], r["entry_price"], r["is_closed"],
              r["exit_date"], r["exit_price"], r["realized_pnl"],
              r["option_type"], r["strike_price"], r["expiry_date"],
              r["client_order_id"]))
    trades_db.commit()
    print(f"  trades: {len(rows)} rows migrated")

    # orders
    rows = src.execute("SELECT * FROM orders").fetchall()
    for r in rows:
        trades_db.execute("""
            INSERT OR IGNORE INTO orders
              (id, user_id, symbol, instrument, action, strategy, quantity, limit_price,
               status, created_at, filled_at, filled_price, trade_id, client_order_id,
               external_order_id, venue, external_status, last_synced_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (r["id"], r["user_id"], r["symbol"], r["instrument"], r["action"],
              r["strategy"], r["quantity"], r["limit_price"], r["status"],
              r["created_at"], r["filled_at"], r["filled_price"], r["trade_id"],
              r["client_order_id"], r["external_order_id"], r["venue"],
              r["external_status"], r["last_synced_at"]))
    trades_db.commit()
    print(f"  orders: {len(rows)} rows migrated")

    # order_events
    rows = src.execute("SELECT * FROM order_events").fetchall()
    for r in rows:
        trades_db.execute("""
            INSERT OR IGNORE INTO order_events
              (id, created_at, user_id, order_id, event_type, order_status, external_status, note)
            VALUES (?,?,?,?,?,?,?,?)
        """, (r["id"], r["created_at"], r["user_id"], r["order_id"],
              r["event_type"], r["order_status"], r["external_status"], r["note"]))
    trades_db.commit()
    print(f"  order_events: {len(rows)} rows migrated")
    trades_db.close()

    # ── PORTFOLIO DB ──────────────────────────────────────────────────────────
    portfolio_db = sqlite3.connect("portfolio.db")

    # stock_holdings (migrate from old stock_holdings)
    rows = src.execute("SELECT * FROM stock_holdings").fetchall()
    for r in rows:
        portfolio_db.execute("""
            INSERT OR IGNORE INTO stock_holdings
              (id, user_id, symbol, company_name, shares, cost_basis, adjusted_cost_basis,
               acquired_date, status, notes, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        """, (r["id"], r["user_id"], r["symbol"], r["company_name"],
              r["shares"], r["cost_basis"], r["adjusted_cost_basis"],
              r["acquired_date"], r["status"], r["notes"],
              r["created_at"], r["updated_at"]))
    portfolio_db.commit()
    print(f"  stock_holdings: {len(rows)} rows migrated")

    # holding_events
    rows = src.execute("SELECT * FROM holding_events").fetchall()
    for r in rows:
        portfolio_db.execute("""
            INSERT OR IGNORE INTO holding_events
              (id, user_id, holding_id, position_id, event_type, shares_delta,
               basis_delta, realized_gain, description, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?)
        """, (r["id"], r["user_id"], r["holding_id"], r["position_id"],
              r["event_type"], r["shares_delta"], r["basis_delta"],
              r["realized_gain"], r["description"], r["created_at"]))
    portfolio_db.commit()
    print(f"  holding_events: {len(rows)} rows migrated")

    # weekly_snapshots
    rows = src.execute("SELECT * FROM weekly_snapshots").fetchall()
    for r in rows:
        portfolio_db.execute("""
            INSERT OR IGNORE INTO weekly_snapshots
              (id, user_id, week_start, week_end, account_value, is_complete,
               completed_at, notes, created_at)
            VALUES (?,?,?,?,?,?,?,?,?)
        """, (r["id"], r["user_id"], r["week_start"], r["week_end"],
              r["account_value"], r["is_complete"], r["completed_at"],
              r["notes"], r["created_at"]))
    portfolio_db.commit()
    print(f"  weekly_snapshots: {len(rows)} rows migrated")

    # option_positions
    rows = src.execute("SELECT * FROM option_positions").fetchall()
    for r in rows:
        portfolio_db.execute("""
            INSERT OR IGNORE INTO option_positions
              (id, user_id, week_id, holding_id, symbol, contracts, strike, option_type,
               sold_date, buy_date, expiry_date, premium_in, premium_out, spot_price,
               is_roll, status, rolled_to_id, carried_from_id, margin, notes,
               created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (r["id"], r["user_id"], r["week_id"],
              r["holding_id"] if "holding_id" in r.keys() else None,
              r["symbol"], r["contracts"], r["strike"], r["option_type"],
              r["sold_date"], r["buy_date"], r["expiry_date"],
              r["premium_in"], r["premium_out"],
              r["spot_price"] if "spot_price" in r.keys() else None,
              r["is_roll"], r["status"], r["rolled_to_id"], r["carried_from_id"],
              r["margin"], r["notes"], r["created_at"], r["updated_at"]))
    portfolio_db.commit()
    print(f"  option_positions: {len(rows)} rows migrated")

    # premium_ledger
    rows = src.execute("SELECT * FROM premium_ledger").fetchall()
    for r in rows:
        portfolio_db.execute("""
            INSERT OR IGNORE INTO premium_ledger
              (id, user_id, holding_id, position_id, symbol, week_id, option_type,
               strike, contracts, expiry_date, premium_sold, realized_premium,
               unrealized_premium, status, notes, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (r["id"], r["user_id"], r["holding_id"], r["position_id"],
              r["symbol"], r["week_id"], r["option_type"], r["strike"],
              r["contracts"], r["expiry_date"], r["premium_sold"],
              r["realized_premium"], r["unrealized_premium"], r["status"],
              r["notes"], r["created_at"], r["updated_at"]))
    portfolio_db.commit()
    print(f"  premium_ledger: {len(rows)} rows migrated")

    # stock_assignments
    rows = src.execute("SELECT * FROM stock_assignments").fetchall()
    for r in rows:
        portfolio_db.execute("""
            INSERT OR IGNORE INTO stock_assignments
              (id, user_id, position_id, symbol, shares_acquired, acquisition_price,
               additional_buys, covered_calls, net_option_premium, notes,
               created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        """, (r["id"], r["user_id"], r["position_id"], r["symbol"],
              r["shares_acquired"], r["acquisition_price"],
              r["additional_buys"], r["covered_calls"], r["net_option_premium"],
              r["notes"], r["created_at"], r["updated_at"]))
    portfolio_db.commit()
    print(f"  stock_assignments: {len(rows)} rows migrated")
    portfolio_db.close()

    # ── BUDGET DB ─────────────────────────────────────────────────────────────
    budget_db = sqlite3.connect("budget.db")

    # budget
    rows = src.execute("SELECT * FROM budget").fetchall()
    for r in rows:
        budget_db.execute("""
            INSERT OR IGNORE INTO budget
              (id, user_id, category, type, entry_type, recurrence, amount,
               date, description, merchant, active_until)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
        """, (r["id"], r["user_id"], r["category"], r["type"],
              r["entry_type"], r["recurrence"], r["amount"],
              r["date"], r["description"], r["merchant"], r["active_until"]))
    budget_db.commit()
    print(f"  budget: {len(rows)} rows migrated")

    # budget_overrides
    rows = src.execute("SELECT * FROM budget_overrides").fetchall()
    for r in rows:
        budget_db.execute("""
            INSERT OR IGNORE INTO budget_overrides
              (id, user_id, budget_id, month_key, amount, description, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?)
        """, (r["id"], r["user_id"], r["budget_id"], r["month_key"],
              r["amount"], r["description"], r["created_at"], r["updated_at"]))
    budget_db.commit()
    print(f"  budget_overrides: {len(rows)} rows migrated")

    # credit_card_weeks
    rows = src.execute("SELECT * FROM credit_card_weeks").fetchall()
    for r in rows:
        budget_db.execute("""
            INSERT OR IGNORE INTO credit_card_weeks
              (id, user_id, week_start, card_name, balance, squared_off,
               paid_amount, note, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?)
        """, (r["id"], r["user_id"], r["week_start"], r["card_name"],
              r["balance"], r["squared_off"], r["paid_amount"],
              r["note"], r["created_at"], r["updated_at"]))
    budget_db.commit()
    print(f"  credit_card_weeks: {len(rows)} rows migrated")

    # cash_flow
    rows = src.execute("SELECT * FROM cash_flow").fetchall()
    for r in rows:
        budget_db.execute("""
            INSERT OR IGNORE INTO cash_flow (id, user_id, action, amount, date, notes)
            VALUES (?,?,?,?,?,?)
        """, (r["id"], r["user_id"], r["action"], r["amount"], r["date"], r["notes"]))
    budget_db.commit()
    print(f"  cash_flow: {len(rows)} rows migrated")

    # ledger_accounts
    rows = src.execute("SELECT * FROM ledger_accounts").fetchall()
    for r in rows:
        budget_db.execute("""
            INSERT OR IGNORE INTO ledger_accounts (id, user_id, name, type, currency, created_at)
            VALUES (?,?,?,?,?,?)
        """, (r["id"], r["user_id"], r["name"], r["type"], r["currency"], r["created_at"]))
    budget_db.commit()
    print(f"  ledger_accounts: {len(rows)} rows migrated")

    # ledger_entries
    rows = src.execute("SELECT * FROM ledger_entries").fetchall()
    for r in rows:
        budget_db.execute("""
            INSERT OR IGNORE INTO ledger_entries
              (id, user_id, entry_type, created_at, effective_at, description,
               idempotency_key, source_type, source_id)
            VALUES (?,?,?,?,?,?,?,?,?)
        """, (r["id"], r["user_id"], r["entry_type"], r["created_at"],
              r["effective_at"], r["description"], r["idempotency_key"],
              r["source_type"], r["source_id"]))
    budget_db.commit()
    print(f"  ledger_entries: {len(rows)} rows migrated")

    # ledger_lines
    rows = src.execute("SELECT * FROM ledger_lines").fetchall()
    for r in rows:
        budget_db.execute("""
            INSERT OR IGNORE INTO ledger_lines (id, entry_id, account_id, amount, memo)
            VALUES (?,?,?,?,?)
        """, (r["id"], r["entry_id"], r["account_id"], r["amount"], r["memo"]))
    budget_db.commit()
    print(f"  ledger_lines: {len(rows)} rows migrated")
    budget_db.close()

    # ── MARKETS DB ────────────────────────────────────────────────────────────
    markets_db = sqlite3.connect("markets.db")

    rows = src.execute("SELECT * FROM net_flow_snapshots").fetchall()
    for r in rows:
        markets_db.execute("""
            INSERT OR IGNORE INTO net_flow_snapshots
              (id, symbol, ts, price, call_prem, put_prem, net_flow, total_prem, volume)
            VALUES (?,?,?,?,?,?,?,?,?)
        """, (r["id"], r["symbol"], r["ts"], r["price"], r["call_prem"],
              r["put_prem"], r["net_flow"], r["total_prem"], r["volume"]))
    markets_db.commit()
    print(f"  net_flow_snapshots: {len(rows)} rows migrated")
    markets_db.close()

    src.close()
    print("\n✅ Migration complete. All data is now in the split databases.")
    print("   users.db / trades.db / portfolio.db / budget.db / markets.db")


if __name__ == "__main__":
    migrate()
