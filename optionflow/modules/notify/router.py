"""optionflow/modules/notify/router.py — /notify: turn phone notifications on/off, send a test."""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request

from optionflow.core.deps import get_current_user
from optionflow.modules.notify import service
from optionflow.modules.notify.schemas import (DeviceOut, InboxOut, NotifyPrefs, PushConfigOut, ReadIn, SubscriptionIn, TestOut,
                                               UnreadOut, UnsubscribeIn)

router = APIRouter(prefix="/notify", tags=["notify"])


@router.get("/inbox", response_model=InboxOut)
def inbox(limit: int = 200, user=Depends(get_current_user)) -> InboxOut:
    """The Notification Center: the newest notifications (all kinds) and how many are unread."""
    return InboxOut(**service.inbox(int(user["sub"]), limit))


@router.post("/inbox/read", response_model=UnreadOut)
def inbox_read(body: ReadIn, user=Depends(get_current_user)) -> UnreadOut:
    """Mark some (ids) or all notifications read."""
    return UnreadOut(unread=service.mark_read(int(user["sub"]), body.ids))


@router.delete("/inbox", response_model=UnreadOut)
def inbox_clear(user=Depends(get_current_user)) -> UnreadOut:
    """Delete every notification."""
    service.clear(int(user["sub"]))
    return UnreadOut(unread=0)


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
    service.record(uid, [{"key": f"test:{service.now_iso()}", "kind": "test", "title": "Test notification",
                          "body": "Notifications are on. Buy-backs and trades will show here.", "url": "/dashboard"}])
    devs = service.subscriptions(uid)
    return TestOut(**r, devices=len(devs), devices_out=[DeviceOut(**d) for d in devs])


@router.get("/prefs", response_model=NotifyPrefs)
def get_prefs(user=Depends(get_current_user)) -> NotifyPrefs:
    """Which alerts are pushed, and for which symbols (the same on every device)."""
    return NotifyPrefs(**service.get_prefs(int(user["sub"])))


@router.put("/prefs", response_model=NotifyPrefs)
def put_prefs(body: NotifyPrefs, user=Depends(get_current_user)) -> NotifyPrefs:
    uid = int(user["sub"])
    if not service.subscriptions(uid):
        raise HTTPException(status_code=409, detail="Turn notifications on for a device first")
    return NotifyPrefs(**service.set_prefs(uid, body.model_dump()))
