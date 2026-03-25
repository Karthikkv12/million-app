"""backend_api/deps.py — Shared FastAPI dependency functions."""
from __future__ import annotations

import logging
from typing import Any, Dict

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from logic import services
from .security import decode_token

logger = logging.getLogger("optionflow.deps")

_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> Dict[str, Any]:
    """Validate Bearer token and return the decoded JWT payload.

    Raises 401 if token is missing, invalid, revoked, or expired relative to
    the user's ``valid_after`` timestamp.
    """
    if creds is None:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    try:
        payload = decode_token(creds.credentials)
        if "sub" not in payload:
            raise ValueError("missing sub claim")

        # Check revocation via JTI
        jti = str(payload.get("jti") or "").strip()
        if jti and services.is_token_revoked(jti=jti):
            raise HTTPException(status_code=401, detail="Token has been revoked")

        # Check user-level valid_after guard
        token_iat = int(payload.get("iat") or 0)
        if not services.is_token_time_valid(
            user_id=int(payload["sub"]), token_iat=token_iat
        ):
            raise HTTPException(status_code=401, detail="Token is no longer valid.")

        return payload
    except HTTPException:
        raise
    except Exception as exc:
        logger.debug("Token validation failed: %s", exc)
        raise HTTPException(status_code=401, detail="Invalid token")


def require_admin(
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    """Extend ``get_current_user`` — additionally require admin role."""
    if str(user.get("role") or "user") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
