"""optionflow/modules/notify/service.py — phone notifications (Web Push) for the hedge desk.

What gets pushed (owner, 2026-11-09), from the same live books the Hedge page shows. Each kind can be switched
off, and alerts can be limited to some symbols (prefs, below; the same prefs on every device of a user):
- buyback: a short option has given up most of its premium (hedge `closes`)
- sell_call / sell_put / buy_stock: the desk's suggestion turns into that trade
- iv_spike: ATM IV spikes on a holding (off by default)
- expiring_itm: a short option is in the money with ≤ 1 day left, so assignment is likely (off by default)
Each alert is sent once per day per contract (key below); the set of sent keys lives in memory, so a server
restart can repeat that day's alerts at most once.

Config (server env; the module is a no-op without the keys):
- PUSH_VAPID_PRIVATE_KEY, PUSH_VAPID_PUBLIC_KEY: base64url P-256 key pair
  (`python -m optionflow.modules.notify.webpush` prints a fresh pair)
- PUSH_CONTACT: "mailto:you@example.com", sent to the push services with each message (RFC 8292)
"""
from __future__ import annotations

import json
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
KINDS = ("buyback", "sell_call", "sell_put", "buy_stock", "iv_spike", "expiring_itm")
DEFAULT_PREFS: Dict[str, Any] = {"buyback": True, "sell_call": True, "sell_put": True, "buy_stock": True,
                                 "iv_spike": False, "expiring_itm": False, "symbols": []}   # [] = every holding


