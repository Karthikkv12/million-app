"""optionflow/modules/notify/service.py — phone notifications (Web Push) for the hedge desk.

What gets pushed (owner, 2026-11-09), from the same live books the Hedge page shows. Each kind can be switched
off, and alerts can be limited to some symbols (prefs, below; the same prefs on every device of a user):
- buyback: a short option has given up most of its premium (hedge `closes`)
- sell_call / sell_put / buy_stock: the desk's suggestion turns into that trade (buy_stock also covers BUY_CALL,
  the long call of the LEAPS / diagonal strategies)
- iv_spike: ATM IV spikes on a holding (off by default)
- expiring_itm: a short option is in the money with ≤ 1 day left, so assignment is likely (off by default)
- signals: a holding's backtested signal (hedge.signal) turns actionable: Add, Exit, Take profit or Roll. Once per
  symbol and verdict per 7 days (the Notification Center's window), so a fear dip that lasts a week alerts once
- scanner: the Signal scanner (hedge.scan_live, every second in market hours) turns a name into a Buy (1–3 month),
  a Swing buy or a Strong swing buy, held for 3 straight seconds. Once per symbol and kind per day; any name in the
  scanner's universe, not only holdings
- levels: a dealer level of a holding or of an extra `level_symbols` ticker moved (call wall, put wall, king, flip),
  or spot crossed the flip (LevelWatch, below)
Each alert is sent once per day per contract (key below); the set of sent keys lives in memory, so a server
restart can repeat that day's alerts at most once.

Notification Center (owner, 2026-11-14): every alert is also stored (`notifications` table, record() below) so the
app's bell lists them, grouped, read or not. Sources: these hedge / level alerts (what at least one device allows),
pulse price alerts and paper trades, and daily reports. Stored once per (user, ET day, key); kept INBOX_DAYS (7).

Config (server .env or process env; the module is a no-op without the keys):
- PUSH_VAPID_PRIVATE_KEY, PUSH_VAPID_PUBLIC_KEY: base64url P-256 key pair
  (`python -m optionflow.modules.notify.webpush` prints a fresh pair)
- PUSH_CONTACT: "mailto:you@example.com" or "https://your.site", sent to the push services with each
  message (RFC 8292)
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple
from zoneinfo import ZoneInfo

from optionflow.core.db import get_session
from optionflow.modules.notify import webpush

logger = logging.getLogger("optionflow.notify")
ET = ZoneInfo("America/New_York")
MAX_PER_CYCLE = 6                     # more than this in one minute → one summary instead
KINDS = ("buyback", "sell_call", "sell_put", "buy_stock", "iv_spike", "expiring_itm", "levels", "signals", "scanner")
DEFAULT_PREFS: Dict[str, Any] = {"buyback": True, "sell_call": True, "sell_put": True, "buy_stock": True,
                                 "iv_spike": False, "expiring_itm": False, "levels": True, "signals": True,
                                 "scanner": True,        # the Signal scanner, live every second in market hours
                                 "symbols": [],          # [] = every holding
                                 "level_symbols": []}    # watched for level alerts on top of the holdings
MAX_LEVEL_SYMBOLS = 20


def _syms(xs, n: int) -> List[str]:
    return sorted({str(x).strip().upper() for x in (xs or []) if str(x).strip()})[:n]


def clean_prefs(p: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    out = dict(DEFAULT_PREFS)
    for k in KINDS:
        if isinstance((p or {}).get(k), bool):
            out[k] = p[k]
    out["symbols"] = _syms((p or {}).get("symbols"), 100)
    out["level_symbols"] = _syms((p or {}).get("level_symbols"), MAX_LEVEL_SYMBOLS)
    return out


def _load(raw: Optional[str]) -> Dict[str, Any]:
    try:
        return clean_prefs(json.loads(raw) if raw else None)
    except (ValueError, TypeError):
        return dict(DEFAULT_PREFS)


def allows(prefs: Dict[str, Any], alert: Dict[str, Any]) -> bool:
    if alert.get("kind") == "summary":
        return True
    if not prefs.get(alert["kind"]):
        return False
    if alert["kind"] == "levels" and alert["symbol"] in (prefs.get("level_symbols") or []):
        return True                                   # asked for by name: not limited by `symbols`
    if alert["kind"] == "scanner":
        return True                                   # the scanner is about names you don't hold: not limited by `symbols`
    return not prefs.get("symbols") or alert["symbol"] in prefs["symbols"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


# ── Config ────────────────────────────────────────────────────────────────────
def config() -> Tuple[Optional[Any], Optional[str], str]:
    """(private key, public key b64, contact); (None, None, …) when push isn't configured."""
    # Process env first (tests, launchd), then Settings, which is what reads the server's .env:
    # pydantic's env_file does not put .env values into os.environ.
    from optionflow.core.settings import get_settings
    st = get_settings()
    priv_b64 = (os.environ.get("PUSH_VAPID_PRIVATE_KEY") or st.push_vapid_private_key or "").strip()
    contact = (os.environ.get("PUSH_CONTACT") or st.push_contact or "").strip() or "mailto:admin@optflw.com"
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


