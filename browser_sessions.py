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
    refresh_token: str
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
            refresh_token TEXT NOT NULL DEFAULT '',
            username TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        )
        """
    )
    # Backfill/upgrade: older stores won't have refresh_token column.
    try:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(browser_sessions)").fetchall()]
        if "refresh_token" not in set(cols):
            conn.execute("ALTER TABLE browser_sessions ADD COLUMN refresh_token TEXT NOT NULL DEFAULT ''")
    except Exception:
        pass
    conn.execute("CREATE INDEX IF NOT EXISTS idx_browser_sessions_expires ON browser_sessions(expires_at)")
    conn.commit()
    return conn


def save_session(
    *,
    sid: str,
    token: str,
    refresh_token: str = "",
    username: str,
    user_id: int,
    ttl_seconds: int = 60 * 60 * 24 * 30,
) -> None:
    now = int(time.time())
    expires_at = now + int(ttl_seconds)
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO browser_sessions (sid, token, refresh_token, username, user_id, expires_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(sid) DO UPDATE SET
                token=excluded.token,
                refresh_token=excluded.refresh_token,
                username=excluded.username,
                user_id=excluded.user_id,
                expires_at=excluded.expires_at
            """,
            (sid, token, str(refresh_token or ""), username, int(user_id), int(expires_at)),
        )
        conn.commit()


def load_session(sid: str) -> Optional[BrowserSession]:
    now = int(time.time())
    with _connect() as conn:
        row = conn.execute(
            "SELECT sid, token, refresh_token, username, user_id, expires_at FROM browser_sessions WHERE sid = ?",
            (sid,),
        ).fetchone()
        if not row:
            return None
        bs = BrowserSession(
            sid=str(row[0]),
            token=str(row[1]),
            refresh_token=str(row[2] or ""),
            username=str(row[3]),
            user_id=int(row[4]),
            expires_at=int(row[5]),
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
