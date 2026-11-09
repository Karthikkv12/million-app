"""optionflow/modules/notify/service.py — phone notifications (Web Push) for the hedge desk.

What gets pushed (owner, 2026-11-09), from the same live books the Hedge page shows:
- Buy back: a short option has given up most of its premium (hedge `closes`).
- Trade: the desk's suggestion turns into a trade (sell call / sell put / buy stock).
Each alert is sent once per day per contract (key below); the set of sent keys lives in memory, so a server
restart can repeat that day's alerts at most once.

Config (server env; the module is a no-op without the keys):
- PUSH_VAPID_PRIVATE_KEY, PUSH_VAPID_PUBLIC_KEY: base64url P-256 key pair
  (`python -m optionflow.modules.notify.webpush` prints a fresh pair)
- PUSH_CONTACT: "mailto:you@example.com", sent to the push services with each message (RFC 8292)
"""
from __future__ import annotations

import logging
import os
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple
from zoneinfo import ZoneInfo

from optionflow.core.db import get_session
from optionflow.modules.notify import webpush

logger = logging.getLogger("optionflow.notify")
ET = ZoneInfo("America/New_York")
MAX_PER_CYCLE = 6                     # more than this in one minute → one summary instead


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


# ── Config ────────────────────────────────────────────────────────────────────
def config() -> Tuple[Optional[Any], Optional[str], str]:
    """(private key, public key b64, contact); (None, None, …) when push isn't configured."""
    priv_b64 = os.environ.get("PUSH_VAPID_PRIVATE_KEY", "").strip()
    contact = os.environ.get("PUSH_CONTACT", "").strip() or "mailto:admin@optflw.com"
    if not priv_b64:
        return None, None, contact
    try:
        priv = webpush.private_key_from_b64(priv_b64)
    except Exception:
        logger.error("PUSH_VAPID_PRIVATE_KEY is not a base64url P-256 key; push disabled")
        return None, None, contact
    return priv, webpush.public_key_b64(priv), contact


# ── Subscriptions ─────────────────────────────────────────────────────────────
def subscribe(user_id: int, endpoint: str, p256dh: str, auth: str, user_agent: Optional[str]) -> None:
    from database.models import PushSubscription as Sub
    s = get_session()
    try:
        row = s.query(Sub).filter(Sub.endpoint == endpoint).first()
        if row is None:
            row = Sub(endpoint=endpoint, created_at=now_iso())
            s.add(row)
        row.user_id, row.p256dh, row.auth, row.user_agent = user_id, p256dh, auth, (user_agent or "")[:300]
        s.commit()
    finally:
        s.close()


def unsubscribe(user_id: int, endpoint: str) -> int:
    from database.models import PushSubscription as Sub
    s = get_session()
    try:
        n = s.query(Sub).filter(Sub.user_id == user_id, Sub.endpoint == endpoint).delete()
        s.commit()
        return n
    finally:
        s.close()


def subscriptions(user_id: Optional[int] = None) -> List[Dict[str, Any]]:
    from database.models import PushSubscription as Sub
    s = get_session()
    try:
        q = s.query(Sub)
        if user_id is not None:
            q = q.filter(Sub.user_id == user_id)
        return [{c: getattr(r, c) for c in ("id", "user_id", "endpoint", "p256dh", "auth", "user_agent", "created_at", "last_ok_at")}
                for r in q.order_by(Sub.id).all()]
    finally:
        s.close()


def _mark(sub_id: int, ok: bool) -> None:
    from database.models import PushSubscription as Sub
    s = get_session()
    try:
        if ok:
            s.query(Sub).filter(Sub.id == sub_id).update({"last_ok_at": now_iso()})
        else:
            s.query(Sub).filter(Sub.id == sub_id).delete()
        s.commit()
    finally:
        s.close()


