"""optionflow/modules/pulse/service.py — price alerts and paper trades (DB) and the price check that moves them.

Price alerts: fire once, on the first check where the price is at or beyond the level (`above`: price ≥ level,
`below`: price ≤ level), then stay as history with `triggered_at` / `triggered_price` until deleted.

Paper trades (never routed to a broker): planned → open when the price reaches `entry` from the side it was on when
the plan was made (`created_price`); open → stopped / target when it reaches `stop` / `target` (long: stop below,
target above; short: the reverse). `closed` is set by the user. Each move records the price and time and sends a push.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Iterable, List, Optional

from database.models import PaperTrade, PriceAlert
from optionflow.core.db import get_session

logger = logging.getLogger("optionflow.pulse")

DIRECTIONS = ("above", "below")
SIDES = ("long", "short")
STATUSES = ("planned", "open", "stopped", "target", "closed")
ACTIVE = ("planned", "open")
MAX_ALERTS = 200                     # per user, untriggered
MAX_TRADES = 200                     # per user, planned or open


class PulseError(ValueError):
    pass


class NotFound(LookupError):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _sym(symbol: str) -> str:
    s = (symbol or "").strip().upper()
    if not s or len(s) > 16:
        raise PulseError("symbol is required (≤ 16 characters)")
    return s


def _pos(x: Optional[float], name: str, required: bool = False) -> Optional[float]:
    if x is None:
        if required:
            raise PulseError(f"{name} is required")
        return None
    if not x > 0:
        raise PulseError(f"{name} must be positive")
    return float(x)


def _cols(obj: Any, names: Iterable[str]) -> Dict[str, Any]:
    return {n: getattr(obj, n) for n in names}


# ── Price alerts ──────────────────────────────────────────────────────────────
_ALERT_COLS = ("id", "symbol", "price", "direction", "note", "created_at", "triggered_at", "triggered_price")


def list_alerts(user_id: int, symbol: Optional[str] = None) -> List[Dict[str, Any]]:
    s = get_session()
    try:
        q = s.query(PriceAlert).filter(PriceAlert.user_id == user_id)
        if symbol:
            q = q.filter(PriceAlert.symbol == _sym(symbol))
        return [_cols(a, _ALERT_COLS) for a in q.order_by(PriceAlert.id).all()]
    finally:
        s.close()


def create_alert(user_id: int, symbol: str, price: float, direction: str, note: Optional[str] = None) -> Dict[str, Any]:
    if direction not in DIRECTIONS:
        raise PulseError("direction must be 'above' or 'below'")
    a = PriceAlert(user_id=user_id, symbol=_sym(symbol), price=_pos(price, "price", True), direction=direction,
                   note=(note or None) and note[:200], created_at=now_iso())
    s = get_session()
    try:
        n = s.query(PriceAlert).filter(PriceAlert.user_id == user_id, PriceAlert.triggered_at.is_(None)).count()
        if n >= MAX_ALERTS:
            raise PulseError(f"at most {MAX_ALERTS} active alerts")
        s.add(a)
        s.commit()
        return _cols(a, _ALERT_COLS)
    finally:
        s.close()


def update_alert(user_id: int, alert_id: int, changes: Dict[str, Any]) -> Dict[str, Any]:
    """Change price / direction / note. Changing the level or direction re-arms a triggered alert."""
    s = get_session()
    try:
        a = s.query(PriceAlert).filter(PriceAlert.id == alert_id, PriceAlert.user_id == user_id).one_or_none()
        if a is None:
            raise NotFound("alert not found")
        if "direction" in changes and changes["direction"] is not None:
            if changes["direction"] not in DIRECTIONS:
                raise PulseError("direction must be 'above' or 'below'")
            if changes["direction"] != a.direction:
                a.direction, a.triggered_at, a.triggered_price = changes["direction"], None, None
        if changes.get("price") is not None:
            p = _pos(changes["price"], "price")
            if p != a.price:
                a.price, a.triggered_at, a.triggered_price = p, None, None
        if "note" in changes:
            a.note = (changes["note"] or None) and changes["note"][:200]
        s.commit()
        return _cols(a, _ALERT_COLS)
    finally:
        s.close()


def delete_alert(user_id: int, alert_id: int) -> None:
    s = get_session()
    try:
        n = s.query(PriceAlert).filter(PriceAlert.id == alert_id, PriceAlert.user_id == user_id).delete()
        s.commit()
        if not n:
            raise NotFound("alert not found")
    finally:
        s.close()


# ── Paper trades ──────────────────────────────────────────────────────────────
_TRADE_COLS = ("id", "symbol", "side", "qty", "entry", "stop", "target", "status", "note", "created_at",
               "opened_at", "closed_at", "exit_price", "created_price")


def _check_levels(side: str, entry: float, stop: Optional[float], target: Optional[float]) -> None:
    sign = 1 if side == "long" else -1
    if stop is not None and not sign * (entry - stop) > 0:
        raise PulseError(f"a {side} stop must be {'below' if side == 'long' else 'above'} the entry")
    if target is not None and not sign * (target - entry) > 0:
        raise PulseError(f"a {side} target must be {'above' if side == 'long' else 'below'} the entry")


def list_trades(user_id: int, symbol: Optional[str] = None, status: Optional[str] = None) -> List[Dict[str, Any]]:
    s = get_session()
    try:
        q = s.query(PaperTrade).filter(PaperTrade.user_id == user_id)
        if symbol:
            q = q.filter(PaperTrade.symbol == _sym(symbol))
        if status:
            q = q.filter(PaperTrade.status == status)
        return [_cols(t, _TRADE_COLS) for t in q.order_by(PaperTrade.id).all()]
    finally:
        s.close()


def create_trade(user_id: int, symbol: str, side: str, qty: float, entry: float, stop: Optional[float] = None,
                 target: Optional[float] = None, note: Optional[str] = None, status: str = "planned",
                 price_fn: Optional[Callable[[str], Optional[float]]] = None) -> Dict[str, Any]:
    """`status` "open" starts the trade at once (filled at `entry`); "planned" waits for the price to reach it."""
    if side not in SIDES:
        raise PulseError("side must be 'long' or 'short'")
    if status not in ACTIVE:
        raise PulseError("a new trade is 'planned' or 'open'")
    sym = _sym(symbol)
    entry_ = _pos(entry, "entry", True)
    stop_, target_ = _pos(stop, "stop"), _pos(target, "target")
    _check_levels(side, entry_, stop_, target_)
    now = now_iso()
    t = PaperTrade(user_id=user_id, symbol=sym, side=side, qty=_pos(qty, "qty", True), entry=entry_, stop=stop_,
                   target=target_, status=status, note=(note or None) and note[:200], created_at=now,
                   opened_at=now if status == "open" else None,
                   created_price=(price_fn or last_price)(sym) if status == "planned" else None)
    s = get_session()
    try:
        n = s.query(PaperTrade).filter(PaperTrade.user_id == user_id, PaperTrade.status.in_(ACTIVE)).count()
        if n >= MAX_TRADES:
            raise PulseError(f"at most {MAX_TRADES} planned or open trades")
        s.add(t)
        s.commit()
        return _cols(t, _TRADE_COLS)
    finally:
        s.close()


def update_trade(user_id: int, trade_id: int, changes: Dict[str, Any],
                 price_fn: Optional[Callable[[str], Optional[float]]] = None) -> Dict[str, Any]:
    """Edit levels / qty / note while planned or open; `status: "closed"` closes it at `exit_price` (or the
    current price). A finished trade (stopped / target / closed) only takes a note."""
    s = get_session()
    try:
        t = s.query(PaperTrade).filter(PaperTrade.id == trade_id, PaperTrade.user_id == user_id).one_or_none()
        if t is None:
            raise NotFound("trade not found")
        if "note" in changes:
            t.note = (changes["note"] or None) and changes["note"][:200]
        edits = {k: changes.get(k) for k in ("qty", "entry", "stop", "target") if k in changes}
        status = changes.get("status")
        if (edits or status) and t.status not in ACTIVE:
            raise PulseError(f"the trade is {t.status}; only the note can change")
        if edits:
            if "entry" in edits and t.status == "open" and edits["entry"] != t.entry:
                raise PulseError("an open trade's entry can't change")
            qty = _pos(edits.get("qty", t.qty), "qty", True)
            entry = _pos(edits.get("entry", t.entry), "entry", True)
            stop = _pos(edits["stop"], "stop") if "stop" in edits else t.stop
            target = _pos(edits["target"], "target") if "target" in edits else t.target
            _check_levels(t.side, entry, stop, target)
            t.qty, t.entry, t.stop, t.target = qty, entry, stop, target
        if status is not None and status != t.status:
            if status != "closed":
                raise PulseError("status can only be set to 'closed'")
            px = changes.get("exit_price")
            t.exit_price = _pos(px, "exit_price") if px is not None else (
                (price_fn or last_price)(t.symbol) if t.status == "open" else None)
            t.status, t.closed_at = "closed", now_iso()
        s.commit()
        return _cols(t, _TRADE_COLS)
    finally:
        s.close()


def delete_trade(user_id: int, trade_id: int) -> None:
    s = get_session()
    try:
        n = s.query(PaperTrade).filter(PaperTrade.id == trade_id, PaperTrade.user_id == user_id).delete()
        s.commit()
        if not n:
            raise NotFound("trade not found")
    finally:
        s.close()


# ── The price check (pulse.worker) ────────────────────────────────────────────
def last_price(symbol: str) -> Optional[float]:
    """Real-time price when the provider has it (Public.com batch quotes), else the provider's last price."""
    return prices([symbol]).get(symbol)


