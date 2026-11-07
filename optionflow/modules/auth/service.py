"""optionflow/modules/auth/service.py — users, passwords, tokens, sessions, rate limits.

The lower half ("Flows") holds what the HTTP routes do: plain functions that
raise optionflow.core.errors instead of HTTP exceptions.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
from datetime import datetime, timedelta, timezone

from optionflow.core.db import get_session
from optionflow.core.settings import get_settings

_logger = logging.getLogger("optionflow.auth")

try:
    from passlib.context import CryptContext
except Exception as e:
    raise ImportError(
        "passlib is required for secure password hashing. Install with: `pip install passlib[bcrypt]`"
    ) from e

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")



# ── Helpers ───────────────────────────────────────────────────────────────────

def _normalize_str(x) -> str:
    if x is None:
        return ""
    return str(x).strip()


def _policy_int(name: str, default: int) -> int:
    """Password-policy integer from settings (e.g. PASSWORD_MIN_LENGTH)."""
    return int(getattr(get_settings(), name.lower(), default))


def _policy_bool(name: str, default: bool) -> bool:
    """Password-policy flag from settings (e.g. PASSWORD_REQUIRE_UPPER)."""
    return bool(getattr(get_settings(), name.lower(), default))


def _rate_limit_int(name: str, default: int) -> int:
    """Rate-limit integer from settings (e.g. LOGIN_RATE_LIMIT_MAX_FAILURES)."""
    return int(getattr(get_settings(), name.lower(), default))


def _utc_naive_from_epoch_seconds(epoch_seconds: int) -> datetime:
    return datetime.fromtimestamp(int(epoch_seconds), tz=timezone.utc).replace(tzinfo=None)


def _epoch_seconds_from_utc_naive(dt: datetime) -> int:
    return int(dt.replace(tzinfo=timezone.utc).timestamp())


def _refresh_token_pepper() -> str:
    s = get_settings()
    return s.refresh_token_pepper or s.jwt_secret or "dev-insecure-secret"


def _hash_refresh_token(token: str) -> str:
    tok = str(token or "").strip()
    return hmac.new(
        _refresh_token_pepper().encode("utf-8"),
        tok.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _refresh_token_ttl_days() -> int:
    return get_settings().refresh_token_expires_days


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
    session = get_session()
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
    session = get_session()
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
    session = get_session()
    try:
        from database.models import User
        return session.query(User).filter(User.id == int(user_id)).first()
    finally:
        session.close()


def get_user_by_username(username: str):
    session = get_session()
    try:
        from database.models import User
        uname = str(username).strip().lower()
        return session.query(User).filter(User.username == uname).first()
    finally:
        session.close()


def list_all_users():
    session = get_session()
    try:
        from database.models import User
        return session.query(User).order_by(User.created_at.asc()).all()
    finally:
        session.close()


def patch_user_admin(user_id: int, *, role: str | None = None, is_active: bool | None = None):
    session = get_session()
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
    session = get_session()
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


def admin_set_password(user_id: int, new_password: str) -> None:
    """Admin-only: forcibly set a user's password without knowing the old one."""
    session = get_session()
    try:
        from database.models import User
        u = session.query(User).filter(User.id == int(user_id)).first()
        if not u:
            raise ValueError("user not found")
        new_password = str(new_password)
        if not new_password:
            raise ValueError("new password is required")
        _validate_password_policy(new_password)
        u.password_hash = pwd_context.hash(new_password)
        u.auth_valid_after = datetime.now(timezone.utc).replace(tzinfo=None)
        session.add(u)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def update_username_admin(user_id: int, new_username: str) -> None:
    """Admin-only: change a user's username."""
    session = get_session()
    try:
        from database.models import User
        uname = str(new_username).strip().lower()
        if not uname:
            raise ValueError("username required")
        u = session.query(User).filter(User.id == int(user_id)).first()
        if not u:
            raise ValueError("user not found")
        u.username = uname
        session.add(u)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def set_auth_valid_after_epoch(*, user_id: int, epoch_seconds: int) -> None:
    session = get_session()
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
    session = get_session()
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
    session = get_session()
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
    session = get_session()
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
    session = get_session()
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
    session = get_session()
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
    session = get_session()
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
    session = get_session()
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
    session = get_session()
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
    session = get_session()
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
    session = get_session()
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
    session = get_session()
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
    session = get_session()
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
    session = get_session()
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
    session = get_session()
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



