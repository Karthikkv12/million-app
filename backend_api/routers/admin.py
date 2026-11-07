"""backend_api/routers/admin.py — Admin user-management routes."""
from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, Depends

from optionflow.core.deps import require_admin
from .. import schemas
from logic import auth_services

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users", response_model=List[schemas.AdminUserOut])
def admin_list_users(_admin=Depends(require_admin)) -> List[schemas.AdminUserOut]:
    """Return all users (admin only)."""
    users = auth_services.list_all_users()
    return [schemas.AdminUserOut.model_validate(u) for u in users]


@router.post("/users", response_model=schemas.AdminUserOut, status_code=201)
def admin_create_user(
    body: schemas.AdminCreateUserRequest,
    _admin=Depends(require_admin),
) -> Dict[str, Any]:
    """Create a new user (admin only)."""
    existing = auth_services.get_user_by_username(body.username)
    if existing:
        raise HTTPException(status_code=409, detail="Username already exists")
    new_id = auth_services.create_user(
        username=body.username,
        password=body.password,
        role=body.role or "user",
    )
    user = auth_services.get_user(new_id)
    if not user:
        raise HTTPException(status_code=500, detail="User created but could not be retrieved")
    return schemas.AdminUserOut.model_validate(user)


@router.delete("/users/{user_id}", status_code=204)
def admin_delete_user(user_id: int, _admin=Depends(require_admin)) -> None:
    """Delete a user by ID (admin only)."""
    try:
        auth_services.delete_user_admin(user_id=user_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="User not found")


@router.patch("/users/{user_id}", response_model=schemas.AdminUserOut)
def admin_patch_user(
    user_id: int,
    body: schemas.AdminPatchUserRequest,
    _admin=Depends(require_admin),
) -> Dict[str, Any]:
    """Patch a user's fields (admin only). Only provided fields are updated."""
    if not any([body.username, body.password, body.role is not None, body.is_active is not None]):
        raise HTTPException(status_code=422, detail="No fields to update")

    # Handle username change
    if body.username is not None:
        try:
            auth_services.update_username_admin(user_id, body.username)
        except ValueError as e:
            raise HTTPException(status_code=404 if "not found" in str(e) else 409, detail=str(e))

    # Handle password change (admin force-set)
    if body.password is not None:
        try:
            auth_services.admin_set_password(user_id, body.password)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    # Handle role / is_active
    if body.role is not None or body.is_active is not None:
        try:
            auth_services.patch_user_admin(user_id, role=body.role, is_active=body.is_active)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

    user = auth_services.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return schemas.AdminUserOut.model_validate(user)
