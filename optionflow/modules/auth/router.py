"""optionflow/modules/auth/router.py — /auth and /admin routes (HTTP only)."""
from __future__ import annotations

from typing import List, Optional, Tuple

from fastapi import APIRouter, Depends, Request, Response

from optionflow.core import errors
from optionflow.core.deps import get_current_user, require_admin
from optionflow.core.settings import get_settings
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


# ── Refresh-token cookie ──────────────────────────────────────────────────────
# Browsers keep the refresh token only in an HttpOnly cookie scoped to /api/v1/auth, so page scripts
# (and anything injected into the page) can never read it. Browser clients send `X-Token-Transport: cookie`
# and get no refresh token in the JSON body; other clients (scripts, apps) keep receiving it in the body.

def _wants_cookie_only(request: Request) -> bool:
    return request.headers.get("x-token-transport", "").strip().lower() == "cookie"


def _secure(request: Request) -> bool:
    forced = get_settings().refresh_cookie_secure
    if forced is not None:
        return bool(forced)
    proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
    return proto == "https" or request.url.scheme == "https"


def _set_cookie(request: Request, response: Response, token: str) -> None:
    s = get_settings()
    response.set_cookie(
        s.refresh_cookie_name, token, max_age=int(s.refresh_token_expires_days) * 86400,
        path=s.refresh_cookie_path, httponly=True, secure=_secure(request), samesite="strict",
    )


def _clear_cookie(response: Response) -> None:
    s = get_settings()
    response.delete_cookie(s.refresh_cookie_name, path=s.refresh_cookie_path, httponly=True, samesite="strict")


def _issue(request: Request, response: Response, bundle: dict) -> AuthResponse:
    """Put a fresh refresh token in the cookie (and, for non-browser clients, the body)."""
    rt = bundle.get("refresh_token")
    if rt:
        _set_cookie(request, response, rt)
    if _wants_cookie_only(request):
        bundle = {**bundle, "refresh_token": None}
    return AuthResponse(**bundle)


@router.post("/signup", response_model=AuthResponse)
def signup(req: AuthSignupRequest) -> AuthResponse:
    raise errors.Forbidden("Registration is not open at this time.")


@router.post("/login", response_model=AuthResponse)
def login(req: AuthLoginRequest, request: Request, response: Response) -> AuthResponse:
    ip, ua = _client(request)
    return _issue(request, response, service.login(req.username, req.password, ip=ip, user_agent=ua))


@router.post("/refresh", response_model=AuthResponse)
def refresh(request: Request, response: Response, req: Optional[AuthRefreshRequest] = None) -> AuthResponse:
    ip, ua = _client(request)
    token = (req.refresh_token if req else None) or request.cookies.get(get_settings().refresh_cookie_name)
    if not token:
        raise errors.Unauthorized("Not signed in")
    try:
        bundle = service.refresh_session(token, ip=ip, user_agent=ua)
    except errors.Unauthorized as exc:
        # A dead cookie is useless: drop it so the browser stops sending it.
        out = errors._respond(request, exc.status_code, exc.code, exc.message)
        _clear_cookie(out)
        return out
    return _issue(request, response, bundle)


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
def logout(request: Request, response: Response, req: Optional[AuthLogoutRequest] = None,
           user=Depends(get_current_user)) -> StatusOut:
    token = (req.refresh_token if req else None) or request.cookies.get(get_settings().refresh_cookie_name)
    service.logout(user, refresh_token=token)
    _clear_cookie(response)
    return StatusOut()


@router.post("/logout-all", response_model=StatusOut)
def logout_all(response: Response, user=Depends(get_current_user)) -> StatusOut:
    service.logout_everywhere(user)
    _clear_cookie(response)
    return StatusOut()


@router.post("/change-password", response_model=AuthResponse)
def change_password(req: AuthChangePasswordRequest, request: Request, response: Response,
                    user=Depends(get_current_user)) -> AuthResponse:
    return _issue(request, response, service.change_own_password(user, req.current_password, req.new_password))


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
