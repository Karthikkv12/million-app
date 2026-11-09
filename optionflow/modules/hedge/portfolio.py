"""optionflow/modules/hedge/portfolio.py — the Portfolio page, built only from broker-synced data.

Nothing here is entered by hand: positions, account values and history all come from the daily
Robinhood sync (POST /hedge/ingest). Live prices come from the market-data provider.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from optionflow.core.db import get_session
from optionflow.modules.hedge import service

ET = ZoneInfo("America/New_York")


def et_today() -> str:
    return datetime.now(ET).date().isoformat()


# ── Ingest helpers ────────────────────────────────────────────────────────────
def upsert_accounts(user_id: int, source: str, rows: List[Dict[str, Any]], synced: str) -> int:
    from database.models import BrokerAccountSnapshot as Snap
    session = get_session()
    try:
        for r in rows:
            day = r.pop("day", None) or et_today()
            hit = (session.query(Snap).filter(Snap.user_id == user_id, Snap.source == source,
                                              Snap.account == r["account"], Snap.day == day).first())
            if hit is None:
                hit = Snap(user_id=user_id, source=source, account=r["account"], day=day, synced_at=synced)
                session.add(hit)
            for k, v in r.items():
                setattr(hit, k, v)
            hit.synced_at = synced
        session.commit()
        return len(rows)
    finally:
        session.close()


def upsert_activity(user_id: int, source: str, rows: List[Dict[str, Any]]) -> Tuple[int, int]:
    """Insert new rows (by ext_id), update known ones. Returns (new, total stored)."""
    from database.models import BrokerActivity as Act
    session = get_session()
    try:
        ids = [r["ext_id"] for r in rows]
        known = {a.ext_id: a for a in session.query(Act).filter(Act.user_id == user_id, Act.source == source,
                                                                 Act.ext_id.in_(ids)).all()} if ids else {}
        new = 0
        for r in rows:
            r = {**r, "symbol": r["symbol"].strip().upper()}
            hit = known.get(r["ext_id"])
            if hit is None:
                hit = Act(user_id=user_id, source=source, **r)
                session.add(hit)
                known[r["ext_id"]] = hit
                new += 1
            else:
                for k, v in r.items():
                    setattr(hit, k, v)
        session.commit()
        total = session.query(Act).filter(Act.user_id == user_id).count()
        return new, total
    finally:
        session.close()


# ── Reads ─────────────────────────────────────────────────────────────────────
def _snapshots(user_id: int, account: Optional[str]) -> List[Any]:
    from database.models import BrokerAccountSnapshot as Snap
    session = get_session()
    try:
        q = session.query(Snap).filter(Snap.user_id == user_id)
        if account:
            q = q.filter(Snap.account == account)
        return q.order_by(Snap.day).all()
    finally:
        session.close()


def portfolio(user_id: int, account: Optional[str] = None, live: bool = True) -> Dict[str, Any]:
    snaps = _snapshots(user_id, None)
    by_acct: Dict[str, List[Any]] = defaultdict(list)
    for s in snaps:
        by_acct[s.account].append(s)
    accounts = []
    for acct, rows in sorted(by_acct.items()):
        last = rows[-1]
        prev = rows[-2] if len(rows) > 1 else None
        accounts.append({
            "account": acct, "day": last.day, "total_value": last.total_value, "equity_value": last.equity_value,
            "options_value": last.options_value, "crypto_value": last.crypto_value, "cash": last.cash,
            "buying_power": last.buying_power, "prev_total": prev.total_value if prev else None,
            "change": (last.total_value - prev.total_value) if prev and last.total_value is not None and prev.total_value is not None else None,
        })
    shown = [a for a in accounts if not account or a["account"] == account]

    def tot(key: str) -> Optional[float]:
        vals = [a[key] for a in shown if a.get(key) is not None]
        return sum(vals) if vals else None

    positions = [p for p in service.list_positions(user_id) if not account or p.get("account") == account]
    stocks: Dict[str, Dict[str, Any]] = {}
    options = []
    short_calls: Dict[str, float] = defaultdict(float)
    for p in positions:
        sym = p["symbol"]
        if p["kind"] == "stock":
            h = stocks.setdefault(sym, {"symbol": sym, "accounts": set(), "shares": 0.0, "cost": 0.0})
            h["shares"] += p["quantity"]
            h["cost"] += p["quantity"] * (p.get("avg_price") or 0.0)
            if p.get("account"):
                h["accounts"].add(p["account"])
        else:
            if p.get("option_type") == "call" and p["quantity"] < 0:
                short_calls[sym] += -p["quantity"]
            options.append(p)

    prices: Dict[str, Tuple[Optional[float], Dict[str, Any]]] = {}
    if live:
        for sym in {p["symbol"] for p in positions}:
            px = service._spot(sym)
            prices[sym] = (px, service._day_fields(sym, px) if px else {})

    holdings = []
    for sym, h in sorted(stocks.items()):
        px, day = prices.get(sym, (None, {}))
        prev = day.get("prev_close")
        shares = h["shares"]
        avg = h["cost"] / shares if shares else None
        mv = px * shares if px else None
        unreal = (px - avg) * shares if px and avg is not None else None
        holdings.append({
            "symbol": sym, "accounts": sorted(h["accounts"]), "shares": shares, "avg_cost": avg, "price": px,
            "prev_close": prev, "market_value": mv, "cost_basis": h["cost"], "unrealized": unreal,
            "unrealized_pct": (px / avg - 1.0) if px and avg else None,
            "day_change_pct": day.get("day_change"),
            "session": day.get("session"), "regular_close": day.get("regular_close"),
            "ext_change_pct": day.get("ext_change_pct"),
            "short_calls": short_calls.get(sym, 0.0),
            "covered_pct": min(1.0, short_calls.get(sym, 0.0) * 100.0 / shares) if shares > 0 else 0.0,
        })
    stock_value = sum(h["market_value"] for h in holdings if h["market_value"] is not None) or None
    for h in holdings:
        h["weight"] = (h["market_value"] / stock_value) if stock_value and h["market_value"] else None

    today = datetime.now(ET).date()
    opts_out = []
    for p in sorted(options, key=lambda x: (x.get("expiry") or "", x["symbol"])):
        spot = prices.get(p["symbol"], (None, None))[0]
        k = p.get("strike")
        exp = p.get("expiry")
        dte = (date.fromisoformat(exp) - today).days if exp else None
        money = dist = None
        if spot and k:
            dist = spot / k - 1.0
            itm = spot > k if p.get("option_type") == "call" else spot < k
            money = "ATM" if abs(dist) < 0.005 else ("ITM" if itm else "OTM")
        opts_out.append({
            "symbol": p["symbol"], "account": p.get("account"), "option_type": p.get("option_type"), "strike": k,
            "expiry": exp, "dte": dte, "contracts": p["quantity"], "avg_price": p.get("avg_price"),
            "premium": (p.get("avg_price") or 0.0) * (p.get("multiplier") or 100.0) * -p["quantity"],
            "spot": spot, "moneyness": money, "distance_pct": dist, "opened_at": p.get("opened_at"),
        })

    unreal_vals = [h["unrealized"] for h in holdings if h["unrealized"] is not None]
    changes = [a["change"] for a in shown if a.get("change") is not None]
    synced = max((p["synced_at"] for p in service.list_positions(user_id)), default=None)
    return {
        "as_of": service.now_iso(), "synced_at": synced, "account_filter": account, "accounts": accounts,
        "total_value": tot("total_value"), "cash": tot("cash"), "buying_power": tot("buying_power"),
        "day_change": sum(changes) if changes else None, "stock_value": stock_value,
        "unrealized": sum(unreal_vals) if unreal_vals else None, "holdings": holdings, "options": opts_out,
    }


def history(user_id: int, account: Optional[str] = None, days: int = 365) -> List[Dict[str, Any]]:
    cutoff = (datetime.now(ET).date() - timedelta(days=days)).isoformat()
    agg: Dict[str, Dict[str, float]] = defaultdict(lambda: {"total_value": 0.0, "cash": 0.0})
    for s in _snapshots(user_id, account):
        if s.day < cutoff:
            continue
        agg[s.day]["total_value"] += s.total_value or 0.0
        agg[s.day]["cash"] += s.cash or 0.0
    return [{"day": d, **v} for d, v in sorted(agg.items())]


def _activity(user_id: int, account: Optional[str], limit: Optional[int] = None) -> List[Any]:
    from database.models import BrokerActivity as Act
    session = get_session()
    try:
        q = session.query(Act).filter(Act.user_id == user_id)
        if account:
            q = q.filter(Act.account == account)
        q = q.order_by(Act.ts.desc())
        return (q.limit(limit) if limit else q).all()
    finally:
        session.close()


def activity(user_id: int, account: Optional[str] = None, limit: int = 200) -> List[Dict[str, Any]]:
    cols = ("id", "ext_id", "account", "kind", "ts", "symbol", "side", "position_effect", "option_type", "strike",
            "expiry", "quantity", "price", "amount", "realized_gain", "strategy")
    return [{c: getattr(a, c) for c in cols} for a in _activity(user_id, account, limit)]


def _week(ts: str) -> str:
    d = datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(ET).date()
    return (d - timedelta(days=d.weekday())).isoformat()


def income(user_id: int, account: Optional[str] = None) -> Dict[str, Any]:
    """Option premium and realized P&L by week, month and symbol.

    premium = net cash from option fills (collected − bought back), open AND closed contracts.
    realized = the broker's realized P&L on closing trades (stocks and options); it already contains
    closed options' premium, so premium and realized must never be added together.
    """
    blank = lambda: {"premium": 0.0, "collected": 0.0, "bought_back": 0.0, "realized": 0.0, "trades": 0, "wins": 0}
    weekly: Dict[str, Dict[str, Any]] = defaultdict(blank)
    monthly: Dict[str, Dict[str, Any]] = defaultdict(blank)
    sym: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"premium": 0.0, "collected": 0.0, "bought_back": 0.0, "realized": 0.0, "trades": 0})
    rows = _activity(user_id, account)
    for a in rows:
        w, m = _week(a.ts), a.ts[:7]
        if a.kind == "option_fill" and a.amount is not None:
            for b in (weekly[w], monthly[m], sym[a.symbol]):
                b["premium"] += a.amount
                if a.amount >= 0:
                    b["collected"] += a.amount
                else:
                    b["bought_back"] += -a.amount
        elif a.kind == "realized" and a.realized_gain is not None:
            win = a.realized_gain > 0
            for b in (weekly[w], monthly[m]):
                b["realized"] += a.realized_gain
                b["trades"] += 1
                b["wins"] += int(win)
            sym[a.symbol]["realized"] += a.realized_gain
            sym[a.symbol]["trades"] += 1
    trades = sum(b["trades"] for b in monthly.values())
    wins = sum(b["wins"] for b in monthly.values())
    r2 = lambda d: {k: (round(v, 2) if isinstance(v, float) else v) for k, v in d.items()}
    return {
        "weekly": [{"period": k, **r2(v)} for k, v in sorted(weekly.items())][-26:],
        "monthly": [{"period": k, **r2(v)} for k, v in sorted(monthly.items())][-24:],
        "by_symbol": sorted(({"symbol": k, **r2(v)} for k, v in sym.items()),
                                                key=lambda x: -(x["collected"] + abs(x["realized"]))),
        "premium_total": round(sum(b["premium"] for b in monthly.values()), 2),
        "collected_total": round(sum(b["collected"] for b in monthly.values()), 2),
        "bought_back_total": round(sum(b["bought_back"] for b in monthly.values()), 2),
        "realized_total": round(sum(b["realized"] for b in monthly.values()), 2),
        "trades": trades, "win_rate": (wins / trades) if trades else None,
        "since": rows[-1].ts if rows else None,
    }
