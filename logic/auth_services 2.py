"""logic/auth_services.py — Authentication, users, tokens, and rate-limiting."""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import sessionmaker

from database.models import (
    get_users_engine,
    get_users_session,
)

_logger = logging.getLogger("optionflow.auth")

try:
    from passlib.context import CryptContext
except Exception as e:
    raise ImportError(
        "passlib is required for secure password hashing. Install with: `pip install passlib[bcrypt]`"
    ) from e

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

# ── Compatibility: tests monkeypatch logic.services.engine ───────────────────
# auth_services reads the monkeypatched value from logic.services at call-time.
def _users_session():
    """Session for users.db (auth, tokens, events)."""
    try:
        import logic.services as _svc
        if getattr(_svc, "engine", None) is not None:
            return sessionmaker(bind=_svc.engine)()
    except Exception:
        pass
    import database.models as _dbm
    return _dbm.get_users_session()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _normalize_str(x) -> str:
    if x is None:
        return ""
    return str(x).strip()


def _policy_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except Exception:
        return int(default)


def _policy_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return bool(default)
    return str(raw).strip().lower() in {"1", "true", "yes", "y", "on"}


def _rate_limit_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except Exception:
        return int(default)


def _utc_naive_from_epoch_seconds(epoch_seconds: int) -> datetime:
    return datetime.fromtimestamp(int(epoch_seconds), tz=timezone.utc).replace(tzinfo=None)


def _epoch_seconds_from_utc_naive(dt: datetime) -> int:
    return int(dt.replace(tzinfo=timezone.utc).timestamp())


def _refresh_token_pepper() -> str:
    return (
        os.getenv("REFRESH_TOKEN_PEPPER")
        or os.getenv("JWT_SECRET")
        or "dev-insecure-secret"
    )


