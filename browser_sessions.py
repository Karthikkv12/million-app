from __future__ import annotations

import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass(frozen=True)
class BrowserSession:
    sid: str
    token: str
    username: str
    user_id: int
    expires_at: int


def _db_path() -> Path:
    # auth.py lives at .../million-app/million-app/ui/auth.py
    # This module lives at .../million-app/million-app/browser_sessions.py
    # Put the store at repo root so it survives reloads.
    repo_root = Path(__file__).resolve().parents[1]
    return repo_root / ".browser_sessions.sqlite"


def _connect() -> sqlite3.Connection:
    path = _db_path()
    conn = sqlite3.connect(str(path))
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS browser_sessions (
            sid TEXT PRIMARY KEY,
            token TEXT NOT NULL,
            username TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_browser_sessions_expires ON browser_sessions(expires_at)")
    conn.commit()
    return conn


def save_session(*, sid: str, token: str, username: str, user_id: int, ttl_seconds: int = 60 * 60 * 24 * 30) -> None:
    now = int(time.time())
    expires_at = now + int(ttl_seconds)
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO browser_sessions (sid, token, username, user_id, expires_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(sid) DO UPDATE SET
                token=excluded.token,
                username=excluded.username,
                user_id=excluded.user_id,
                expires_at=excluded.expires_at
            """,
            (sid, token, username, int(user_id), int(expires_at)),
        )
        conn.commit()


def load_session(sid: str) -> Optional[BrowserSession]:
    now = int(time.time())
    with _connect() as conn:
        row = conn.execute(
            "SELECT sid, token, username, user_id, expires_at FROM browser_sessions WHERE sid = ?",
            (sid,),
        ).fetchone()
        if not row:
            return None
        bs = BrowserSession(
            sid=str(row[0]),
            token=str(row[1]),
            username=str(row[2]),
            user_id=int(row[3]),
            expires_at=int(row[4]),
        )
        if bs.expires_at <= now:
            conn.execute("DELETE FROM browser_sessions WHERE sid = ?", (sid,))
            conn.commit()
            return None
        return bs


def delete_session(sid: str) -> None:
    with _connect() as conn:
        conn.execute("DELETE FROM browser_sessions WHERE sid = ?", (sid,))
        conn.commit()


def cleanup_expired(limit: int = 500) -> int:
    now = int(time.time())
    with _connect() as conn:
        cur = conn.execute(
            "DELETE FROM browser_sessions WHERE sid IN (SELECT sid FROM browser_sessions WHERE expires_at <= ? LIMIT ?)",
            (now, int(limit)),
        )
        conn.commit()
        return int(cur.rowcount)
