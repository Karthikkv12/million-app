#!/usr/bin/env python3
"""Copy the five legacy SQLite files into the one OptionFlow database (plan step 5).

    python scripts/merge_databases.py --source-dir /path/to/old --target /path/to/optionflow.db
    python scripts/merge_databases.py ... --drop-orphans     # also leave out rows whose parent is gone

What it does
  1. Refuses to run if the target exists. The sources are only read.
  2. Creates the current schema (every table, real foreign keys) in the target.
  3. Copies every table from whichever source file holds it, keeping ids.
  4. Finds rows that break a foreign key ("orphans"). Without --drop-orphans it
     stops and lists them; with it, it removes them (and anything that then
     depends on them), saving every removed row to <target>.dropped.json.
  5. Verifies: integrity check, no foreign-key violations, and for every table
     the target equals the source row for row, except the dropped rows.
  6. Stamps the Alembic head revision (the schema it created).
On any failure the half-written target is deleted.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

SOURCES = ["users", "trades", "portfolio", "budget", "markets"]


def head_revision() -> str:
    """The Alembic head: the new database is created at the current schema."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    heads = ScriptDirectory.from_config(Config(str(ROOT / "alembic.ini"))).get_heads()
    if len(heads) != 1:
        raise SystemExit(f"expected one Alembic head, found {heads}")
    return heads[0]


def _cols(con: sqlite3.Connection, schema: str, table: str) -> list[str]:
    return [r[1] for r in con.execute(f'PRAGMA "{schema}".table_info("{table}")')]


