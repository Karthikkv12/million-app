"""optionflow/modules/notify/schemas.py — request/response models."""
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class NotificationOut(BaseModel):
    id: int
    kind: str = Field(..., description="buyback · sell_call · sell_put · buy_stock · iv_spike · expiring_itm · levels · "
                                        "price_alert · paper_open / paper_stopped / paper_target · report · test")
    symbol: Optional[str] = None
    title: str
    body: Optional[str] = None
    url: Optional[str] = Field(None, description="In-app path to open")
    created_at: str = Field(..., description="ISO UTC")
    read: bool


class InboxOut(BaseModel):
    items: List[NotificationOut] = []
    unread: int = 0


class ReadIn(BaseModel):
    ids: Optional[List[int]] = Field(None, description="Mark these read; omit to mark everything read")


class UnreadOut(BaseModel):
    unread: int


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
    levels: bool = Field(True, description="A dealer level moved (call wall, put wall, king, flip) or spot crossed the flip")
    signals: bool = Field(True, description="A holding's backtested signal turns Add, Exit, Take profit or Roll (once per 7 days)")
    symbols: List[str] = Field([], max_length=100, description="Only these symbols; empty = every holding")
    level_symbols: List[str] = Field([], max_length=20, description="Extra tickers watched for level alerts "
                                     "(e.g. SPY, QQQ), on top of the holdings")


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