# ── Notification Center ───────────────────────────────────────────────────────
INBOX_DAYS = 7                                    # owner: the center holds the last 7 days
INBOX_PAGE = 200


def record(user_id: int, items: List[Dict[str, Any]], day: Optional[str] = None) -> int:
    """Store alerts in the user's Notification Center: items are {key, kind, symbol?, title, body?, url?}. An alert
    already stored for that key today (US Eastern) is skipped. Never raises; returns how many were added."""
    if not items:
        return 0
    from database.models import Notification as N
    day = day or datetime.now(ET).date().isoformat()
    rows = {}
    for i in items:
        k = f"{day}|{i['key']}"[:300]
        rows.setdefault(k, i)
    s = get_session()
    try:
        have = {k for (k,) in s.query(N.key).filter(N.user_id == user_id, N.key.in_(list(rows)))}
        now, n = now_iso(), 0
        for k, i in rows.items():
            if k in have:
                continue
            s.add(N(user_id=user_id, kind=str(i.get("kind") or "other")[:40], symbol=(i.get("symbol") or None),
                    title=str(i.get("title") or "")[:300], body=i.get("body"), url=i.get("url"), key=k, created_at=now))
            n += 1
        if n:
            s.query(N).filter(N.user_id == user_id, N.created_at < _cutoff()).delete(synchronize_session=False)
        s.commit()
        return n
    except Exception:
        logger.exception("notification center: record for user %s failed", user_id)
        s.rollback()
        return 0
    finally:
        s.close()


def _cutoff() -> str:
    return datetime.fromtimestamp(time.time() - INBOX_DAYS * 86400, timezone.utc).isoformat()


def _row(n: Any) -> Dict[str, Any]:
    return {"id": n.id, "kind": n.kind, "symbol": n.symbol, "title": n.title, "body": n.body, "url": n.url,
            "created_at": n.created_at, "read": n.read_at is not None}


def inbox(user_id: int, limit: int = INBOX_PAGE) -> Dict[str, Any]:
    """The newest `limit` notifications of the last INBOX_DAYS and the unread count (older ones are deleted)."""
    from database.models import Notification as N
    s = get_session()
    try:
        s.query(N).filter(N.user_id == user_id, N.created_at < _cutoff()).delete(synchronize_session=False)
        s.commit()
        q = s.query(N).filter(N.user_id == user_id)
        items = [_row(n) for n in q.order_by(N.created_at.desc(), N.id.desc()).limit(max(1, min(limit, 500)))]
        unread = q.filter(N.read_at.is_(None)).count()
        return {"items": items, "unread": unread}
    finally:
        s.close()