# ══════════════════════════════════════════════════════════════════════════════
# Flows used by the API (moved from the auth/admin routers)
# ══════════════════════════════════════════════════════════════════════════════
from optionflow.core import errors as _err  # noqa: E402
from optionflow.core.security import create_access_token as _create_access_token  # noqa: E402


def _token_bundle(user_id: int, username: str, role: str, refresh_token: str | None,
                  issued_at: datetime | None = None) -> dict:
    extra = {"username": username, "role": role}
    return {
        "access_token": _create_access_token(subject=str(user_id), extra=extra, issued_at=issued_at),
        "refresh_token": refresh_token,
        "user_id": int(user_id),
        "username": username,
        "role": role,
    }


def _limited(check, **kwargs) -> bool:
    """Run a rate-limit check; if the check itself fails, log it and allow the request."""
    try:
        return bool(check(**kwargs))
    except Exception as exc:
        _logger.warning("Rate-limit check failed (%s): %s", check.__name__, exc)
        return False


def login(username: str, password: str, *, ip: str | None = None, user_agent: str | None = None) -> dict:
    """Check credentials and issue an access + refresh token. Logs every attempt."""
    username = str(username).strip().lower()
    if _limited(is_login_rate_limited, username=username, ip=ip):
        log_auth_event(event_type="login_throttled", success=False, username=username, ip=ip, user_agent=user_agent)
        raise _err.RateLimited("Too many login attempts. Please try again later.")
    auth = authenticate_user(username, password)
    if not auth:
        log_auth_event(event_type="login", success=False, username=username, ip=ip,
                       user_agent=user_agent, detail="invalid credentials")
        raise _err.Unauthorized("Invalid username or password")
    user_id = int(auth["user_id"])
    role = auth.get("role", "user")
    refresh = create_refresh_token(user_id=user_id, ip=ip, user_agent=user_agent)
    log_auth_event(event_type="login", success=True, username=username, user_id=user_id, ip=ip, user_agent=user_agent)
    return _token_bundle(user_id, username, role, refresh)


def refresh_session(refresh_token: str, *, ip: str | None = None, user_agent: str | None = None) -> dict:
    """Rotate a refresh token and issue a new access token."""
    if _limited(is_refresh_rate_limited, ip=ip):
        log_auth_event(event_type="refresh_throttled", success=False, ip=ip, user_agent=user_agent)
        raise _err.RateLimited("Too many refresh attempts. Please try again later.")
    rotated = rotate_refresh_token(refresh_token=refresh_token, ip=ip, user_agent=user_agent)
    if not rotated:
        log_auth_event(event_type="refresh", success=False, ip=ip, user_agent=user_agent, detail="invalid refresh token")
        raise _err.Unauthorized("Invalid refresh token")
    user_id, new_refresh = rotated
    u = get_user(int(user_id))
    username = str(getattr(u, "username", "") or "") if u is not None else ""
    role = str(getattr(u, "role", None) or "user") if u is not None else "user"
    log_auth_event(event_type="refresh", success=True, username=username, user_id=int(user_id), ip=ip, user_agent=user_agent)
    return _token_bundle(int(user_id), username, role, new_refresh)


def profile(claims: dict) -> dict:
    """The signed-in user's id, name and role (database values win over token claims)."""
    user_id = int(claims["sub"])
    username = str(claims.get("username") or "")
    role = str(claims.get("role") or "user")
    u = get_user(user_id)
    if u is not None:
        username = str(getattr(u, "username", username) or username)
        role = str(getattr(u, "role", None) or role)
    return {"user_id": user_id, "username": username, "role": role}


def _revoke_access_token(claims: dict) -> None:
    jti = str(claims.get("jti") or "").strip()
    if not jti:
        return
    try:
        exp = datetime.fromtimestamp(int(claims.get("exp")), tz=timezone.utc)
    except Exception:
        exp = datetime.now(timezone.utc)
    revoke_token(user_id=int(claims["sub"]), jti=jti, expires_at=exp)


