"""optionflow/modules/notify/router.py — /notify: turn phone notifications on/off, send a test."""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request

from optionflow.core.deps import get_current_user
from optionflow.modules.notify import service
from optionflow.modules.notify.schemas import DeviceOut, PushConfigOut, SubscriptionIn, TestOut, UnsubscribeIn

router = APIRouter(prefix="/notify", tags=["notify"])


@router.get("/config", response_model=PushConfigOut)
def push_config(_user=Depends(get_current_user)) -> PushConfigOut:
    """Whether push is set up on the server, and the key the browser subscribes with."""
    priv, pub, _c = service.config()
    return PushConfigOut(enabled=priv is not None, public_key=pub)


@router.get("/devices", response_model=List[DeviceOut])
def devices(user=Depends(get_current_user)) -> List[DeviceOut]:
    return [DeviceOut(**d) for d in service.subscriptions(int(user["sub"]))]


@router.post("/subscriptions", response_model=List[DeviceOut])
def subscribe(body: SubscriptionIn, request: Request, user=Depends(get_current_user)) -> List[DeviceOut]:
    """Save this browser's push subscription (from pushManager.subscribe)."""
    priv, _pub, _c = service.config()
    if priv is None:
        raise HTTPException(status_code=503, detail="Notifications aren't set up on the server yet")
    uid = int(user["sub"])
    service.subscribe(uid, body.endpoint, body.keys.p256dh, body.keys.auth, request.headers.get("user-agent"))
    return [DeviceOut(**d) for d in service.subscriptions(uid)]


@router.post("/unsubscribe", response_model=List[DeviceOut])
def unsubscribe(body: UnsubscribeIn, user=Depends(get_current_user)) -> List[DeviceOut]:
    uid = int(user["sub"])
    service.unsubscribe(uid, body.endpoint)
    return [DeviceOut(**d) for d in service.subscriptions(uid)]


@router.post("/test", response_model=TestOut)
def test(user=Depends(get_current_user)) -> TestOut:
    """Send a test notification to every device of the signed-in user."""
    uid = int(user["sub"])
    r = service.push_user(uid, {"title": "OptionFlow", "body": "Notifications are on. Buy-backs and trades will show here.",
                                "url": "/dashboard", "tag": "test"})
    devs = service.subscriptions(uid)
    return TestOut(**r, devices=len(devs), devices_out=[DeviceOut(**d) for d in devs])
