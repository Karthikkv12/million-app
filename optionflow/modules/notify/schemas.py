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


class NotifyPrefs(BaseModel):
    buyback: bool = Field(True, description="A short option has given up most of its premium")
    sell_call: bool = True
    sell_put: bool = True
    buy_stock: bool = True
    iv_spike: bool = Field(False, description="ATM IV spikes on a holding")
    expiring_itm: bool = Field(False, description="A short option is in the money with ≤ 1 day left")
    symbols: List[str] = Field([], max_length=100, description="Only these symbols; empty = every holding")


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