def logout(claims: dict, refresh_token: str | None = None) -> None:
    """Revoke this access token and, if given, its refresh token."""
    user_id = int(claims["sub"])
    _revoke_access_token(claims)
    if refresh_token:
        try:
            revoke_refresh_token(user_id=user_id, refresh_token=str(refresh_token))
        except Exception as exc:
            _logger.warning("Failed to revoke refresh token on logout for user %s: %s", user_id, exc)
    log_auth_event(event_type="logout", success=True, username=str(claims.get("username") or ""), user_id=user_id)


def logout_everywhere(claims: dict) -> None:
    """Invalidate every token issued before now, on every device."""
    user_id = int(claims["sub"])
    set_auth_valid_after_epoch(user_id=user_id, epoch_seconds=int(claims.get("iat") or 0) + 1)
    try:
        revoke_all_refresh_tokens(user_id=user_id)
    except Exception as exc:
        _logger.warning("revoke_all_refresh_tokens failed on logout_all for user %s: %s", user_id, exc)
    _revoke_access_token(claims)
    log_auth_event(event_type="logout_all", success=True, username=str(claims.get("username") or ""), user_id=user_id)


def change_own_password(claims: dict, current_password: str, new_password: str) -> dict:
    """Change the signed-in user's password, end other sessions, and issue fresh tokens."""
    user_id = int(claims["sub"])
    username = str(claims.get("username") or "")
    cutoff = int(claims.get("iat") or 0) + 1
    try:
        change_password(user_id=user_id, old_password=current_password, new_password=new_password,
                        invalidate_tokens_before_epoch=cutoff)
    except ValueError as e:
        raise _err.BadRequest(str(e))
    try:
        revoke_all_refresh_tokens(user_id=user_id)
    except Exception as exc:
        _logger.warning("revoke_all_refresh_tokens failed on change_password for user %s: %s", user_id, exc)
    log_auth_event(event_type="change_password", success=True, username=username, user_id=user_id)
    u = get_user(user_id)
    role = str(getattr(u, "role", None) or claims.get("role") or "user")   # keep admin rights in the new token
    return _token_bundle(user_id, username, role, create_refresh_token(user_id=user_id),
                         issued_at=datetime.fromtimestamp(cutoff, tz=timezone.utc))


def revoke_own_session(claims: dict, session_id: int) -> None:
    user_id = int(claims["sub"])
    if not revoke_refresh_session_by_id(user_id=user_id, session_id=int(session_id), reason="revoked"):
        raise _err.NotFound("Session not found")
    log_auth_event(event_type="revoke_session", success=True, username=str(claims.get("username") or ""), user_id=user_id)


# ── Admin flows ───────────────────────────────────────────────────────────────
def admin_create_user(username: str, password: str, role: str = "user"):
    if get_user_by_username(username):
        raise _err.Conflict("Username already exists")
    user = get_user(create_user(username=username, password=password, role=role or "user"))
    if not user:
        raise _err.ServerError("User created but could not be retrieved")
    return user


def admin_update_user(user_id: int, *, username: str | None = None, password: str | None = None,
                      role: str | None = None, is_active: bool | None = None):
    """Apply only the provided fields, in order: username, password, role/active."""
    if not any([username, password, role is not None, is_active is not None]):
        raise _err.Unprocessable("No fields to update")
    if username is not None:
        try:
            update_username_admin(user_id, username)
        except ValueError as e:
            raise (_err.NotFound if "not found" in str(e) else _err.Conflict)(str(e))
    if password is not None:
        try:
            admin_set_password(user_id, password)
        except ValueError as e:
            raise _err.BadRequest(str(e))
    if role is not None or is_active is not None:
        try:
            patch_user_admin(user_id, role=role, is_active=is_active)
        except ValueError as e:
            raise _err.NotFound(str(e))
    user = get_user(user_id)
    if not user:
        raise _err.NotFound("User not found")
    return user


def admin_delete_user(user_id: int) -> None:
    """Delete a user who owns no data. Users with data are deactivated instead (409)."""
    from sqlalchemy.exc import IntegrityError
    try:
        delete_user_admin(user_id=user_id)
    except ValueError:
        raise _err.NotFound("User not found")
    except IntegrityError:
        raise _err.Conflict("This user has data (portfolio, budget or watchlist); deactivate them instead")