def prices(symbols: List[str]) -> Dict[str, float]:
    from optionflow.providers.market_data import get_market_data
    md = get_market_data()
    out: Dict[str, float] = {}
    fn = getattr(md, "quotes_batch", None)
    if callable(fn):
        try:
            for sym, q in (fn(symbols) or {}).items():
                if q and q.get("price"):
                    out[sym] = float(q["price"])
        except Exception as e:
            logger.debug("pulse quotes failed: %s", e)
    for sym in symbols:
        if sym not in out:
            try:
                p = md.last_price(sym)
            except Exception:
                p = None
            if p:
                out[sym] = float(p)
    return out


def _reached(price: float, level: float, up: bool) -> bool:
    return price >= level if up else price <= level


def _money(x: float) -> str:
    return f"${x:,.2f}"


def check(price_fn: Optional[Callable[[List[str]], Dict[str, float]]] = None,
          push: Optional[Callable[[int, Dict[str, Any]], Any]] = None) -> List[Dict[str, Any]]:
    """One pass over every untriggered alert and planned / open trade. Returns the events (also pushed):
    [{user_id, kind, id, symbol, title, body, url}]."""
    s = get_session()
    events: List[Dict[str, Any]] = []
    try:
        alerts = s.query(PriceAlert).filter(PriceAlert.triggered_at.is_(None)).all()
        trades = s.query(PaperTrade).filter(PaperTrade.status.in_(ACTIVE)).all()
        syms = sorted({a.symbol for a in alerts} | {t.symbol for t in trades})
        if not syms:
            return []
        px = (price_fn or prices)(syms)
        now = now_iso()
        for a in alerts:
            p = px.get(a.symbol)
            if p is None or not _reached(p, a.price, a.direction == "above"):
                continue
            a.triggered_at, a.triggered_price = now, p
            events.append({"user_id": a.user_id, "kind": "price_alert", "id": a.id, "symbol": a.symbol,
                           "title": f"{a.symbol} {'above' if a.direction == 'above' else 'below'} {_money(a.price)}",
                           "body": f"Now {_money(p)}" + (f" · {a.note}" if a.note else ""),
                           "url": f"/stocks/{a.symbol}"})
        for t in trades:
            p = px.get(t.symbol)
            if p is None:
                continue
            long = t.side == "long"
            if t.status == "planned":
                if t.created_price is None:          # no price when planned: this check sets the reference
                    t.created_price = p
                    continue
                if not _reached(p, t.entry, t.entry >= t.created_price):
                    continue
                t.status, t.opened_at = "open", now
                events.append(_trade_event(t, "open", p, f"{t.side} {t.qty:g} @ {_money(t.entry)} (paper)"))
            hit = None
            if t.stop is not None and _reached(p, t.stop, not long):
                hit = "stopped"
            elif t.target is not None and _reached(p, t.target, long):
                hit = "target"
            if hit:
                t.status, t.closed_at, t.exit_price = hit, now, p
                pnl = (p - t.entry) * t.qty * (1 if long else -1)
                events.append(_trade_event(t, hit, p, f"P/L {'+' if pnl >= 0 else '−'}{_money(abs(pnl))} (paper)"))
        s.commit()
    finally:
        s.close()
    if events:
        _send(events, push)
    return events


