"""optionflow/modules/hedge/service.py — broker positions, market inputs and live books.

Data cadence (per held symbol):
- spot ............ provider.last_price, at most once a second (the 1 s loop)
- prev close ...... provider.quote, every 5 minutes
- option chain .... provider.option_chain (Public.com real-time when configured), every 60 s;
                    each refresh records ATM IV for the IV-ROC / spike tracker
- HV20 ............ daily closes, hourly
- GEX levels ...... flow module's cached GEX (king node, walls, net GEX)
"""
from __future__ import annotations

import hmac
import logging
import math
import threading
import time
from collections import defaultdict
from datetime import date, datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from optionflow.core.db import get_session
from optionflow.core.settings import get_settings
from optionflow.modules.hedge import bs
from optionflow.modules.hedge.ivtrack import TRACKER
from optionflow.modules.hedge.suggest import Context, Leg, Quote, evaluate, pick_weekly
from optionflow.providers.market_data import get_market_data

logger = logging.getLogger("optionflow.hedge")

SPOT_TTL, QUOTE_TTL, CHAIN_TTL, HV_TTL, BETA_TTL = 1.0, 300.0, 60.0, 3600.0, 6 * 3600.0
BETA_BENCH = "SPY"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


# ── Broker positions ──────────────────────────────────────────────────────────
def check_ingest_token(token: Optional[str]) -> bool:
    expected = get_settings().hedge_ingest_token
    return bool(expected) and bool(token) and hmac.compare_digest(str(token), expected)


def ingest_username_allowed(username: str) -> bool:
    """The token is bound to one user (HEDGE_INGEST_USERNAME); anything else is refused."""
    allowed = get_settings().hedge_ingest_username.strip().lower()
    return bool(allowed) and username.strip().lower() == allowed


def replace_positions(user_id: int, source: str, rows: List[Dict[str, Any]]) -> Tuple[int, str]:
    """Replace every position of (user, source) with `rows`. Returns (count, synced_at)."""
    from database.models import BrokerPosition
    synced = now_iso()
    session = get_session()
    try:
        session.query(BrokerPosition).filter(BrokerPosition.user_id == user_id,
                                             BrokerPosition.source == source).delete()
        for r in rows:
            session.add(BrokerPosition(user_id=user_id, source=source, synced_at=synced, **r))
        session.commit()
        return len(rows), synced
    finally:
        session.close()


def list_positions(user_id: int) -> List[Dict[str, Any]]:
    from database.models import BrokerPosition
    session = get_session()
    try:
        rows = (session.query(BrokerPosition).filter(BrokerPosition.user_id == user_id)
                .order_by(BrokerPosition.symbol, BrokerPosition.kind.desc(), BrokerPosition.expiry).all())
        return [{c: getattr(r, c) for c in ("id", "source", "account", "symbol", "kind", "quantity", "avg_price",
                                              "option_type", "strike", "expiry", "multiplier", "opened_at", "synced_at")}
                for r in rows]
    finally:
        session.close()


def _dte(expiry: Optional[str], today: Optional[date] = None) -> Optional[float]:
    if not expiry:
        return None
    try:
        d = date.fromisoformat(expiry)
    except ValueError:
        return None
    t = today or datetime.now(timezone.utc).date()
    return float((d - t).days) + 0.25            # expires at the close: count the rest of expiry day


def group_legs(positions: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """{symbol: {"legs": [...], "avg_cost": weighted stock average, "accounts": [...]}}."""
    out: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"legs": [], "shares": 0.0, "cost": 0.0, "accounts": set()})
    for p in positions:
        g = out[p["symbol"].upper()]
        if p.get("account"):
            g["accounts"].add(p["account"])
        if p["kind"] == "stock":
            g["shares"] += p["quantity"]
            g["cost"] += p["quantity"] * (p.get("avg_price") or 0.0)
            continue
        g["legs"].append(Leg("option", p["quantity"], p.get("avg_price"), (p.get("option_type") or "").lower(),
                             p.get("strike"), p.get("expiry"), _dte(p.get("expiry"))))
    result = {}
    for sym, g in out.items():
        avg = g["cost"] / g["shares"] if g["shares"] > 0 else None
        legs = ([Leg("stock", g["shares"], avg)] if g["shares"] else []) + g["legs"]
        result[sym] = {"legs": legs, "avg_cost": avg, "accounts": sorted(g["accounts"])}
    return result


