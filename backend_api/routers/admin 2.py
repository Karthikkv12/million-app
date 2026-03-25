"""backend_api/routers/admin.py — Admin user-management routes."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Depends

from ..deps import require_admin
from .. import schemas
from logic import services

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users", response_model=List[schemas.AdminUserOut])
def admin_list_users(_admin=Depends(require_admin)) -> List[schemas.AdminUserOut]:
    """Return all users (admin only)."""
    return [schemas.AdminUserOut.model_validate(u) for u in services.list_users()]


@router.post("/users", response_model=schemas.AdminUserOut, status_code=201)
def admin_create_user(
    body: schemas.AdminCreateUserRequest,
    _admin=Depends(require_admin),
) -> Dict[str, Any]:
    """Create a new user (admin only)."""
    existing = services.get_user_by_username(body.username)
    if existing:
        raise HTTPException(status_code=409, detail="Username already exists")
    user = services.create_user(
        username=body.username,
        password=body.password,
        role=body.role or "user",
    )
    return schemas.AdminUserOut.model_validate(user)


@router.delete("/users/{user_id}", status_code=204)
def admin_delete_user(user_id: int, _admin=Depends(require_admin)) -> None:
    """Delete a user by ID (admin only)."""
    ok = services.delete_user(user_id=user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="User not found")


@router.patch("/users/{user_id}", response_model=schemas.AdminUserOut)
def admin_patch_user(
    user_id: int,
    body: schemas.AdminPatchUserRequest,
    _admin=Depends(require_admin),
) -> Dict[str, Any]:
    """Patch a user's fields (admin only). Only provided fields are updated."""
    updates: Dict[str, Any] = {}
    if body.username is not None:
        updates["username"] = body.username
    if body.password is not None:
        updates["password"] = body.password
    if body.role is not None:
        updates["role"] = body.role
    if body.is_active is not None:
        updates["is_active"] = body.is_active
    if not updates:
        raise HTTPException(status_code=422, detail="No fields to update")
    user = services.update_user(user_id=user_id, **updates)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return schemas.AdminUserOut.model_validate(user)
