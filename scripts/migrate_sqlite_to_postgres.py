"""One-shot helper to migrate SQLite tables to Postgres.

Usage:
    python3 scripts/migrate_sqlite_to_postgres.py --pg "postgresql://user:pass@host:5432/dbname"

This script reads tables `users`, `trades`, `cash_flow`, `budget` from the local
`trading_journal.db` (repo root) and appends them into the provided Postgres DB.
Be careful when running against a production DB — run on a staging copy first.
"""
import argparse
import pandas as pd
import sqlalchemy
from pathlib import Path


def main(pg_url: str):
    repo_root = Path(__file__).resolve().parent.parent
    sqlite_path = repo_root / 'trading_journal.db'
    if not sqlite_path.exists():
        print('No local sqlite DB found at', sqlite_path)
        return

    sqlite_url = f'sqlite:///{sqlite_path}'
    sqlite_eng = sqlalchemy.create_engine(sqlite_url)
    pg_eng = sqlalchemy.create_engine(pg_url)

    tables = ['users', 'trades', 'cash_flow', 'budget']
    for tbl in tables:
        try:
            df = pd.read_sql_table(tbl, sqlite_eng)
        except Exception as e:
            print(f'Skipping {tbl}: {e}')
            continue
        if df.empty:
            print(f'No rows in {tbl}, skipping')
            continue
        # Write to Postgres (append)
        df.to_sql(tbl, pg_eng, if_exists='append', index=False)
        print(f'Migrated {len(df)} rows to {tbl}')


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--pg', required=True, help='Postgres connection URL')
    args = p.parse_args()
    main(args.pg)