def clean_prefs(p: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    out = dict(DEFAULT_PREFS)
    for k in KINDS:
        if isinstance((p or {}).get(k), bool):
            out[k] = p[k]
    syms = (p or {}).get("symbols") or []
    out["symbols"] = sorted({str(x).strip().upper() for x in syms if str(x).strip()})[:100]
    return out


def _load(raw: Optional[str]) -> Dict[str, Any]:
    try:
        return clean_prefs(json.loads(raw) if raw else None)
    except (ValueError, TypeError):
        return dict(DEFAULT_PREFS)


def allows(prefs: Dict[str, Any], alert: Dict[str, Any]) -> bool:
    if alert.get("kind") == "summary":
        return True
    return bool(prefs.get(alert["kind"])) and (not prefs.get("symbols") or alert["symbol"] in prefs["symbols"])


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
            prev = s.query(Sub).filter(Sub.user_id == user_id).order_by(Sub.id.desc()).first()
            row = Sub(endpoint=endpoint, created_at=now_iso(), prefs=prev.prefs if prev else None)   # same prefs on every device
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
        return [{**{c: getattr(r, c) for c in ("id", "user_id", "endpoint", "p256dh", "auth", "user_agent", "created_at", "last_ok_at")},
                 "prefs": _load(r.prefs)} for r in q.order_by(Sub.id).all()]
    finally:
        s.close()


def get_prefs(user_id: int) -> Dict[str, Any]:
    subs = subscriptions(user_id)
    return subs[-1]["prefs"] if subs else dict(DEFAULT_PREFS)


def set_prefs(user_id: int, prefs: Dict[str, Any]) -> Dict[str, Any]:
    """Save on every device of the user. Returns the cleaned prefs."""
    from database.models import PushSubscription as Sub
    p = clean_prefs(prefs)
    s = get_session()
    try:
        s.query(Sub).filter(Sub.user_id == user_id).update({"prefs": json.dumps(p)})
        s.commit()
    finally:
        s.close()
    return p


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
def push_user(user_id: int, payload: Dict[str, Any], sender=None, alert: Optional[Dict[str, Any]] = None) -> Dict[str, int]:
    """Send one notification to every device of a user (only those whose prefs allow `alert`, when given).
    Returns {"sent", "failed", "removed"}."""
    sender = sender or webpush.send
    priv, _pub, contact = config()
    out = {"sent": 0, "failed": 0, "removed": 0}
    if priv is None:
        return out
    for sub in subscriptions(user_id):
        if alert is not None and not allows(sub["prefs"], alert):
            continue
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
    """[{key, kind, symbol, title, body, url}] for everything worth a push right now (before prefs)."""
    out: List[Dict[str, Any]] = []
    for b in books.get("books", []):
        if b.get("error"):
            continue
        sym = b["symbol"]
        for c in b.get("closes") or []:
            k = f"{c['strike']:g}{'C' if c['otype'] == 'call' else 'P'}"
            out.append({
                "key": f"bb:{sym}:{k}:{c['expiry']}", "kind": "buyback", "symbol": sym,
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
                "key": f"sg:{sym}:{act}:{k}:{s.get('expiry')}", "kind": act.lower(), "symbol": sym,
                "title": f"{'Sell call' if act == 'SELL_CALL' else 'Sell put'}: {sym} {k} {(s.get('expiry') or '')[5:]}",
                "body": f"{s.get('contracts', 1)}× for ~${abs(s.get('credit') or 0):,.0f}. {(s.get('reasons') or [''])[0]}",
                "url": "/hedge",
            })
        elif act == "BUY_STOCK":
            out.append({
                "key": f"sg:{sym}:BUY_STOCK:{s.get('shares')}", "kind": "buy_stock", "symbol": sym,
                "title": f"Buy stock: {sym} +{s.get('shares')} sh",
                "body": s.get("headline", ""),
                "url": "/hedge",
            })
        iv = b.get("iv") or {}
        if iv.get("spike"):
            roc = iv.get("iv_roc_day")
            out.append({
                "key": f"iv:{sym}", "kind": "iv_spike", "symbol": sym,
                "title": f"IV spike: {sym}",
                "body": f"ATM IV {roc * 100:+.0f}% today with the stock up. Premium is rich." if roc is not None else "ATM IV is spiking.",
                "url": "/hedge",
            })
        spot = b.get("spot")
        for l in b.get("legs") or []:
            if l.get("kind") != "option" or (l.get("quantity") or 0) >= 0 or spot is None or l.get("dte") is None or l["dte"] > 1.25:
                continue
            itm = spot > l["strike"] if l.get("otype") == "call" else spot < l["strike"]
            if not itm:
                continue
            k = f"{l['strike']:g}{'C' if l.get('otype') == 'call' else 'P'}"
            out.append({
                "key": f"ex:{sym}:{k}:{l.get('expiry')}", "kind": "expiring_itm", "symbol": sym,
                "title": f"Expiring in the money: {sym} {k}",
                "body": f"Short {abs(l['quantity']):g} {k} expires {l.get('expiry')}; spot ${spot:,.2f}. Likely assigned.",
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
    """Compute alerts for one user, push the new ones each device asked for. Returns notifications delivered."""
    if books_fn is None:
        from optionflow.modules.hedge import service as hedge
        books_fn = hedge.books_for
    subs = subscriptions(user_id)
    if not subs:
        return 0
    wanted = [a for a in alerts_for(books_fn(user_id)) if any(allows(sub["prefs"], a) for sub in subs)]
    fresh = set(SENT.new(user_id, [a["key"] for a in wanted]))
    todo = [a for a in wanted if a["key"] in fresh]
    if not todo:
        return 0
    if len(todo) > MAX_PER_CYCLE:
        todo = [{"key": "summary", "kind": "summary", "symbol": "", "title": f"{len(todo)} actions on your book",
                 "body": ", ".join(a["title"] for a in todo[:4]) + "…", "url": "/dashboard"}]
    n = 0
    for a in todo:
        r = push_user(user_id, {"title": a["title"], "body": a["body"], "url": a["url"], "tag": a["key"]},
                      sender=sender, alert=a)
        n += r["sent"]
    return n


def market_open(now: Optional[datetime] = None) -> bool:
    t = (now or datetime.now(ET)).astimezone(ET)
    return t.weekday() < 5 and (9, 30) <= (t.hour, t.minute) < (16, 5)
