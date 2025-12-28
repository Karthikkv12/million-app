import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import jwt


def _jwt_secret() -> str:
    secret = os.getenv("JWT_SECRET")
    if not secret:
        # Dev-friendly default; set JWT_SECRET in production.
        secret = "dev-insecure-secret"
    return secret


def _jwt_issuer() -> str:
    return os.getenv("JWT_ISSUER", "million-api")


def _jwt_audience() -> str:
    return os.getenv("JWT_AUDIENCE", "million-app")


def _default_access_minutes() -> int:
    try:
        # Default to short-lived access tokens; rely on refresh tokens for longevity.
        return int(os.getenv("ACCESS_TOKEN_EXPIRES_MINUTES", "15"))
    except Exception:
        return 15


def create_access_token(
    *,
    subject: str,
    extra: Optional[Dict[str, Any]] = None,
    expires_minutes: Optional[int] = None,
    issued_at: Optional[datetime] = None,
) -> str:
    now = datetime.now(timezone.utc) if issued_at is None else issued_at
    minutes = _default_access_minutes() if expires_minutes is None else int(expires_minutes)
    payload: Dict[str, Any] = {
        "sub": subject,
        "iss": _jwt_issuer(),
        "aud": _jwt_audience(),
        "jti": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=minutes)).timestamp()),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, _jwt_secret(), algorithm="HS256")


def decode_token(token: str) -> Dict[str, Any]:
    return jwt.decode(
        token,
        _jwt_secret(),
        algorithms=["HS256"],
        audience=_jwt_audience(),
        issuer=_jwt_issuer(),
        options={"require": ["sub", "exp", "iat", "jti", "iss", "aud"]},
    )
