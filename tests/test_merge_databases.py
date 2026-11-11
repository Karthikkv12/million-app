"""scripts/merge_databases.py on small legacy files (plan step 5)."""
import json
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "merge_databases.py"


def _legacy(dir: Path) -> None:
    """Five legacy files: a user, a week with 2 positions (one pointing at a deleted holding),
    an empty duplicate table in users.db, and a legacy-only table in trades.db."""
    from database.models import Base
    from sqlalchemy import create_engine
    owner = {"users": {"users", "auth_events", "refresh_tokens", "revoked_tokens"}, "trades": {"accounts"},
             "markets": {"net_flow_snapshots", "price_snapshots", "gex_snapshots"},
             "budget": {"budget", "budget_overrides", "cash_flow", "credit_card_weeks", "ledger_accounts", "ledger_entries", "ledger_lines"}}
    for name in ("users", "trades", "portfolio", "budget", "markets"):
        tables = [t for t in Base.metadata.sorted_tables
                  if t.name in owner.get(name, set()) or (name == "portfolio" and not any(t.name in v for v in owner.values()))]
        eng = create_engine(f"sqlite:///{dir / (name + '.db')}")
        Base.metadata.create_all(eng, tables=tables)   # legacy files had no foreign keys enforced
        eng.dispose()
    def insert(file, table, *rows):
        eng = create_engine(f"sqlite:///{dir / (file + '.db')}")
        with eng.connect() as c:
            c.exec_driver_sql("PRAGMA foreign_keys=OFF")    # legacy files never enforced foreign keys
            c.commit()
            for row in rows:
                c.execute(Base.metadata.tables[table].insert().values(**row))   # applies model defaults
            c.commit()
        eng.dispose()

    insert("users", "users", dict(id=1, username="ana", password_hash="x", role="admin"))
    con = sqlite3.connect(dir / "users.db")
    con.execute("CREATE TABLE watchlist_symbols (id INTEGER PRIMARY KEY)")      # empty stray duplicate
    con.commit(); con.close()
    from datetime import datetime
    insert("portfolio", "weekly_snapshots", dict(id=1, user_id=1, week_start=datetime(2026, 11, 2), week_end=datetime(2026, 11, 6)))
    insert("portfolio", "option_positions",
           dict(id=1, user_id=1, week_id=1, symbol="AAPL", strike=150.0, option_type="CALL"),
           dict(id=2, user_id=1, week_id=1, symbol="AAPL", strike=150.0, option_type="CALL", holding_id=99))  # holding 99 doesn't exist
    insert("portfolio", "watchlist_symbols", dict(id=1, user_id=1, symbol="AAPL"))
    con = sqlite3.connect(dir / "trades.db")
    con.execute("CREATE TABLE orders (id INTEGER PRIMARY KEY)"); con.execute("INSERT INTO orders VALUES (1)")
    con.commit(); con.close()


def _run(*args):
    return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True, cwd=ROOT)


@pytest.fixture
def legacy(tmp_path):
    src = tmp_path / "old"; src.mkdir()
    _legacy(src)
    return src, tmp_path / "optionflow.db"


def test_refuses_orphans_and_leaves_nothing(legacy):
    src, target = legacy
    r = _run("--source-dir", str(src), "--target", str(target))
    assert r.returncode != 0 and "option_positions -> stock_holdings: rows [2]" in r.stderr
    assert not target.exists()


def test_merges_with_dropped_orphans(legacy):
    src, target = legacy
    r = _run("--source-dir", str(src), "--target", str(target), "--drop-orphans")
    assert r.returncode == 0, r.stderr
    assert "Empty duplicate tables ignored: watchlist_symbols in users.db" in r.stdout
    assert "trades.orders (1 rows)" in r.stdout
    con = sqlite3.connect(target)
    assert [r[0] for r in con.execute("SELECT id FROM option_positions")] == [1]
    assert con.execute("SELECT count(*) FROM watchlist_symbols").fetchone()[0] == 1   # the non-empty copy
    assert con.execute("PRAGMA foreign_key_check").fetchall() == []
    head = con.execute("SELECT version_num FROM alembic_version").fetchone()[0]
    con.close()
    assert head == "0006_reports"
    dropped = json.loads(Path(str(target) + ".dropped.json").read_text())
    assert [(d["table"], d["row"]["id"]) for d in dropped] == [("option_positions", 2)]


def test_refuses_to_overwrite(legacy):
    src, target = legacy
    target.write_text("keep me")
    r = _run("--source-dir", str(src), "--target", str(target), "--drop-orphans")
    assert r.returncode != 0 and "refusing to overwrite" in r.stderr and target.read_text() == "keep me"
