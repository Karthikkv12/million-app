"""backend_api/schemas/auth.py — Auth, session, and admin Pydantic models."""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


# ── Auth ──────────────────────────────────────────────────────────────────────

class AuthSignupRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class AuthLoginRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class AuthResponse(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None
    token_type: str = "bearer"
    user_id: int
    username: str
    role: str = "user"


class AuthMeResponse(BaseModel):
    user_id: int
    username: str
    role: str = "user"


class AuthChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=1)


class AuthRefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1)


class AuthLogoutRequest(BaseModel):
    refresh_token: Optional[str] = None


class AuthEventOut(BaseModel):
    created_at: Optional[datetime] = None
    event_type: str
    success: bool
    ip: Optional[str] = None
    detail: Optional[str] = None


class AuthSessionOut(BaseModel):
    id: int
    created_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None
    ip: Optional[str] = None
    user_agent: Optional[str] = None
    expires_at: Optional[datetime] = None


# ── Admin ─────────────────────────────────────────────────────────────────────

class AdminUserOut(BaseModel):
    user_id: int
    username: str
    role: str
    is_active: bool
    created_at: Optional[datetime] = None


class AdminCreateUserRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=6)
    role: str = Field(default="user", pattern="^(admin|user)$")


class AdminPatchUserRequest(BaseModel):
    username: Optional[str] = Field(default=None, min_length=1)
    password: Optional[str] = Field(default=None, min_length=6)
    role: Optional[str] = Field(default=None, pattern="^(admin|user)$")
    is_active: Optional[bool] = None
