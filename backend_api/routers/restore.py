"""backend_api/routers/restore.py — one-time upload of SQLite database files.

Used to move existing data onto a fresh cloud deployment (e.g. a Railway
volume) without committing the databases to git.

Disabled unless the RESTORE_TOKEN environment variable is set. Each request
must send the same value in the ``X-Restore-Token`` header. Unset the variable
once the upload is done.

    curl -X POST https://<backend>/restore-db/users.db \
         -H "X-Restore-Token: $RESTORE_TOKEN" -F file=@users.db
"""
from __future__ import annotations

import hmac
import os
from pathlib import Path

from fastapi import APIRouter, File, Header, HTTPException, UploadFile

router = APIRouter(prefix="/restore-db", tags=["restore"])

ALLOWED = {"users.db", "trades.db", "portfolio.db", "budget.db", "markets.db"}
_SQLITE_MAGIC = b"SQLite format 3\x00"
_MAX_BYTES = 500 * 1024 * 1024  # 500 MB


def _db_dir() -> Path:
    return Path(os.getenv("DB_DIR") or Path(__file__).resolve().parents[2])


@router.post("/{name}")
async def restore_db(
    name: str,
    file: UploadFile = File(...),
    x_restore_token: str = Header(default=""),
) -> dict:
    expected = os.getenv("RESTORE_TOKEN", "")
    # Hide the endpoint entirely when not enabled.
    if not expected:
        raise HTTPException(status_code=404, detail="Not Found")
    if not hmac.compare_digest(x_restore_token.encode(), expected.encode()):
        raise HTTPException(status_code=403, detail="Invalid restore token")
    if name not in ALLOWED:
        raise HTTPException(status_code=400, detail=f"Unknown database: {name}")

    data = await file.read(_MAX_BYTES + 1)
    if len(data) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail="File too large")
    if not data.startswith(_SQLITE_MAGIC):
        raise HTTPException(status_code=400, detail="Not a SQLite database file")

    target = _db_dir() / name
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".upload")
    tmp.write_bytes(data)
    # Drop stale WAL/SHM files from the old database before swapping it in.
    for suffix in ("-wal", "-shm"):
        Path(str(target) + suffix).unlink(missing_ok=True)
    os.replace(tmp, target)
    return {"restored": name, "bytes": len(data)}