def _hash_refresh_token(token: str) -> str:
    tok = str(token or "").strip()
    return hmac.new(
        _refresh_token_pepper().encode("utf-8"),
        tok.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _refresh_token_ttl_days() -> int:
    try:
        return int(os.getenv("REFRESH_TOKEN_EXPIRES_DAYS", "30"))
    except Exception:
        return 30


# ── Password policy ───────────────────────────────────────────────────────────

def _validate_password_policy(password: str) -> None:
    """Raise ValueError if password does not meet policy."""
    pw = str(password or "")
    min_len = _policy_int("PASSWORD_MIN_LENGTH", 12)
    req_upper = _policy_bool("PASSWORD_REQUIRE_UPPER", True)
    req_lower = _policy_bool("PASSWORD_REQUIRE_LOWER", True)
    req_digit = _policy_bool("PASSWORD_REQUIRE_DIGIT", True)
    req_special = _policy_bool("PASSWORD_REQUIRE_SPECIAL", False)

    if len(pw) < int(min_len):
        raise ValueError(f"password must be at least {int(min_len)} characters")
    if req_upper and not any(c.isupper() for c in pw):
        raise ValueError("password must include an uppercase letter")
    if req_lower and not any(c.islower() for c in pw):
        raise ValueError("password must include a lowercase letter")
    if req_digit and not any(c.isdigit() for c in pw):
        raise ValueError("password must include a number")
    if req_special and not any((not c.isalnum()) for c in pw):
        raise ValueError("password must include a special character")


# ── Users ─────────────────────────────────────────────────────────────────────

def create_user(username, password, role="user"):
    session = _users_session()
    try:
        username = str(username).strip().lower()
        if not username:
            raise ValueError("username required")
        from database.models import User
        existing = session.query(User).filter(User.username == username).first()
        if existing:
            raise ValueError("username already exists")
        password = str(password)
        if not password:
            raise ValueError("password required")
        _validate_password_policy(password)
        ph = pwd_context.hash(password)
        user = User(username=username, password_hash=ph, salt=None, role=str(role), is_active=True)
        session.add(user)
        session.commit()
        return user.id
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def authenticate_user(username, password):
    session = _users_session()
    try:
        from database.models import User
        uname = str(username).strip().lower()
        u = session.query(User).filter(User.username == uname).first()
        if not u:
            return None
        if hasattr(u, "is_active") and not u.is_active:
            return None
        ok = pwd_context.verify(password, u.password_hash)
        if not ok:
            return None
        role = str(getattr(u, "role", None) or "user")
        return {"user_id": u.id, "role": role}
    finally:
        session.close()


def get_user(user_id: int):
    session = _users_session()
    try:
        from database.models import User
        return session.query(User).filter(User.id == int(user_id)).first()
    finally:
        session.close()


def list_all_users():
    session = _users_session()
    try:
        from database.models import User
        return session.query(User).order_by(User.created_at.asc()).all()
    finally:
        session.close()


def patch_user_admin(user_id: int, *, role: str | None = None, is_active: bool | None = None):
    session = _users_session()
    try:
        from database.models import User
        u = session.query(User).filter(User.id == int(user_id)).first()
        if not u:
            raise ValueError("user not found")
        if role is not None:
            u.role = str(role)
        if is_active is not None:
            u.is_active = bool(is_active)
        session.add(u)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def delete_user_admin(user_id: int) -> None:
    session = _users_session()
    try:
        from database.models import User
        u = session.query(User).filter(User.id == int(user_id)).first()
        if not u:
            raise ValueError("user not found")
        session.delete(u)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def set_auth_valid_after_epoch(*, user_id: int, epoch_seconds: int) -> None:
    session = _users_session()
    try:
        from database.models import User
        u = session.query(User).filter(User.id == int(user_id)).first()
        if not u:
            raise ValueError("user not found")
        u.auth_valid_after = _utc_naive_from_epoch_seconds(int(epoch_seconds))
        session.add(u)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def is_token_time_valid(*, user_id: int, token_iat: int) -> bool:
    u = get_user(int(user_id))
    if u is None:
        return False
    ava = getattr(u, "auth_valid_after", None)
    if not ava:
        return True
    try:
        cutoff = _epoch_seconds_from_utc_naive(ava)
    except Exception:
        return True
    return int(token_iat) >= int(cutoff)


def change_password(
    *,
    user_id: int,
    old_password: str,
    new_password: str,
    invalidate_tokens_before_epoch: int | None = None,
) -> None:
    session = _users_session()
    try:
        from database.models import User
        u = session.query(User).filter(User.id == int(user_id)).first()
        if not u:
            raise ValueError("user not found")
        if not pwd_context.verify(str(old_password), u.password_hash):
            raise ValueError("current password is incorrect")
        new_password = str(new_password)
        if not new_password:
            raise ValueError("new password is required")
        _validate_password_policy(new_password)
        u.password_hash = pwd_context.hash(new_password)
        if invalidate_tokens_before_epoch is not None:
            u.auth_valid_after = _utc_naive_from_epoch_seconds(int(invalidate_tokens_before_epoch))
        else:
            u.auth_valid_after = datetime.now(timezone.utc).replace(tzinfo=None)
        session.add(u)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


# ── Revoked tokens (JWT blocklist) ────────────────────────────────────────────

def revoke_token(*, user_id: int, jti: str, expires_at: datetime) -> None:
    session = _users_session()
    try:
        from database.models import RevokedToken
        jti = str(jti).strip()
        if not jti:
            return
        existing = session.query(RevokedToken).filter(RevokedToken.jti == jti).first()
        if existing:
            return
        rt = RevokedToken(
            user_id=int(user_id),
            jti=jti,
            revoked_at=datetime.now(timezone.utc).replace(tzinfo=None),
            expires_at=expires_at.replace(tzinfo=None),
        )
        session.add(rt)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def is_token_revoked(*, jti: str) -> bool:
    session = _users_session()
    try:
        from database.models import RevokedToken
        jti = str(jti).strip()
        if not jti:
            return False
        hit = session.query(RevokedToken).filter(RevokedToken.jti == jti).first()
        return hit is not None
    finally:
        session.close()


# ── Refresh tokens ────────────────────────────────────────────────────────────

def create_refresh_token(*, user_id: int, ip: str | None = None, user_agent: str | None = None) -> str:
    session = _users_session()
    try:
        from database.models import RefreshToken
        raw = f"rt_{secrets.token_urlsafe(32)}"
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        expires_at = (datetime.now(timezone.utc) + timedelta(days=_refresh_token_ttl_days())).replace(tzinfo=None)
        ua = (str(user_agent)[:500] if user_agent else None)
        ip_s = (str(ip).strip() if ip else None)
        rt = RefreshToken(
            user_id=int(user_id),
            token_hash=_hash_refresh_token(raw),
            created_at=now,
            created_ip=ip_s,
            created_user_agent=ua,
            last_used_at=now,
            last_used_ip=ip_s,
            last_used_user_agent=ua,
            expires_at=expires_at,
            revoked_at=None,
            revoked_reason=None,
            replaced_by_token_id=None,
        )
        session.add(rt)
        session.commit()
        return raw
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def validate_refresh_token(*, refresh_token: str) -> int | None:
    session = _users_session()
    try:
        from database.models import RefreshToken
        th = _hash_refresh_token(refresh_token)
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        rt = session.query(RefreshToken).filter(RefreshToken.token_hash == th).first()
        if not rt:
            return None
        if getattr(rt, "revoked_at", None) is not None:
            return None
        if getattr(rt, "expires_at", now) <= now:
            return None
        return int(getattr(rt, "user_id"))
    finally:
        session.close()


def rotate_refresh_token(
    *,
    refresh_token: str,
    ip: str | None = None,
    user_agent: str | None = None,
) -> tuple[int, str] | None:
    session = _users_session()
    try:
        from database.models import RefreshToken
        th = _hash_refresh_token(refresh_token)
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        rt = session.query(RefreshToken).filter(RefreshToken.token_hash == th).first()
        if not rt:
            return None
        if getattr(rt, "revoked_at", None) is not None:
            return None
        if getattr(rt, "expires_at", now) <= now:
            return None

        user_id = int(getattr(rt, "user_id"))
        new_raw = f"rt_{secrets.token_urlsafe(32)}"
        ua = (str(user_agent)[:500] if user_agent else None)
        ip_s = (str(ip).strip() if ip else None)
        new_rt = RefreshToken(
            user_id=user_id,
            token_hash=_hash_refresh_token(new_raw),
            created_at=now,
            created_ip=ip_s,
            created_user_agent=ua,
            last_used_at=now,
            last_used_ip=ip_s,
            last_used_user_agent=ua,
            expires_at=(datetime.now(timezone.utc) + timedelta(days=_refresh_token_ttl_days())).replace(tzinfo=None),
            revoked_at=None,
            revoked_reason=None,
            replaced_by_token_id=None,
        )
        session.add(new_rt)
        session.flush()

        rt.revoked_at = now
        rt.revoked_reason = "rotated"
        rt.replaced_by_token_id = int(getattr(new_rt, "id"))
        session.add(rt)
        session.commit()
        return user_id, new_raw
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def revoke_refresh_token(*, user_id: int | None = None, refresh_token: str) -> None:
    session = _users_session()
    try:
        from database.models import RefreshToken
        th = _hash_refresh_token(refresh_token)
        q = session.query(RefreshToken).filter(RefreshToken.token_hash == th)
        if user_id is not None:
            q = q.filter(RefreshToken.user_id == int(user_id))
        rt = q.first()
        if not rt:
            return
        if getattr(rt, "revoked_at", None) is not None:
            return
        rt.revoked_at = datetime.now(timezone.utc).replace(tzinfo=None)
        rt.revoked_reason = "revoked"
        session.add(rt)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def revoke_all_refresh_tokens(*, user_id: int) -> int:
    session = _users_session()
    try:
        from database.models import RefreshToken
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        tokens = (
            session.query(RefreshToken)
            .filter(RefreshToken.user_id == int(user_id))
            .filter(RefreshToken.revoked_at.is_(None))
            .all()
        )
        n = 0
        for rt in tokens:
            rt.revoked_at = now
            rt.revoked_reason = "revoked_all"
            session.add(rt)
            n += 1
        session.commit()
        return int(n)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def list_refresh_sessions(*, user_id: int, limit: int = 25) -> list[dict]:
    session = _users_session()
    try:
        from database.models import RefreshToken
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        rows = (
            session.query(RefreshToken)
            .filter(RefreshToken.user_id == int(user_id))
            .filter(RefreshToken.revoked_at.is_(None))
            .filter(RefreshToken.expires_at > now)
            .order_by(RefreshToken.created_at.desc())
            .limit(int(limit))
            .all()
        )
        out: list[dict] = []
        for r in rows:
            out.append(
                {
                    "id": int(getattr(r, "id")),
                    "created_at": getattr(r, "created_at", None),
                    "last_used_at": getattr(r, "last_used_at", None),
                    "ip": str(getattr(r, "last_used_ip", "") or getattr(r, "created_ip", "") or "") or None,
                    "user_agent": str(getattr(r, "last_used_user_agent", "") or getattr(r, "created_user_agent", "") or "") or None,
                    "expires_at": getattr(r, "expires_at", None),
                }
            )
        return out
    finally:
        session.close()


def revoke_refresh_session_by_id(*, user_id: int, session_id: int, reason: str = "revoked") -> bool:
    session = _users_session()
    try:
        from database.models import RefreshToken
        rt = (
            session.query(RefreshToken)
            .filter(RefreshToken.user_id == int(user_id))
            .filter(RefreshToken.id == int(session_id))
            .first()
        )
        if not rt:
            return False
        if getattr(rt, "revoked_at", None) is not None:
            return True
        rt.revoked_at = datetime.now(timezone.utc).replace(tzinfo=None)
        rt.revoked_reason = str(reason)[:100]
        session.add(rt)
        session.commit()
        return True
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


# ── Auth events & rate limiting ───────────────────────────────────────────────

def log_auth_event(
    *,
    event_type: str,
    success: bool,
    username: str | None = None,
    user_id: int | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
    detail: str | None = None,
) -> None:
    """Append an auth audit event (best-effort)."""
    session = _users_session()
    try:
        from database.models import AuthEvent
        ev = AuthEvent(
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
            event_type=str(event_type),
            success=bool(success),
            username=(str(username).strip() if username is not None else None),
            user_id=(int(user_id) if user_id is not None else None),
            ip=(str(ip).strip() if ip is not None else None),
            user_agent=(str(user_agent)[:500] if user_agent else None),
            detail=(str(detail)[:500] if detail else None),
        )
        session.add(ev)
        session.commit()
    except Exception:
        session.rollback()
        return
    finally:
        session.close()


def list_auth_events(*, user_id: int, limit: int = 25) -> list[dict]:
    session = _users_session()
    try:
        from database.models import AuthEvent
        rows = (
            session.query(AuthEvent)
            .filter(AuthEvent.user_id == int(user_id))
            .order_by(AuthEvent.created_at.desc())
            .limit(int(limit))
            .all()
        )
        out: list[dict] = []
        for r in rows:
            out.append(
                {
                    "created_at": getattr(r, "created_at", None),
                    "event_type": str(getattr(r, "event_type", "")),
                    "success": bool(getattr(r, "success", False)),
                    "ip": str(getattr(r, "ip", "") or ""),
                    "detail": str(getattr(r, "detail", "") or ""),
                }
            )
        return out
    finally:
        session.close()


def is_login_rate_limited(*, username: str, ip: str | None = None) -> bool:
    window_s = _rate_limit_int("LOGIN_RATE_LIMIT_WINDOW_SECONDS", 300)
    max_failures = _rate_limit_int("LOGIN_RATE_LIMIT_MAX_FAILURES", 10)
    if max_failures <= 0:
        return False
    since = datetime.now(timezone.utc) - timedelta(seconds=int(window_s))
    since_naive = since.replace(tzinfo=None)
    session = _users_session()
    try:
        from database.models import AuthEvent
        q = (
            session.query(AuthEvent)
            .filter(AuthEvent.event_type == "login")
            .filter(AuthEvent.success.is_(False))
            .filter(AuthEvent.created_at >= since_naive)
            .filter(AuthEvent.username == str(username).strip())
        )
        if ip:
            q = q.filter(AuthEvent.ip == str(ip).strip())
        return int(q.count()) >= int(max_failures)
    finally:
        session.close()


def is_refresh_rate_limited(*, ip: str | None = None) -> bool:
    window_s = _rate_limit_int("REFRESH_RATE_LIMIT_WINDOW_SECONDS", 60)
    max_attempts = _rate_limit_int("REFRESH_RATE_LIMIT_MAX_ATTEMPTS", 60)
    if max_attempts <= 0:
        return False
    since = datetime.now(timezone.utc) - timedelta(seconds=int(window_s))
    since_naive = since.replace(tzinfo=None)
    session = _users_session()
    try:
        from database.models import AuthEvent
        q = (
            session.query(AuthEvent)
            .filter(AuthEvent.event_type == "refresh")
            .filter(AuthEvent.created_at >= since_naive)
        )
        if ip:
            q = q.filter(AuthEvent.ip == str(ip).strip())
        return int(q.count()) >= int(max_attempts)
    finally:
        session.close()