def mark_read(user_id: int, ids: Optional[List[int]] = None) -> int:
    """Mark `ids` (or everything, when None) read. Returns the unread count left."""
    from database.models import Notification as N
    s = get_session()
    try:
        q = s.query(N).filter(N.user_id == user_id, N.read_at.is_(None))
        if ids is not None:
            q = q.filter(N.id.in_([int(i) for i in ids][:500]))
        q.update({"read_at": now_iso()}, synchronize_session=False)
        s.commit()
        return s.query(N).filter(N.user_id == user_id, N.read_at.is_(None)).count()
    finally:
        s.close()


def clear(user_id: int) -> None:
    """Delete every notification of the user."""
    from database.models import Notification as N
    s = get_session()
    try:
        s.query(N).filter(N.user_id == user_id).delete(synchronize_session=False)
        s.commit()
    finally:
        s.close()


def recent_keys(user_id: int, keys: List[str], days: int = 0) -> Set[str]:
    """Which of `keys` (unprefixed alert keys) the Notification Center already holds from the last `days` days
    (0 = everything it holds, i.e. INBOX_DAYS)."""
    if not keys:
        return set()
    from database.models import Notification as N
    since = datetime.fromtimestamp(time.time() - (days or INBOX_DAYS) * 86400, timezone.utc).isoformat()
    s = get_session()
    try:
        rows = s.query(N.key).filter(N.user_id == user_id, N.created_at >= since,
                                     N.key.in_([f"{d}|{k}" for k in keys for d in _days(days or INBOX_DAYS)])).all()
        return {k.split("|", 1)[1] for (k,) in rows}
    except Exception:
        logger.exception("notification center: recent keys for user %s failed", user_id)
        return set()
    finally:
        s.close()


def _days(n: int) -> List[str]:
    today = datetime.now(ET).date()
    from datetime import timedelta
    return [(today - timedelta(days=i)).isoformat() for i in range(n + 1)]


# ── Alerts from the hedge books ───────────────────────────────────────────────
SIGNAL_ALERTS = {"ADD": "Add", "EXIT": "Exit", "TRIM": "Take profit", "ROLL": "Roll"}


