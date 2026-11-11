"""optionflow/modules/auth/router.py — /auth and /admin routes (HTTP only)."""
from __future__ import annotations

from typing import List, Optional, Tuple

from fastapi import APIRouter, Depends, Request

from optionflow.core import errors
from optionflow.core.deps import get_current_user, require_admin
from optionflow.modules.auth import service
from optionflow.modules.auth.schemas import (
    AdminCreateUserRequest, AdminPatchUserRequest, AdminUserOut,
    AuthChangePasswordRequest, AuthEventOut, AuthLoginRequest, AuthLogoutRequest,
    AuthMeResponse, AuthRefreshRequest, AuthResponse, AuthSessionOut, AuthSignupRequest,
    StatusOut,
)

router = APIRouter(prefix="/auth", tags=["auth"])
admin_router = APIRouter(prefix="/admin", tags=["admin"])


def _client(request: Request) -> Tuple[Optional[str], Optional[str]]:
    host = getattr(getattr(request, "client", None), "host", None)
    return (str(host) if host else None), request.headers.get("user-agent")


@router.post("/signup", response_model=AuthResponse)
def signup(req: AuthSignupRequest) -> AuthResponse:
    raise errors.Forbidden("Registration is not open at this time.")


@router.post("/login", response_model=AuthResponse)
def login(req: AuthLoginRequest, request: Request) -> AuthResponse:
    ip, ua = _client(request)
    return AuthResponse(**service.login(req.username, req.password, ip=ip, user_agent=ua))


@router.post("/refresh", response_model=AuthResponse)
def refresh(req: AuthRefreshRequest, request: Request) -> AuthResponse:
    ip, ua = _client(request)
    return AuthResponse(**service.refresh_session(req.refresh_token, ip=ip, user_agent=ua))


@router.get("/me", response_model=AuthMeResponse)
def me(user=Depends(get_current_user)) -> AuthMeResponse:
    return AuthMeResponse(**service.profile(user))


@router.get("/events", response_model=List[AuthEventOut])
def events(user=Depends(get_current_user)) -> List[AuthEventOut]:
    return [AuthEventOut.model_validate(r) for r in service.list_auth_events(user_id=int(user["sub"]), limit=25)]


@router.get("/sessions", response_model=List[AuthSessionOut])
def sessions(user=Depends(get_current_user)) -> List[AuthSessionOut]:
    return [AuthSessionOut.model_validate(r) for r in service.list_refresh_sessions(user_id=int(user["sub"]), limit=25)]


@router.post("/sessions/{session_id}/revoke", response_model=StatusOut)
def revoke_session(session_id: int, user=Depends(get_current_user)) -> StatusOut:
    service.revoke_own_session(user, session_id)
    return StatusOut()


@router.post("/logout", response_model=StatusOut)
def logout(req: Optional[AuthLogoutRequest] = None, user=Depends(get_current_user)) -> StatusOut:
    service.logout(user, refresh_token=req.refresh_token if req else None)
    return StatusOut()


@router.post("/logout-all", response_model=StatusOut)
def logout_all(user=Depends(get_current_user)) -> StatusOut:
    service.logout_everywhere(user)
    return StatusOut()


@router.post("/change-password", response_model=AuthResponse)
def change_password(req: AuthChangePasswordRequest, user=Depends(get_current_user)) -> AuthResponse:
    return AuthResponse(**service.change_own_password(user, req.current_password, req.new_password))


# ── Admin ─────────────────────────────────────────────────────────────────────
@admin_router.get("/users", response_model=List[AdminUserOut])
def admin_list_users(_admin=Depends(require_admin)) -> List[AdminUserOut]:
    return [AdminUserOut.model_validate(u) for u in service.list_all_users()]


@admin_router.post("/users", response_model=AdminUserOut, status_code=201)
def admin_create_user(body: AdminCreateUserRequest, _admin=Depends(require_admin)) -> AdminUserOut:
    return AdminUserOut.model_validate(service.admin_create_user(body.username, body.password, body.role))


@admin_router.patch("/users/{user_id}", response_model=AdminUserOut)
def admin_patch_user(user_id: int, body: AdminPatchUserRequest, _admin=Depends(require_admin)) -> AdminUserOut:
    return AdminUserOut.model_validate(service.admin_update_user(
        user_id, username=body.username, password=body.password, role=body.role, is_active=body.is_active))


@admin_router.delete("/users/{user_id}", status_code=204)
def admin_delete_user(user_id: int, _admin=Depends(require_admin)) -> None:
    service.admin_delete_user(user_id)