# ── Sending ───────────────────────────────────────────────────────────────────
def push_user(user_id: int, payload: Dict[str, Any], sender=None) -> Dict[str, int]:
    """Send one notification to every device of a user. Returns {"sent", "failed", "removed"}."""
    sender = sender or webpush.send
    priv, _pub, contact = config()
    out = {"sent": 0, "failed": 0, "removed": 0}
    if priv is None:
        return out
    for sub in subscriptions(user_id):
        try:
            r = sender(sub["endpoint"], sub["p256dh"], sub["auth"], payload, priv, contact)
        except Exception as e:
            logger.warning("push to sub %s failed: %s", sub["id"], e)
            out["failed"] += 1
            continue
        if r.gone:
            _mark(sub["id"], ok=False)
            out["removed"] += 1
        elif 200 <= r.status < 300:
            _mark(sub["id"], ok=True)
            out["sent"] += 1
        else:
            logger.warning("push service answered %s for sub %s", r.status, sub["id"])
            out["failed"] += 1
    return out


# ── Alerts from the hedge books ───────────────────────────────────────────────
def alerts_for(books: Dict[str, Any]) -> List[Dict[str, Any]]:
    """[{key, title, body, url}] for everything worth a push right now."""
    out: List[Dict[str, Any]] = []
    for b in books.get("books", []):
        if b.get("error"):
            continue
        sym = b["symbol"]
        for c in b.get("closes") or []:
            k = f"{c['strike']:g}{'C' if c['otype'] == 'call' else 'P'}"
            out.append({
                "key": f"bb:{sym}:{k}:{c['expiry']}",
                "title": f"Buy back {sym} {k} {c['expiry'][5:]}",
                "body": f"{round(c['profit_pct'] * 100)}% of the premium is in. ~${c['mark']:.2f} to close "
                        f"(sold ${c['sold_at']:.2f}); you keep ${c['kept']:,.0f}.",
                "url": "/hedge",
            })
        s = b.get("suggestion") or {}
        act = s.get("action")
        if act in ("SELL_CALL", "SELL_PUT"):
            k = f"{s['strike']:g}{'C' if act == 'SELL_CALL' else 'P'}"
            out.append({
                "key": f"sg:{sym}:{act}:{k}:{s.get('expiry')}",
                "title": f"{'Sell call' if act == 'SELL_CALL' else 'Sell put'}: {sym} {k} {(s.get('expiry') or '')[5:]}",
                "body": f"{s.get('contracts', 1)}× for ~${abs(s.get('credit') or 0):,.0f}. {(s.get('reasons') or [''])[0]}",
                "url": "/hedge",
            })
        elif act == "BUY_STOCK":
            out.append({
                "key": f"sg:{sym}:BUY_STOCK:{s.get('shares')}",
                "title": f"Buy stock: {sym} +{s.get('shares')} sh",
                "body": s.get("headline", ""),
                "url": "/hedge",
            })
    return out


class _Sent:
    """Keys already pushed today (ET), per user."""
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._day: str = ""
        self._keys: Dict[int, Set[str]] = {}

    def new(self, user_id: int, keys: List[str]) -> List[str]:
        today = datetime.now(ET).date().isoformat()
        with self._lock:
            if today != self._day:
                self._day, self._keys = today, {}
            seen = self._keys.setdefault(user_id, set())
            fresh = [k for k in keys if k not in seen]
            seen.update(fresh)
            return fresh


SENT = _Sent()


def run_for_user(user_id: int, books_fn=None, sender=None) -> int:
    """Compute alerts for one user, push the new ones. Returns how many notifications went out."""
    if books_fn is None:
        from optionflow.modules.hedge import service as hedge
        books_fn = hedge.books_for
    alerts = alerts_for(books_fn(user_id))
    fresh = set(SENT.new(user_id, [a["key"] for a in alerts]))
    todo = [a for a in alerts if a["key"] in fresh]
    if not todo:
        return 0
    if len(todo) > MAX_PER_CYCLE:
        todo = [{"key": "summary", "title": f"{len(todo)} actions on your book",
                 "body": ", ".join(a["title"] for a in todo[:4]) + "…", "url": "/dashboard"}]
    n = 0
    for a in todo:
        r = push_user(user_id, {"title": a["title"], "body": a["body"], "url": a["url"], "tag": a["key"]}, sender=sender)
        n += r["sent"]
    return n


def market_open(now: Optional[datetime] = None) -> bool:
    t = (now or datetime.now(ET)).astimezone(ET)
    return t.weekday() < 5 and (9, 30) <= (t.hour, t.minute) < (16, 5)