# ── Market inputs (cached) ────────────────────────────────────────────────────
class _Cache:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._d: Dict[Tuple[str, str], Tuple[float, Any]] = {}

    def get(self, kind: str, sym: str, ttl: float, fn: Callable[[], Any]) -> Any:
        key = (kind, sym)
        with self._lock:
            hit = self._d.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
        try:
            val = fn()
        except Exception as e:                        # keep the last good value on any provider error
            logger.debug("hedge %s %s failed: %s", kind, sym, e)
            return hit[1] if hit else None
        with self._lock:
            self._d[key] = (time.time(), val)
        return val

    def put(self, kind: str, sym: str, val: Any) -> None:
        with self._lock:
            self._d[(kind, sym)] = (time.time(), val)

    def clear(self) -> None:
        with self._lock:
            self._d.clear()


CACHE = _Cache()
_day_high: Dict[str, Tuple[date, float]] = {}


def prefetch_spots(syms: List[str]) -> None:
    """All held symbols' prices in one batched call (one Public request per tick, not one per symbol)."""
    fn = getattr(get_market_data(), "last_prices", None)
    if not callable(fn) or not syms:
        return
    try:
        prices = fn(list(syms)) or {}
    except Exception as e:
        logger.debug("hedge prefetch failed: %s", e)
        return
    for sym, price in prices.items():
        if price:
            CACHE.put("spot", sym, price)


def _spot(sym: str) -> Optional[float]:
    md = get_market_data()
    fn = getattr(md, "last_prices", None)
    if callable(fn):                                   # batched real-time quotes, when the provider has them
        return CACHE.get("spot", sym, SPOT_TTL, lambda: (fn([sym]) or {}).get(sym))
    return CACHE.get("spot", sym, SPOT_TTL, lambda: md.last_price(sym))


def _prev_close(sym: str) -> Optional[float]:
    return _quote(sym).get("prev_close")


def _quote(sym: str) -> Dict[str, Any]:
    """Provider quote (prev_close + the session fields), cached QUOTE_TTL; {} when unavailable."""
    return CACHE.get("quote", sym, QUOTE_TTL, lambda: get_market_data().quote(sym)) or {}


def _day_fields(sym: str, spot: float) -> Dict[str, Any]:
    """prev_close, day_change and the extended-hours fields for a book.

    During the regular session (or when the quote has no session, e.g. from Yahoo) day_change = spot / prev − 1.
    Outside it, like Robinhood: day_change = the last regular session's move, ext_change = spot − regular_close."""
    q = _quote(sym)
    prev, session, reg = q.get("prev_close"), q.get("session"), q.get("regular_close")
    out = {"prev_close": prev, "session": session, "regular_close": reg,
           "regular_close_date": q.get("regular_close_date"), "ext_change": None, "ext_change_pct": None,
           "day_change": spot / prev - 1.0 if prev else None}
    if session and session != "regular" and reg:
        out["day_change"] = q["change_pct"] / 100.0 if q.get("change_pct") is not None else None
        out["ext_change"] = round(spot - reg, 4)
        out["ext_change_pct"] = round((spot - reg) / reg * 100, 4)
    return out


def _hv(sym: str) -> Dict[str, Optional[float]]:
    def load():
        df = get_market_data().price_history(sym, "6mo", "1d")
        col = next((c for c in ("Close", "close") if df is not None and c in df.columns), None)
        closes = [float(c) for c in df[col].tolist()] if col and not df.empty else []
        return {"hv10": bs.historical_vol(closes, 10), "hv20": bs.historical_vol(closes, 20),
                "hv60": bs.historical_vol(closes, 60)}
    return CACHE.get("hv", sym, HV_TTL, load) or {"hv10": None, "hv20": None, "hv60": None}


def _closes(sym: str, period: str = "1y") -> Dict[str, float]:
    """{date: close} from daily bars."""
    df = get_market_data().price_history(sym, period, "1d")
    if df is None or df.empty:
        return {}
    col = next((c for c in ("Close", "close") if c in df.columns), None)
    if not col:
        return {}
    return {str(i)[:10]: float(v) for i, v in zip(df.index, df[col].tolist()) if v == v}


