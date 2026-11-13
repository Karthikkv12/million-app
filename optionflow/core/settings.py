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
    # A login lasts at most this long: renewing a refresh token never moves its expiry later.
    refresh_token_expires_days: int = 7
    refresh_token_pepper: Optional[str] = None  # falls back to jwt_secret
    # A rotated token presented again within this window is a benign race (two tabs refreshing at once):
    # it gets an access token but no new refresh token. Later than this, it's treated as theft and the
    # whole login chain is revoked.
    refresh_reuse_grace_seconds: int = 30
    # Browsers get the refresh token only as an HttpOnly cookie (scripts can't read it).
    refresh_cookie_name: str = "of_rt"
    refresh_cookie_path: str = "/api/v1/auth"
    refresh_cookie_secure: Optional[bool] = None  # None = Secure when the request came over HTTPS

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

    # ── AI assistant (ai module) ────────────────────────────────────────────
    gemini_api_key: Optional[str] = None        # free tier; _2 and _3 are tried when a key is over quota
    gemini_api_key_2: Optional[str] = None
    gemini_api_key_3: Optional[str] = None
    gemini_model: str = "gemini-2.0-flash-lite"
    openai_api_key: Optional[str] = None
    openai_model: str = "gpt-4o-mini"

    # ── Market data: Public.com option chains for GEX (Yahoo is the fallback) ─
    public_api_secret: Optional[str] = None     # Public.com settings → Security → API; unset = Yahoo only
    public_account_id: Optional[str] = None     # default: first options-enabled BROKERAGE account

    # ── Feature modules (used from plan step 4) ─────────────────────────────
    enabled_modules: str = "auth,market,flow,watchlist,catalyst,unusual,portfolio,budget,hedge,notify,watchlists,strategy,insight,pulse,risk"
    # Phone notifications (notify module): VAPID key pair (base64url P-256) + contact sent to push services.
    # Empty private key = push disabled. Read from .env like every other setting.
    push_vapid_private_key: str = ""
    push_vapid_public_key: str = ""
    push_contact: str = ""
    # Shared secret for POST /hedge/ingest (broker sync). Empty = ingest disabled.
    hedge_ingest_token: str = ""
    # The only username the ingest token may write for. Empty = ingest disabled.
    hedge_ingest_username: str = ""

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
