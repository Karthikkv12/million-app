"""optionflow/core/settings.py — every setting the backend reads, in one place.

Values come from the process environment first, then from `.env` at the repo
root. Names are case-insensitive (JWT_SECRET → jwt_secret).

Use `get_settings()` everywhere instead of `os.getenv`. Tests swap the active
settings with `override_settings(...)` (see tests/conftest.py).
"""
from __future__ import annotations

from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path
from typing import Iterator, Optional

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ── Auth: JWT access tokens ──────────────────────────────────────────────
    jwt_secret: Optional[str] = None            # set in production; dev falls back to an insecure default
    jwt_issuer: str = "optionflow-api"
    jwt_audience: str = "optionflow-app"
    access_token_expires_minutes: int = 15

    # ── Auth: refresh tokens ─────────────────────────────────────────────────
    refresh_token_expires_days: int = 30
    refresh_token_pepper: Optional[str] = None  # falls back to jwt_secret

    # ── Auth: password policy ────────────────────────────────────────────────
    password_min_length: int = 12
    password_require_upper: bool = True
    password_require_lower: bool = True
    password_require_digit: bool = True
    password_require_special: bool = False

    # ── Auth: rate limits ────────────────────────────────────────────────────
    login_rate_limit_max_failures: int = 10
    login_rate_limit_window_seconds: int = 300
    refresh_rate_limit_max_attempts: int = 60
    refresh_rate_limit_window_seconds: int = 60

    # ── HTTP ─────────────────────────────────────────────────────────────────
    cors_allow_origins: str = "*"               # comma-separated

    # ── Database ─────────────────────────────────────────────────────────────
    database_url: str = ""                      # any SQLAlchemy URL (e.g. postgresql://…); empty = SQLite below
    db_dir: str = "."                           # folder holding the SQLite file
    db_file: str = "optionflow.db"              # SQLite file name
    db_pool_size: int = 5
    db_max_overflow: int = 10
    db_pool_timeout: int = 30

    # ── Feature modules (used from plan step 4) ─────────────────────────────
    enabled_modules: str = "auth,market,flow,watchlist"

    # ── Derived values ───────────────────────────────────────────────────────
    @property
    def is_postgres(self) -> bool:
        return self.database_url.startswith(("postgresql", "postgres"))

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_allow_origins.split(",") if o.strip()]

    @property
    def enabled_modules_list(self) -> list[str]:
        return [m.strip() for m in self.enabled_modules.split(",") if m.strip()]

    @property
    def resolved_database_url(self) -> str:
        """The one database: DATABASE_URL, or SQLite at DB_DIR/DB_FILE."""
        return self.database_url or f"sqlite:///{self.db_dir}/{self.db_file}"


_override: Optional[Settings] = None


@lru_cache(maxsize=1)
def _load_settings() -> Settings:
    return Settings()


def get_settings() -> Settings:
    """The active settings (cached after the first read)."""
    return _override if _override is not None else _load_settings()


def reset_settings_cache() -> None:
    """Re-read the environment and .env on the next get_settings() call."""
    _load_settings.cache_clear()


@contextmanager
def override_settings(settings: Settings) -> Iterator[Settings]:
    """Temporarily replace the active settings (tests, scripts)."""
    global _override
    previous = _override
    _override = settings
    try:
        yield settings
    finally:
        _override = previous