def _beta(sym: str) -> Optional[float]:
    """1-year beta of daily returns vs SPY (cov / var on dates both have). Cached for 6 h."""
    if sym == BETA_BENCH:
        return 1.0
    def load():
        bench = CACHE.get("closes", BETA_BENCH, BETA_TTL, lambda: _closes(BETA_BENCH)) or {}
        mine = _closes(sym)
        days = sorted(set(bench) & set(mine))
        if len(days) < 60:
            return None
        rb = [bench[b] / bench[a] - 1.0 for a, b in zip(days, days[1:])]
        rs = [mine[b] / mine[a] - 1.0 for a, b in zip(days, days[1:])]
        mb, ms = sum(rb) / len(rb), sum(rs) / len(rs)
        var = sum((x - mb) ** 2 for x in rb)
        cov = sum((x - mb) * (y - ms) for x, y in zip(rb, rs))
        return round(cov / var, 3) if var > 0 else None
    return CACHE.get("beta", sym, BETA_TTL, load)


def _gex(sym: str) -> Dict[str, Optional[float]]:
    def load():
        from optionflow.modules.flow import service as flow
        r = flow.get_gex(sym)
        return {"king": r.max_gex_strike, "put_wall": r.max_put_wall, "call_wall": r.max_call_wall,
                "net_gex": r.net_gex, "zero_gamma": r.zero_gamma} if not r.error else {}
    return CACHE.get("gex", sym, CHAIN_TTL, load) or {}


def _chain(sym: str) -> Optional[Dict[str, Any]]:
    """Chain rows by (expiry, strike, type) + the weekly expiry + ATM IV, refreshed every 60 s."""
    def load():
        ch = get_market_data().option_chain(sym)
        df, spot = ch.rows, ch.spot
        if df is None or df.empty:
            return None
        rows = {}
        exp_dte = {}
        for r in df.itertuples(index=False):
            dte = float(r.T) * 365.0
            exp_dte[r.expiry] = dte
            rows[(r.expiry, float(r.strike), str(r.otype))] = (float(r.iv or 0.0), float(r.mid or 0.0), dte)
        weekly = pick_weekly(list(exp_dte.items()))
        atm_iv = _atm_iv(rows, weekly, spot)
        TRACKER.record(sym, atm_iv)
        return {"rows": rows, "weekly": weekly, "atm_iv": atm_iv, "source": ch.source or getattr(get_market_data(), "name", None)}
    return CACHE.get("chain", sym, CHAIN_TTL, load)


def _far_contracts(sym: str, expiries: List[str]) -> Dict[Tuple[str, float, str], Tuple[float, float, float]]:
    """(iv, mid, dte) for held contracts outside the board chain's window (expiries > 60 DTE or beyond its
    12-expiry cap), fetched for just those expiries and refreshed with the chain. {} when unavailable."""
    def load():
        fetch = getattr(get_market_data(), "option_contracts", None)
        if fetch is None:
            return {}
        out: Dict[Tuple[str, float, str], Tuple[float, float, float]] = {}
        for r in fetch(sym, expiries=list(expiries)).rows.itertuples(index=False):
            bid, ask, last = (_num(r.bid), _num(r.ask), _num(r.last))
            mid = (bid + ask) / 2 if bid and ask and ask >= bid else (last or 0.0)
            out[(r.expiry, float(r.strike), str(r.otype))] = (_num(r.iv) or 0.0, mid, (_dte(r.expiry) or 0.0))
        return out
    try:
        return CACHE.get("far", f"{sym}|{','.join(expiries)}", CHAIN_TTL, load) or {}
    except Exception as exc:                       # no source could serve it: leave those legs unmarked
        logger.info("hedge far contracts %s %s failed: %s", sym, expiries, exc)
        return {}


def _num(v: Any) -> Optional[float]:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x == x else None


def _atm_iv(rows: Dict[Tuple[str, float, str], Tuple[float, float, float]], expiry: Optional[str],
            spot: float) -> Optional[float]:
    if not expiry or not spot:
        return None
    strikes = sorted({k for (e, k, _t) in rows if e == expiry})
    if not strikes:
        return None
    k = min(strikes, key=lambda s: abs(s - spot))
    ivs = [rows[(expiry, k, t)][0] for t in ("call", "put") if (expiry, k, t) in rows and rows[(expiry, k, t)][0] > bs.MIN_SIGMA]
    return sum(ivs) / len(ivs) if ivs else None


