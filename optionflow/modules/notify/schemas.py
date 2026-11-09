"""optionflow/modules/notify/schemas.py — request/response models."""
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class PushConfigOut(BaseModel):
    enabled: bool = Field(..., description="Push is configured on the server (VAPID keys set)")
    public_key: Optional[str] = Field(None, description="VAPID public key, base64url; pass to pushManager.subscribe")


class SubscriptionKeys(BaseModel):
    p256dh: str = Field(..., max_length=200)
    auth: str = Field(..., max_length=100)


class SubscriptionIn(BaseModel):
    endpoint: str = Field(..., max_length=1000, pattern=r"^https://")
    keys: SubscriptionKeys


class UnsubscribeIn(BaseModel):
    endpoint: str = Field(..., max_length=1000)


class DeviceOut(BaseModel):
    id: int
    user_agent: Optional[str] = None
    created_at: str
    last_ok_at: Optional[str] = None


class TestOut(BaseModel):
    sent: int
    failed: int
    removed: int
    devices: int
    devices_out: List[DeviceOut] = []