def _trade_event(t: PaperTrade, what: str, price: float, detail: str) -> Dict[str, Any]:
    label = {"open": "entry reached", "stopped": "stop hit", "target": "target hit"}[what]
    return {"user_id": t.user_id, "kind": f"paper_{what}", "id": t.id, "symbol": t.symbol,
            "title": f"{t.symbol} paper {t.side}: {label}", "body": f"{_money(price)} · {detail}",
            "url": f"/stocks/{t.symbol}"}


def _send(events: List[Dict[str, Any]], push: Optional[Callable[[int, Dict[str, Any]], Any]]) -> None:
    try:                                          # the Notification Center keeps every event, pushed or not
        from optionflow.modules.notify.service import record
        for e in events:
            record(e["user_id"], [{"key": f"{e['kind']}-{e['id']}", "kind": e["kind"], "symbol": e.get("symbol"),
                                   "title": e["title"], "body": e["body"], "url": e["url"]}])
    except Exception as exc:
        logger.warning("pulse notification center record failed: %s", exc)
    if push is None:
        try:
            from optionflow.modules.notify.service import push_user
        except Exception:                            # notify disabled: state still moves, no push
            return
        push = push_user
    for e in events:
        try:
            push(e["user_id"], {"title": e["title"], "body": e["body"], "url": e["url"],
                                "tag": f"{e['kind']}-{e['id']}"})
        except Exception as exc:
            logger.warning("pulse push for user %s failed: %s", e["user_id"], exc)
