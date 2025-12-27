import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import jwt


def _jwt_secret() -> str:
    secret = os.getenv("JWT_SECRET")
    if not secret:
        # Dev-friendly default; set JWT_SECRET in production.
        secret = "dev-insecure-secret"
    return secret


def create_access_token(*, subject: str, extra: Optional[Dict[str, Any]] = None, expires_minutes: int = 60 * 24) -> str:
    now = datetime.now(timezone.utc)
    payload: Dict[str, Any] = {
        "sub": subject,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=expires_minutes)).timestamp()),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, _jwt_secret(), algorithm="HS256")


def decode_token(token: str) -> Dict[str, Any]:
    return jwt.decode(token, _jwt_secret(), algorithms=["HS256"])