def signal_alerts(books: Dict[str, Any]) -> List[Dict[str, Any]]:
    """A holding whose signal is actionable now (Add / Exit / Take profit / Roll)."""
    out: List[Dict[str, Any]] = []
    for b in books.get("books", []):
        g = b.get("signal") or {}
        word = SIGNAL_ALERTS.get(g.get("verdict"))
        if b.get("error") or not word:
            continue
        sym = b["symbol"]
        head = str(g.get("headline") or "")
        out.append({"key": f"sig:{sym}:{g['verdict']}", "kind": "signals", "symbol": sym,
                    "title": f"{sym} signal: {word}",
                    "body": (head[:220] + "…") if len(head) > 220 else head,
                    "url": f"/stocks/{sym}"})
    return out

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
            what = "Sell call" if act == "SELL_CALL" else "Sell put"
            if s.get("long_strike"):                      # put credit spread (strategy module)
                k, what = f"{s['strike']:g}/{s['long_strike']:g}P", "Sell put spread"
            out.append({
                "key": f"sg:{sym}:{act}:{k}:{s.get('expiry')}", "kind": act.lower(), "symbol": sym,
                "title": f"{what}: {sym} {k} {(s.get('expiry') or '')[5:]}",
                "body": f"{s.get('contracts', 1)}× for ~${abs(s.get('credit') or 0):,.0f}. {(s.get('reasons') or [''])[0]}",
                "url": "/hedge",
            })
        elif act == "BUY_CALL":                           # LEAPS / diagonal long leg: under the "buy" switch
            k = f"{s['strike']:g}C"
            out.append({
                "key": f"sg:{sym}:BUY_CALL:{k}:{s.get('expiry')}", "kind": "buy_stock", "symbol": sym,
                "title": f"Buy call: {sym} {k} {s.get('expiry') or ''}",
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


# ── Level-shift alerts (#57) ──────────────────────────────────────────────────
LEVELS = (("max_call_wall", "call wall", "it tends to cap rallies"),
          ("max_put_wall", "put wall", "it tends to hold dips"),
          ("max_gex_strike", "king strike", "price tends to pin there"))
FLIP_MOVE_PCT = 0.005      # the flip has to move this share of spot to count as a move
CROSS_BAND_PCT = 0.001     # spot must clear the flip by this share of spot to count as on that side
CROSS_COOLDOWN = 30 * 60   # seconds: at most one crossing alert per symbol in this window


def _px(v: float) -> str:
    return f"{v:,.2f}".rstrip("0").rstrip(".") if v % 1 else f"{v:,.0f}"


class LevelWatch:
    """Dealer levels per symbol, compared between refreshes. A change has to show on two refreshes in a row (two
    different `as_of`) before it is reported, so a wall that flickers between two strikes for one refresh stays
    quiet. The first refresh of a symbol only sets the baseline. Market data, so one instance serves every user."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._base: Dict[str, Dict[str, Any]] = {}      # symbol → reported levels + side of the flip
        self._pending: Dict[str, Dict[str, Any]] = {}   # symbol → {field: candidate value} seen once
        self._as_of: Dict[str, str] = {}
        self._cross_at: Dict[str, float] = {}

    def check(self, r: Any, now: Optional[float] = None) -> List[Dict[str, Any]]:
        """Alerts for this refresh of one symbol (a GEXResult); [] for an error, a stale result or a repeat."""
        if r is None or getattr(r, "error", None) or getattr(r, "stale", False) or not r.spot:
            return []
        sym, spot = r.symbol.upper(), float(r.spot)
        now = time.time() if now is None else now
        flip = r.zero_gamma
        side = None
        if flip is not None:
            band = spot * CROSS_BAND_PCT
            side = "above" if spot > flip + band else "below" if spot < flip - band else None
        cur = {f: getattr(r, f) for f, _, _ in LEVELS}
        cur["zero_gamma"] = flip
        with self._lock:
            if r.as_of and self._as_of.get(sym) == r.as_of:
                return []
            self._as_of[sym] = r.as_of or ""
            base = self._base.get(sym)
            if base is None:
                self._base[sym] = {**cur, "side": side}
                return []
            pend = self._pending.setdefault(sym, {})
            out: List[Dict[str, Any]] = []
            day = datetime.now(ET).date().isoformat()

            def confirmed(field: str, val: Any) -> bool:
                if pend.get(field, object()) == val:
                    pend.pop(field, None)
                    return True
                pend[field] = val
                return False

            for f, name, why in LEVELS:
                old, new = base.get(f), cur[f]
                if new is None or old == new:
                    pend.pop(f, None)
                    continue
                if old is None:                         # level appeared: adopt it quietly
                    base[f] = new
                    continue
                if confirmed(f, new):
                    base[f] = new
                    up = "up" if new > old else "down"
                    out.append({"key": f"lv:{sym}:{f}:{new:g}:{day}", "kind": "levels", "symbol": sym,
                                "title": f"{sym} {name} moved {up}: {_px(old)} → {_px(new)}",
                                "body": f"Spot ${spot:,.2f}. The {name} is where dealer gamma is heaviest on that "
                                        f"side; {why}.", "url": f"/stocks/{sym}"})
            old_flip = base.get("zero_gamma")
            if flip is None:
                pend.pop("zero_gamma", None)
            elif old_flip is None:
                base["zero_gamma"] = flip
            elif abs(flip - old_flip) >= spot * FLIP_MOVE_PCT:
                if confirmed("zero_gamma", round(flip / (spot * FLIP_MOVE_PCT))):   # same neighbourhood twice
                    base["zero_gamma"] = flip
                    up = "up" if flip > old_flip else "down"
                    regime = ("above it: dealers long gamma, moves fade" if spot >= flip
                              else "below it: dealers short gamma, moves run")
                    out.append({"key": f"lv:{sym}:flip:{round(flip, 1):g}:{day}", "kind": "levels", "symbol": sym,
                                "title": f"{sym} flip moved {up}: {_px(round(old_flip, 2))} → {_px(round(flip, 2))}",
                                "body": f"Spot ${spot:,.2f} is {regime}.", "url": f"/stocks/{sym}"})
            else:
                pend.pop("zero_gamma", None)
            old_side = base.get("side")
            if side is None or side == old_side:
                pend.pop("side", None)
            elif old_side is None:
                base["side"] = side
            elif confirmed("side", side):
                base["side"] = side
                if now - self._cross_at.get(sym, -1e18) >= CROSS_COOLDOWN:
                    self._cross_at[sym] = now
                    what = ("Dealers are now long gamma: they sell rallies and buy dips, so moves tend to fade."
                            if side == "above" else
                            "Dealers are now short gamma: they sell drops and buy rallies, so moves tend to run.")
                    out.append({"key": f"lv:{sym}:cross:{side}:{int(now // CROSS_COOLDOWN)}", "kind": "levels",
                                "symbol": sym, "title": f"{sym} crossed {side} the flip ({_px(round(flip, 2))})",
                                "body": f"Spot ${spot:,.2f}. {what}", "url": f"/stocks/{sym}"})
            return out

    def clear(self) -> None:
        with self._lock:
            self._base.clear()
            self._pending.clear()
            self._as_of.clear()
            self._cross_at.clear()


LEVEL_WATCH = LevelWatch()


def level_symbols(books: Dict[str, Any], prefs_list: List[Dict[str, Any]]) -> List[str]:
    """Symbols a user's level alerts cover: the holdings in `books` plus every device's `level_symbols`, capped."""
    if not any(p.get("levels") for p in prefs_list):
        return []
    held = [b["symbol"] for b in books.get("books", []) if b.get("symbol") and not b.get("error")]
    extra = [x for p in prefs_list for x in p.get("level_symbols") or []]
    return _syms(extra + held, MAX_LEVEL_SYMBOLS)


def level_alerts(symbols: List[str], gex_fn=None, watch: Optional[LevelWatch] = None) -> Dict[str, List[Dict[str, Any]]]:
    """{symbol: alerts} for this cycle: each symbol's levels (cached GEX, refetched when older than the cache TTL)
    checked once against the last cycle. Symbols whose data fails are skipped."""
    if gex_fn is None:
        from optionflow.modules.flow import service as flow
        gex_fn = flow.get_gex
    watch = watch or LEVEL_WATCH
    out: Dict[str, List[Dict[str, Any]]] = {}
    for sym in symbols:
        try:
            out[sym] = watch.check(gex_fn(sym))
        except Exception as e:
            logger.info("level check for %s failed: %s", sym, e)
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


def run_for_user(user_id: int, books_fn=None, sender=None,
                 levels: Optional[Dict[str, List[Dict[str, Any]]]] = None) -> int:
    """Compute alerts for one user, push the new ones each device asked for. Returns notifications delivered.
    `levels` is this cycle's level_alerts() by symbol; only the user's level_symbols() are taken from it."""
    if books_fn is None:
        from optionflow.modules.hedge import service as hedge
        books_fn = hedge.books_for
    subs = subscriptions(user_id)
    if not subs:
        return 0
    books = books_fn(user_id)
    found = alerts_for(books)
    sig = signal_alerts(books)                    # once per symbol + verdict per 7 days, not every day
    seen = recent_keys(user_id, [a["key"] for a in sig])
    found.extend(a for a in sig if a["key"] not in seen)
    if levels:
        for sym in level_symbols(books, [sub["prefs"] for sub in subs]):
            found.extend(levels.get(sym) or [])
    wanted = [a for a in found if any(allows(sub["prefs"], a) for sub in subs)]
    record(user_id, wanted)                       # the Notification Center keeps each one, even when pushes are summarised
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
