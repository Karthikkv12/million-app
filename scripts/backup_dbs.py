#!/usr/bin/env python3
"""
Automated backup script for all OptionFlow SQLite databases.

Usage:
    python3 scripts/backup_dbs.py

Cron (daily at midnight):
    0 0 * * * cd /Users/karthikkondajjividyaranya/Desktop/OptionFlow_main && .venv/bin/python3 scripts/backup_dbs.py >> /tmp/optionflow_backup.log 2>&1
"""

import os
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKUP_DIR   = PROJECT_ROOT / "backups"
KEEP_DAILY   = 7    # keep last 7 daily backups
KEEP_WEEKLY  = 4    # keep last 4 weekly backups (Sundays)
KEEP_MONTHLY = 12   # keep last 12 monthly backups (1st of month)

DB_FILES = [
    "users.db",
    "trades.db",
    "portfolio.db",
    "budget.db",
    "markets.db",
    "trading_journal.db",  # legacy source — keep backed up too
]

# ── Helpers ───────────────────────────────────────────────────────────────────
def log(msg: str):
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}")


def backup_tag(now: datetime) -> str:
    """Return a tag: daily_YYYY-MM-DD, weekly_YYYY-WNN, monthly_YYYY-MM."""
    if now.day == 1:
        return f"monthly_{now.strftime('%Y-%m')}"
    if now.weekday() == 6:  # Sunday
        week_num = now.isocalendar()[1]
        return f"weekly_{now.strftime('%Y')}-W{week_num:02d}"
    return f"daily_{now.strftime('%Y-%m-%d')}"


def safe_copy(src: Path, dst: Path):
    """Copy a SQLite DB safely using the backup API (no corruption)."""
    if not src.exists():
        log(f"  SKIP {src.name} — not found")
        return False
    if src.stat().st_size == 0:
        log(f"  SKIP {src.name} — empty file")
        return False
    try:
        # Use SQLite's online backup API to avoid copying a mid-write DB
        src_conn = sqlite3.connect(str(src))
        dst_conn = sqlite3.connect(str(dst))
        src_conn.backup(dst_conn)
        src_conn.close()
        dst_conn.close()
        size_kb = dst.stat().st_size // 1024
        log(f"  OK   {src.name} → {dst.name} ({size_kb} KB)")
        return True
    except Exception as e:
        log(f"  FAIL {src.name}: {e}")
        # Fallback to plain copy
        shutil.copy2(str(src), str(dst))
        return True


def prune(backup_root: Path, prefix: str, keep: int):
    """Remove oldest backups of a given prefix, keeping only `keep` most recent."""
    dirs = sorted(
        [d for d in backup_root.iterdir() if d.is_dir() and d.name.startswith(prefix)],
        reverse=True,
    )
    for old in dirs[keep:]:
        shutil.rmtree(str(old))
        log(f"  PRUNED {old.name}")


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    now = datetime.now()
    tag = backup_tag(now)
    slot_dir = BACKUP_DIR / tag
    slot_dir.mkdir(parents=True, exist_ok=True)

    log(f"=== OptionFlow DB Backup — {tag} ===")
    log(f"Destination: {slot_dir}")

    copied = 0
    for db_name in DB_FILES:
        src = PROJECT_ROOT / db_name
        dst = slot_dir / db_name
        if safe_copy(src, dst):
            copied += 1

    log(f"Backed up {copied}/{len(DB_FILES)} databases.")

    # Prune old backups
    log("Pruning old backups...")
    prune(BACKUP_DIR, "daily_",   KEEP_DAILY)
    prune(BACKUP_DIR, "weekly_",  KEEP_WEEKLY)
    prune(BACKUP_DIR, "monthly_", KEEP_MONTHLY)

    log("Done.")


if __name__ == "__main__":
    main()