def _track_high(sym: str, spot: float) -> float:
    today = datetime.now(timezone.utc).date()
    d, hi = _day_high.get(sym, (today, spot))
    hi = spot if d != today else max(hi, spot)
    _day_high[sym] = (today, hi)
    return hi


# ── Books ─────────────────────────────────────────────────────────────────────
def build_book(sym: str, legs: List[Leg], avg_cost: Optional[float], accounts: List[str], rules: Any = None) -> Dict[str, Any]:
    """`rules`: the owner's strategy (strategy.catalog.Rules); None = the spike wheel."""
    spot = _spot(sym)
    chain = _chain(sym) or {}
    if not spot:
        return {"symbol": sym, "error": f"No price for {sym} right now.", "accounts": accounts}
    rows = chain.get("rows") or {}
    atm_iv = chain.get("atm_iv")
    far_exps = sorted({leg.expiry for leg in legs if leg.kind == "option" and leg.expiry
                       and (leg.expiry, float(leg.strike or 0), leg.otype or "") not in rows})
    far = _far_contracts(sym, far_exps) if far_exps else {}
    for leg in legs:                                   # IV per held contract, else ATM IV
        if leg.kind == "option":
            key = (leg.expiry, float(leg.strike or 0), leg.otype or "")
            hit = rows.get(key) or far.get(key)
            leg.iv = hit[0] if hit and hit[0] > bs.MIN_SIGMA else atm_iv
            leg.mark = hit[1] if hit and hit[1] > 0 else None
            leg.dte = _dte(leg.expiry)
    weekly = chain.get("weekly")
    chain_quotes = [Quote(k, t, iv, mid, mid, mid, dte, e)
                    for (e, k, t), (iv, mid, dte) in rows.items() if iv > bs.MIN_SIGMA]
    quotes = [q for q in chain_quotes if q.expiry == weekly]
    day = _day_fields(sym, spot)
    prev, day_change = day["prev_close"], day["day_change"]
    ivs = TRACKER.state(sym, day_change)
    hv = _hv(sym)
    gx = _gex(sym)
    ctx = Context(sym, spot, avg_cost, day_change, _track_high(sym, spot), ivs.atm_iv or atm_iv, hv.get("hv20"),
                  ivs.spike, ivs.cooling, gx.get("net_gex"), gx.get("king"), gx.get("put_wall"), gx.get("call_wall"))
    book = evaluate(ctx, legs, quotes, rules, chain_quotes).to_dict()
    book.update({
        "spot": round(spot, 4), **day, "day_high": ctx.day_high,
        "accounts": accounts, "weekly_expiry": weekly, "beta": _beta(sym), "chain_source": chain.get("source"),
        "iv": {"atm_iv": ivs.atm_iv or atm_iv, "iv_open": ivs.iv_open, "iv_roc_day": ivs.iv_roc_day,
               "iv_roc_15m": ivs.iv_roc_15m, "iv_high": ivs.iv_high, "spike": ivs.spike, "cooling": ivs.cooling,
               **hv},
        "levels": gx, "error": None,
    })
    return _clean(book)


def _clean(x: Any) -> Any:
    if isinstance(x, float):
        return x if math.isfinite(x) else None
    if isinstance(x, dict):
        return {k: _clean(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_clean(v) for v in x]
    return x


def _rules_for(user_id: int) -> Any:
    """The user's strategy rules (strategy module); None (spike wheel) if unset or the module can't answer."""
    try:
        from optionflow.modules.strategy import service as strategy
        return strategy.rules_for_user(user_id)
    except Exception:
        logger.exception("strategy rules for user %s failed; using the spike wheel", user_id)
        return None


def books_for(user_id: int) -> Dict[str, Any]:
    positions = list_positions(user_id)
    groups = group_legs(positions)
    prefetch_spots(sorted(groups))
    rules = _rules_for(user_id)
    books = []
    for sym, g in sorted(groups.items()):
        try:
            books.append(build_book(sym, g["legs"], g["avg_cost"], g["accounts"], rules))
        except Exception as e:                         # one bad symbol must not break the page
            logger.exception("hedge book %s failed", sym)
            books.append({"symbol": sym, "error": str(e), "accounts": g["accounts"]})
    synced = max((p["synced_at"] for p in positions), default=None)
    return {"as_of": now_iso(), "synced_at": synced, "books": books}
