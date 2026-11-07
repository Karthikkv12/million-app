"""backend_api/routers/auth.py — Authentication & session management routes."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Request

from logic import auth_services
from ..schemas import (
    AuthChangePasswordRequest,
    AuthEventOut,
    AuthLoginRequest,
    AuthLogoutRequest,
    AuthMeResponse,
    AuthRefreshRequest,
    AuthResponse,
    AuthSessionOut,
    AuthSignupRequest,
)

logger = logging.getLogger("optionflow.auth")
from ..security import create_access_token
from optionflow.core.deps import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=AuthResponse)
def signup(req: AuthSignupRequest, request: Request) -> AuthResponse:
    # Registration is currently closed.
    raise HTTPException(status_code=403, detail="Registration is not open at this time.")


@router.post("/login", response_model=AuthResponse)
def login(req: AuthLoginRequest, request: Request) -> AuthResponse:
    username = str(req.username).strip().lower()
    ip = getattr(getattr(request, "client", None), "host", None)
    ua = request.headers.get("user-agent")

    try:
        if auth_services.is_login_rate_limited(username=username, ip=str(ip) if ip else None):
            auth_services.log_auth_event(
                event_type="login_throttled", success=False,
                username=username, ip=str(ip) if ip else None, user_agent=ua,
            )
            raise HTTPException(status_code=429, detail="Too many login attempts. Please try again later.")
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Rate-limit check failed for login (%s): %s", username, exc)

    auth_result = auth_services.authenticate_user(username, req.password)
    if not auth_result:
        auth_services.log_auth_event(
            event_type="login", success=False, username=username,
            ip=str(ip) if ip else None, user_agent=ua, detail="invalid credentials",
        )
        raise HTTPException(status_code=401, detail="Invalid username or password")

    user_id = auth_result["user_id"]
    role = auth_result.get("role", "user")
    token = create_access_token(subject=str(user_id), extra={"username": username, "role": role})
    refresh_token = auth_services.create_refresh_token(
        user_id=int(user_id), ip=str(ip) if ip else None, user_agent=ua
    )
    auth_services.log_auth_event(
        event_type="login", success=True, username=username,
        user_id=int(user_id), ip=str(ip) if ip else None, user_agent=ua,
    )
    return AuthResponse(
        access_token=token, refresh_token=refresh_token,
        user_id=int(user_id), username=username, role=role,
    )


@router.post("/refresh", response_model=AuthResponse)
def refresh(req: AuthRefreshRequest, request: Request) -> AuthResponse:
    ip = getattr(getattr(request, "client", None), "host", None)
    ua = request.headers.get("user-agent")

    try:
        if auth_services.is_refresh_rate_limited(ip=str(ip) if ip else None):
            auth_services.log_auth_event(
                event_type="refresh_throttled", success=False,
                ip=str(ip) if ip else None, user_agent=ua,
            )
            raise HTTPException(status_code=429, detail="Too many refresh attempts. Please try again later.")
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Rate-limit check failed for refresh: %s", exc)

    rotated = auth_services.rotate_refresh_token(
        refresh_token=req.refresh_token, ip=str(ip) if ip else None, user_agent=ua
    )
    if not rotated:
        auth_services.log_auth_event(
            event_type="refresh", success=False,
            ip=str(ip) if ip else None, user_agent=ua, detail="invalid refresh token",
        )
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    user_id, new_refresh_token = rotated
    u = auth_services.get_user(int(user_id))
    username = str(getattr(u, "username", "") or "") if u is not None else ""
    role = str(getattr(u, "role", None) or "user") if u is not None else "user"
    token = create_access_token(subject=str(user_id), extra={"username": username, "role": role})
    auth_services.log_auth_event(
        event_type="refresh", success=True, username=username,
        user_id=int(user_id), ip=str(ip) if ip else None, user_agent=ua,
    )
    return AuthResponse(
        access_token=token, refresh_token=new_refresh_token,
        user_id=int(user_id), username=username, role=role,
    )


@router.get("/events", response_model=List[AuthEventOut])
def auth_events(user=Depends(get_current_user)) -> List[AuthEventOut]:
    rows = auth_services.list_auth_events(user_id=int(user["sub"]), limit=25)
    return [AuthEventOut.model_validate(r) for r in rows]


@router.get("/me", response_model=AuthMeResponse)
def me(user=Depends(get_current_user)) -> AuthMeResponse:
    user_id = int(user["sub"])
    username = str(user.get("username") or "")
    role = str(user.get("role") or "user")
    u = auth_services.get_user(user_id)
    if u is not None:
        username = str(getattr(u, "username", username) or username)
        role = str(getattr(u, "role", None) or role)
    return AuthMeResponse(user_id=user_id, username=username, role=role)


@router.post("/logout")
def logout(req: AuthLogoutRequest | None = None, user=Depends(get_current_user)) -> Dict[str, str]:
    user_id = int(user["sub"])
    jti = str(user.get("jti") or "").strip()
    exp_raw = user.get("exp")
    try:
        exp_dt = datetime.fromtimestamp(int(exp_raw), tz=timezone.utc)
    except Exception:
        exp_dt = datetime.now(timezone.utc)
    if jti:
        auth_services.revoke_token(user_id=user_id, jti=jti, expires_at=exp_dt)
    try:
        if req is not None and getattr(req, "refresh_token", None):
            auth_services.revoke_refresh_token(user_id=user_id, refresh_token=str(req.refresh_token))
    except Exception as exc:
        logger.warning("Failed to revoke refresh token on logout for user %s: %s", user_id, exc)
    auth_services.log_auth_event(
        event_type="logout", success=True,
        username=str(user.get("username") or ""), user_id=user_id,
    )
    return {"status": "ok"}


@router.post("/logout-all")
def logout_all(user=Depends(get_current_user)) -> Dict[str, str]:
    user_id = int(user["sub"])
    token_iat = int(user.get("iat") or 0)
    auth_services.set_auth_valid_after_epoch(user_id=user_id, epoch_seconds=int(token_iat) + 1)
    try:
        auth_services.revoke_all_refresh_tokens(user_id=user_id)
    except Exception as exc:
        logger.warning("revoke_all_refresh_tokens failed on logout_all for user %s: %s", user_id, exc)
    jti = str(user.get("jti") or "").strip()
    exp_raw = user.get("exp")
    try:
        exp_dt = datetime.fromtimestamp(int(exp_raw), tz=timezone.utc)
    except Exception:
        exp_dt = datetime.now(timezone.utc)
    if jti:
        auth_services.revoke_token(user_id=user_id, jti=jti, expires_at=exp_dt)
    auth_services.log_auth_event(
        event_type="logout_all", success=True,
        username=str(user.get("username") or ""), user_id=user_id,
    )
    return {"status": "ok"}


@router.post("/change-password", response_model=AuthResponse)
def change_password(req: AuthChangePasswordRequest, user=Depends(get_current_user)) -> AuthResponse:
    user_id = int(user["sub"])
    username = str(user.get("username") or "")
    try:
        auth_services.change_password(
            user_id=user_id,
            old_password=req.current_password,
            new_password=req.new_password,
            invalidate_tokens_before_epoch=int(user.get("iat") or 0) + 1,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        auth_services.revoke_all_refresh_tokens(user_id=user_id)
    except Exception as exc:
        logger.warning("revoke_all_refresh_tokens failed on change_password for user %s: %s", user_id, exc)
    auth_services.log_auth_event(
        event_type="change_password", success=True,
        username=str(user.get("username") or ""), user_id=user_id,
    )
    issued_at = datetime.fromtimestamp(int(user.get("iat") or 0) + 1, tz=timezone.utc)
    token = create_access_token(
        subject=str(user_id), extra={"username": username}, issued_at=issued_at
    )
    refresh_token = auth_services.create_refresh_token(user_id=int(user_id))
    return AuthResponse(
        access_token=token, refresh_token=refresh_token,
        user_id=int(user_id), username=username,
    )


@router.get("/sessions", response_model=List[AuthSessionOut])
def auth_sessions(user=Depends(get_current_user)) -> List[AuthSessionOut]:
    rows = auth_services.list_refresh_sessions(user_id=int(user["sub"]), limit=25)
    return [AuthSessionOut.model_validate(r) for r in rows]


@router.post("/sessions/{session_id}/revoke")
def revoke_session(session_id: int, user=Depends(get_current_user)) -> Dict[str, str]:
    user_id = int(user["sub"])
    ok = auth_services.revoke_refresh_session_by_id(
        user_id=user_id, session_id=int(session_id), reason="revoked"
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Session not found")
    auth_services.log_auth_event(
        event_type="revoke_session", success=True,
        username=str(user.get("username") or ""), user_id=user_id,
    )
    return {"status": "ok"}