def _tables(con: sqlite3.Connection, schema: str) -> list[str]:
    return [r[0] for r in con.execute(
        f"SELECT name FROM \"{schema}\".sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]


def _count(con, schema, table) -> int:
    return con.execute(f'SELECT count(*) FROM "{schema}"."{table}"').fetchone()[0]


def merge(source_dir: Path, target: Path, drop_orphans: bool) -> dict:
    if target.exists():
        raise SystemExit(f"refusing to overwrite existing {target}")
    try:
        return _merge(source_dir, target, drop_orphans)
    except BaseException:
        for leftover in (target, Path(str(target) + ".dropped.json")):
            if leftover.exists():
                leftover.unlink()
        raise


def _merge(source_dir: Path, target: Path, drop_orphans: bool) -> dict:
    from sqlalchemy import create_engine
    from database.models import Base
    BASELINE_REVISION = head_revision()

    missing = [s for s in SOURCES if not (source_dir / f"{s}.db").exists()]
    if missing:
        raise SystemExit(f"missing source files in {source_dir}: {', '.join(m + '.db' for m in missing)}")
    if target.exists():
        raise SystemExit(f"refusing to overwrite existing {target}")

    engine = create_engine(f"sqlite:///{target}")
    Base.metadata.create_all(engine)
    engine.dispose()

    con = sqlite3.connect(str(target))
    con.execute("PRAGMA foreign_keys=OFF")          # copy everything first, then check
    for s in SOURCES:
        con.execute(f"ATTACH DATABASE ? AS src_{s}", (str(source_dir / f"{s}.db"),))   # only ever SELECTed from
    report: dict = {"tables": {}, "skipped_tables": {}, "dropped_columns": {}, "dropped_rows": {}, "ignored_empty_duplicates": {}}

    where: dict[str, str] = {}
    for s in SOURCES:
        for t in _tables(con, f"src_{s}"):
            if t == "alembic_version":
                continue
            if t in Base.metadata.tables:
                if t in where:
                    # Same table in two files: use the one with rows; two non-empty copies is a conflict.
                    a, b = where[t], f"src_{s}"
                    na, nb = _count(con, a, t), _count(con, b, t)
                    if na and nb:
                        raise SystemExit(f"table {t} has rows in both {a} ({na}) and {b} ({nb}); resolve by hand")
                    keep, empty = (a, b) if na else (b, a)
                    report["ignored_empty_duplicates"][t] = empty.removeprefix("src_") + ".db"
                    where[t] = keep
                    continue
                where[t] = f"src_{s}"
            else:
                report["skipped_tables"][f"{s}.{t}"] = _count(con, f"src_{s}", t)

    with con:
        for table in Base.metadata.sorted_tables:
            src = where.get(table.name)
            if src is None:
                report["tables"][table.name] = {"source": None, "rows": 0}
                continue
            tgt_cols, src_cols = _cols(con, "main", table.name), _cols(con, src, table.name)
            cols = [c for c in tgt_cols if c in src_cols]
            extra = [c for c in src_cols if c not in tgt_cols]
            if extra:
                report["dropped_columns"][table.name] = extra
            col_sql = ", ".join(f'"{c}"' for c in cols)
            con.execute(f'INSERT INTO main."{table.name}" ({col_sql}) SELECT {col_sql} FROM {src}."{table.name}"')
            report["tables"][table.name] = {"source": src.removeprefix("src_") + ".db", "rows": _count(con, src, table.name)}

    # ── Orphans ────────────────────────────────────────────────────────────────
    dropped: list[dict] = []
    while True:
        violations = con.execute("PRAGMA main.foreign_key_check").fetchall()   # (table, rowid, parent, fkid)
        if not violations:
            break
        if not drop_orphans:
            listing = {}
            for t, rowid, parent, _ in violations:
                listing.setdefault(f"{t} -> {parent}", []).append(rowid)
            con.close()
            raise SystemExit("orphan rows found (re-run with --drop-orphans to leave them out):\n"
                             + "\n".join(f"  {k}: rows {v}" for k, v in listing.items()))
        con.row_factory = sqlite3.Row
        with con:
            for t, rowid, parent, _ in {(v[0], v[1], v[2], v[3]) for v in violations}:
                row = con.execute(f'SELECT * FROM main."{t}" WHERE rowid = ?', (rowid,)).fetchone()
                if row is None:
                    continue
                dropped.append({"table": t, "missing_parent": parent, "row": dict(row)})
                con.execute(f'DELETE FROM main."{t}" WHERE rowid = ?', (rowid,))
        con.row_factory = None
    for d in dropped:
        report["dropped_rows"][d["table"]] = report["dropped_rows"].get(d["table"], 0) + 1
    if dropped:
        Path(str(target) + ".dropped.json").write_text(json.dumps(dropped, indent=1, default=str) + "\n")

    # ── Verify ─────────────────────────────────────────────────────────────────
    problems = []
    if con.execute("PRAGMA main.integrity_check").fetchone()[0] != "ok":
        problems.append("integrity_check failed")
    if con.execute("PRAGMA main.foreign_key_check").fetchall():
        problems.append("foreign key violations remain")
    for table, info in report["tables"].items():
        src = where.get(table)
        if not src:
            continue
        cols = [c for c in _cols(con, "main", table) if c in _cols(con, src, table)]
        col_sql = ", ".join(f'"{c}"' for c in cols)
        missing_rows = con.execute(f'SELECT count(*) FROM (SELECT {col_sql} FROM {src}."{table}" EXCEPT SELECT {col_sql} FROM main."{table}")').fetchone()[0]
        unexpected = con.execute(f'SELECT count(*) FROM (SELECT {col_sql} FROM main."{table}" EXCEPT SELECT {col_sql} FROM {src}."{table}")').fetchone()[0]
        expected_missing = report["dropped_rows"].get(table, 0)
        info["copied"] = _count(con, "main", table)
        if unexpected or missing_rows != expected_missing or info["copied"] != info["rows"] - expected_missing:
            problems.append(f"{table}: source {info['rows']}, copied {info['copied']}, "
                            f"missing {missing_rows} (expected {expected_missing}), unexpected {unexpected}")
    if problems:
        con.close()
        raise SystemExit("verification failed:\n  " + "\n  ".join(problems))

    with con:
        con.execute("CREATE TABLE IF NOT EXISTS alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)")
        con.execute("INSERT INTO alembic_version (version_num) VALUES (?)", (BASELINE_REVISION,))
    for s in SOURCES:
        con.execute(f"DETACH DATABASE src_{s}")
    con.execute("VACUUM")
    con.close()
    report["alembic_revision"] = BASELINE_REVISION
    return report


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source-dir", type=Path, required=True, help="folder with users.db, trades.db, portfolio.db, budget.db, markets.db")
    ap.add_argument("--target", type=Path, required=True, help="new database file to create (must not exist)")
    ap.add_argument("--drop-orphans", action="store_true", help="leave out rows whose parent row no longer exists")
    args = ap.parse_args()
    report = merge(args.source_dir.resolve(), args.target.resolve(), args.drop_orphans)
    total_src = sum(t["rows"] for t in report["tables"].values())
    total_out = sum(t.get("copied", 0) for t in report["tables"].values())
    print(f"Created {args.target} — {len(report['tables'])} tables, {total_out:,} of {total_src:,} rows copied")
    for name, info in report["tables"].items():
        if info["rows"]:
            flag = f"  (dropped {report['dropped_rows'][name]})" if name in report["dropped_rows"] else ""
            print(f"  {name:26} {info['copied']:>8,}  from {info['source']}{flag}")
    if report["dropped_rows"]:
        print(f"Dropped orphan rows saved to {args.target}.dropped.json")
    if report["ignored_empty_duplicates"]:
        print("Empty duplicate tables ignored: " + ", ".join(f"{k} in {v}" for k, v in report["ignored_empty_duplicates"].items()))
    if report["skipped_tables"]:
        print("Tables not in the current schema (not copied): " + ", ".join(f"{k} ({v} rows)" for k, v in report["skipped_tables"].items()))
    if report["dropped_columns"]:
        print("Columns not in the current schema (not copied): " + "; ".join(f"{k}: {', '.join(v)}" for k, v in report["dropped_columns"].items()))
    print(f"Verified: integrity ok, no foreign-key violations, every table matches its source. Alembic stamped at {report['alembic_revision']}.")


if __name__ == "__main__":
    main()
