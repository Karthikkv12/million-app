from __future__ import annotations

import os
import re
import time
import threading
from typing import Any, Dict, List, Optional, Set
from datetime import datetime, timezone, timedelta as _td

# ── Load .env if present (before anything else reads env vars) ────────────────
def _load_dotenv() -> None:
    """Minimal .env loader — no extra dependencies required."""
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    env_path = os.path.normpath(env_path)
    if not os.path.isfile(env_path):
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:   # don't override existing env
                os.environ[key] = val
_load_dotenv()

# ── GEX response cache ────────────────────────────────────────────────────────
# yfinance refreshes options data roughly every 15s; caching here prevents
# hammering yfinance on rapid polls and keeps response times fast.
_GEX_CACHE_TTL = 10  # seconds
_gex_cache: dict[str, tuple[float, Any]] = {}  # symbol -> (timestamp, result)

# ── Background poller ─────────────────────────────────────────────────────────
# Tracks which symbols are actively being watched (registered by the frontend).
# The poller thread fetches & snapshots each watched symbol every 10 s so the
# net-flow history chart fills up with real data continuously.
_POLL_INTERVAL = 10  # seconds — parallel fetches make this safe to tighten
_watched: Set[str] = set()           # symbols currently open in any browser tab
_watched_lock = threading.Lock()
_watched_ttl: dict[str, float] = {}  # symbol -> last-heartbeat monotonic time
_WATCH_TTL = 120  # seconds — drop symbol if no heartbeat for 2 min

import pandas as pd
import yfinance as yf
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from database.models import init_db
from logic import services

from .schemas import (
    AuthLoginRequest,
    AuthMeResponse,
    AuthResponse,
    AuthChangePasswordRequest,
    AuthLogoutRequest,
    AuthRefreshRequest,
    AuthSignupRequest,
    AuthEventOut,
    AuthSessionOut,
    AccountCreateRequest,
    AccountOut,
    HoldingUpsertRequest,
    HoldingOut,
    OrderCreateRequest,
    OrderFillRequest,
    OrderOut,
    BudgetCreateRequest,
    BudgetOut,
    BudgetOverrideRequest,
    BudgetOverrideOut,
    CreditCardWeekRequest,
    CreditCardWeekOut,
    CashCreateRequest,
    CashOut,
    TradeCloseRequest,
    TradeCreateRequest,
    TradeOut,
    TradeUpdateRequest,
    AdminUserOut,
    AdminCreateUserRequest,
    AdminPatchUserRequest,
)
from .security import create_access_token, decode_token


app = FastAPI(title="OptionFlow API", version="1.0.0")

# CORS: default to permissive for local dev, but allow locking down via env.
_cors_origins_raw = os.getenv("CORS_ALLOW_ORIGINS", "*")
_cors_origins = [o.strip() for o in _cors_origins_raw.split(",") if o.strip()]
_cors_is_wildcard = len(_cors_origins) == 1 and _cors_origins[0] == "*"
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    # Credentials cannot be used with wildcard origins.
    allow_credentials=False if _cors_is_wildcard else True,
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer(auto_error=False)


# Tracks (symbol, days) pairs already backfilled — keyed by date so they refresh each day
_backfilled: set[tuple[str, int]] = set()
_backfill_lock = threading.Lock()

# yfinance interval to use per day range — best granularity available
# 1m  data: available up to 7 days back
# 5m  data: available up to 60 days back
# 30m data: available up to 60 days back
# 1d  data: available for years
_RANGE_INTERVAL: dict[int, str] = {
    1:  "1m",
    2:  "5m",
    3:  "5m",
    7:  "30m",
    14: "30m",
    30: "1d",
}


def _backfill_history(sym: str, days: int) -> None:
    """Backfill `days` worth of OHLC bars for `sym` into net_flow_snapshots.

    Uses the highest-resolution interval yfinance supports for that range:
      1D  → 1-min bars  (~390 pts)
      2-3D → 5-min bars (~156–234 pts)
      7-14D → 30-min bars (~98–195 pts)
      30D → daily bars  (~22 pts)

    Call/put ratio is estimated from the current live options chain.
    All inserts use INSERT OR IGNORE so re-running is safe.
    """
    key = (sym, days)
    with _backfill_lock:
        if key in _backfilled:
            return
        _backfilled.add(key)

    try:
        import yfinance as yf
        interval = _RANGE_INTERVAL.get(days, "5m")
        # yfinance `period` strings
        period_map = {1: "1d", 2: "2d", 3: "5d", 7: "5d", 14: "1mo", 30: "1mo"}
        period = period_map.get(days, f"{days}d")

        ticker = yf.Ticker(sym)
        bars = ticker.history(period=period, interval=interval, progress=False)
        if bars is None or bars.empty:
            return

        # Normalise to UTC
        if bars.index.tz is None:
            bars.index = bars.index.tz_localize("UTC")
        else:
            bars.index = bars.index.tz_convert("UTC")

        # Trim to exactly `days` calendar days back from now
        cutoff = datetime.now(_tz.utc) - _td(days=days)
        bars = bars[bars.index >= cutoff]
        if bars.empty:
            return

        # Get call/put ratio + prem_per_share from current live chain
        call_ratio, put_ratio, prem_per_share = 0.55, 0.45, 0.5
        try:
            from logic.gamma import compute_gamma_exposure
            cached = _gex_cache.get(sym)
            result = cached[1] if cached else compute_gamma_exposure(sym)
            if not cached:
                _gex_cache[sym] = (time.monotonic(), result)
            total = (result.call_premium or 0) + (result.put_premium or 0)
            if total > 0:
                call_ratio = result.call_premium / total
                put_ratio  = result.put_premium  / total
            prem_per_share = total / max(result.total_volume or 1, 1)
        except Exception:
            pass

        # Load existing timestamps to avoid duplicates.
        # Use the same Z-suffix format we write so the IN-check matches.
        since_iso = cutoff.strftime("%Y-%m-%dT%H:%M:%SZ")
        with _flow_db() as con:
            existing = set(
                r[0] for r in con.execute(
                    "SELECT ts FROM net_flow_snapshots WHERE symbol=? AND ts>=?",
                    (sym, since_iso),
                ).fetchall()
            )

        rows_to_insert = []
        for ts_idx, row in bars.iterrows():
            # pandas isoformat can produce "2026-02-24 14:30:00+00:00" (space, offset)
            # Normalise to "2026-02-24T14:30:00Z" for consistent JS parsing
            raw_ts = ts_idx.isoformat(timespec="seconds")
            ts_str = raw_ts.replace(" ", "T")  # space → T
            # Replace +00:00 / -00:00 / +0000 with Z
            ts_str = re.sub(r"[+-]00:?00$", "Z", ts_str)
            if not ts_str.endswith("Z") and "+" not in ts_str and ts_str.count("-") == 2:
                ts_str += "Z"  # bare UTC timestamp, add Z
            if ts_str in existing:
                continue
            price  = float(row.get("Close", 0) or row.get("close", 0) or 0)
            volume = int(row.get("Volume", 0) or row.get("volume", 0) or 0)
            if price <= 0:
                continue
            est_total = volume * prem_per_share
            cp = round(est_total * call_ratio, 0)
            pp = round(est_total * put_ratio, 0)
            rows_to_insert.append(
                (sym, ts_str, round(price, 2), cp, pp, round(cp - pp, 0),
                 round(est_total, 0), volume)
            )

        if rows_to_insert:
            with _flow_db() as con:
                con.executemany(
                    "INSERT OR IGNORE INTO net_flow_snapshots "
                    "(symbol,ts,price,call_prem,put_prem,net_flow,total_prem,volume) "
                    "VALUES (?,?,?,?,?,?,?,?)",
                    rows_to_insert,
                )
    except Exception:
        with _backfill_lock:
            _backfilled.discard(key)


def _background_poller() -> None:
    """Daemon thread: fetch & snapshot every watched symbol every 15 s."""
    from logic.gamma import compute_gamma_exposure
    last_date = datetime.now(_tz.utc).date()
    while True:
        time.sleep(_POLL_INTERVAL)
        now = time.monotonic()

        # Reset backfill cache at midnight so all ranges refresh each new day
        today = datetime.now(_tz.utc).date()
        if today != last_date:
            with _backfill_lock:
                _backfilled.clear()
            last_date = today

        with _watched_lock:
            # Expire stale symbols (no heartbeat for > _WATCH_TTL seconds)
            expired = [s for s, t in _watched_ttl.items() if now - t > _WATCH_TTL]
            for s in expired:
                _watched.discard(s)
                _watched_ttl.pop(s, None)
            symbols = list(_watched)
        for sym in symbols:
            try:
                result = compute_gamma_exposure(sym)
                _gex_cache[sym] = (time.monotonic(), result)
                _record_flow_snapshot(
                    symbol=result.symbol,
                    spot=result.spot,
                    call_prem=result.call_premium,
                    put_prem=result.put_premium,
                    net_flow=result.net_flow,
                    total_prem=result.call_premium + result.put_premium,
                    volume=result.total_volume,
                )
            except Exception:
                pass  # never crash the poller


@app.on_event("startup")
def _startup() -> None:
    init_db()
    t = threading.Thread(target=_background_poller, daemon=True, name="gex-poller")
    t.start()


def _df_records(df: pd.DataFrame) -> List[Dict[str, Any]]:
    if df is None or df.empty:
        return []
    out: List[Dict[str, Any]] = []
    for rec in df.to_dict(orient="records"):
        cleaned: Dict[str, Any] = {}
        for k, v in rec.items():
            if isinstance(v, (pd.Timestamp, datetime)):
                cleaned[k] = pd.to_datetime(v).to_pydatetime().isoformat()
            else:
                cleaned[k] = v
        out.append(cleaned)
    return out


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(security),
) -> Dict[str, Any]:
    if creds is None:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    try:
        payload = decode_token(creds.credentials)
        if "sub" not in payload:
            raise ValueError("missing sub")
        jti = str(payload.get("jti") or "").strip()
        if jti and services.is_token_revoked(jti=jti):
            raise HTTPException(status_code=401, detail="Token has been revoked")
        token_iat = int(payload.get("iat") or 0)
        if not services.is_token_time_valid(user_id=int(payload["sub"]), token_iat=token_iat):
            raise HTTPException(status_code=401, detail="Token is no longer valid. Please sign in again.")
        return payload
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


def require_admin(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    if str(user.get("role") or "user") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


# ── Ticker search (no auth required — public autocomplete) ────────────────────
_SEARCH_CACHE_TTL = 60  # seconds
_search_cache: dict[str, tuple[float, list]] = {}  # query -> (ts, results)

@app.get("/search/tickers")
def search_tickers(q: str = "", limit: int = 8) -> List[Dict[str, Any]]:
    """Fuzzy ticker + company name search backed by yfinance.Search.
    Returns up to `limit` suggestions with symbol, name, type, exchange.
    Results are cached for 60 s to avoid hammering Yahoo on rapid keystrokes.
    """
    q = q.strip()
    if not q:
        return []
    key = q.lower()
    cached = _search_cache.get(key)
    now = time.monotonic()
    if cached and (now - cached[0]) < _SEARCH_CACHE_TTL:
        return cached[1][:limit]

    try:
        import yfinance as yf
        res = yf.Search(q, max_results=min(limit, 20), enable_fuzzy_query=True)
        quotes = res.quotes or []
        results = []
        seen: set[str] = set()
        # Preferred exchange ordering: US > Indian > everything else
        _PREFERRED = {"NASDAQ", "NYSE", "NYSE ARCA", "NYSE MKT", "NSE", "BSE", "Bombay"}
        def _sort_key(r: dict) -> int:
            ex = r.get("exchDisp", "") or ""
            if ex in {"NASDAQ", "NYSE", "NYSE ARCA", "NYSE MKT"}:
                return 0
            if ex in {"NSE", "BSE", "Bombay"}:
                return 1
            return 2
        for q_item in sorted(quotes, key=_sort_key):
            sym = (q_item.get("symbol") or "").strip()
            if not sym or sym in seen:
                continue
            seen.add(sym)
            name = (q_item.get("shortname") or q_item.get("longname") or "").strip()
            type_ = (q_item.get("typeDisp") or q_item.get("quoteType") or "").strip()
            exch  = (q_item.get("exchDisp") or q_item.get("exchange") or "").strip()
            results.append({"symbol": sym, "name": name, "type": type_, "exchange": exch})
        _search_cache[key] = (now, results)
        return results[:limit]
    except Exception as exc:
        return []


@app.post("/options/watch", status_code=204)
def watch_symbols(body: Dict[str, Any], _user=Depends(get_current_user)) -> None:
    """Frontend calls this to register which symbols are currently open.
    Expects JSON: { "symbols": ["SPY", "QQQ"] }
    Heartbeat TTL is _WATCH_TTL seconds — call every ~60 s to keep symbols active.
    On first registration of a symbol, triggers a background backfill of today's
    intraday bars so the chart shows the full day's move immediately.
    """
    symbols: list[str] = [s.strip().upper() for s in body.get("symbols", []) if s]
    now = time.monotonic()
    new_symbols: list[str] = []
    with _watched_lock:
        for s in symbols:
            if s not in _watched:
                new_symbols.append(s)
            _watched.add(s)
            _watched_ttl[s] = now

    # Backfill all day ranges for newly registered symbols (non-blocking)
    for s in new_symbols:
        for d in _RANGE_INTERVAL:  # 1, 2, 3, 7, 14, 30
            threading.Thread(target=_backfill_history, args=(s, d), daemon=True,
                             name=f"backfill-{s}-{d}d").start()


# ── Net-flow persistent snapshot store ───────────────────────────────────────
# Snapshots are written to SQLite so history survives server restarts and
# supports multi-day range queries (1D / 2D / 3D / 7D / 14D / 30D).
import sqlite3 as _sqlite3
from collections import deque
from datetime import timezone as _tz, timedelta as _td
from pathlib import Path as _Path

_FLOW_DB = _Path(__file__).parent.parent / "trading_journal.db"

def _flow_db() -> _sqlite3.Connection:
    con = _sqlite3.connect(str(_FLOW_DB))
    con.execute("""
        CREATE TABLE IF NOT EXISTS net_flow_snapshots (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol     TEXT    NOT NULL,
            ts         TEXT    NOT NULL,          -- ISO-8601 UTC
            price      REAL    NOT NULL,
            call_prem  REAL    NOT NULL,
            put_prem   REAL    NOT NULL,
            net_flow   REAL    NOT NULL,
            total_prem REAL    NOT NULL DEFAULT 0,
            volume     INTEGER NOT NULL DEFAULT 0
        )
    """)
    # Add columns if DB was created before volume/total_prem existed
    for col, typ in [("total_prem", "REAL NOT NULL DEFAULT 0"),
                     ("volume",     "INTEGER NOT NULL DEFAULT 0")]:
        try:
            con.execute(f"ALTER TABLE net_flow_snapshots ADD COLUMN {col} {typ}")
        except _sqlite3.OperationalError:
            pass
    con.execute("CREATE INDEX IF NOT EXISTS idx_nf_sym_ts ON net_flow_snapshots (symbol, ts)")
    # One-time migration: normalise legacy "+00:00" timestamps to "Z" so
    # all string comparisons in WHERE ts>=? work correctly with a single format.
    con.execute("""
        UPDATE net_flow_snapshots
        SET ts = REPLACE(REPLACE(ts, '+00:00', 'Z'), ' ', 'T')
        WHERE ts LIKE '%+00:00' OR ts LIKE '% %'
    """)
    con.commit()
    return con


def _record_flow_snapshot(
    symbol: str,
    spot: float,
    call_prem: float,
    put_prem: float,
    net_flow: float,
    total_prem: float = 0.0,
    volume: int = 0,
) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with _flow_db() as con:
        con.execute(
            "INSERT INTO net_flow_snapshots (symbol,ts,price,call_prem,put_prem,net_flow,total_prem,volume) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (symbol, ts, round(spot, 2), round(call_prem, 0), round(put_prem, 0),
             round(net_flow, 0), round(total_prem, 0), int(volume)),
        )


_DAYS_LABEL = {1: "%H:%M", 2: "%m/%d %H:%M", 3: "%m/%d %H:%M",
               7: "%m/%d", 14: "%m/%d", 30: "%m/%d"}

@app.get("/options/net-flow-history/{symbol}", response_model=List[Dict[str, Any]])
def net_flow_history(symbol: str, days: int = 1, bucket: int = 0, _user=Depends(get_current_user)) -> List[Dict[str, Any]]:
    """Return net-flow snapshot history for a symbol.
    ?days=   controls how many calendar days of history to return (1‥30).
    ?bucket= bucket size in minutes (0 = no bucketing, return raw rows).
             Typical usage: bucket=60 for 1-hr candles, bucket=1440 for 1-day candles.
    Returns raw ISO-8601 UTC timestamps so the frontend can render in local time.
    """
    days = max(1, min(days, 30))
    sym = symbol.upper()
    cutoff_dt = datetime.now(_tz.utc) - _td(days=days)
    since_z   = cutoff_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    since_off = cutoff_dt.strftime("%Y-%m-%dT%H:%M:%S+00:00")
    with _flow_db() as con:
        rows = con.execute(
            "SELECT ts,price,call_prem,put_prem,net_flow,total_prem,volume "
            "FROM net_flow_snapshots WHERE symbol=? AND (ts>=? OR ts>=?) ORDER BY ts",
            (sym, since_z, since_off),
        ).fetchall()

    if not rows:
        return []

    # ── Optional bucketing ────────────────────────────────────────────────────
    if bucket and bucket > 0:
        from collections import defaultdict
        import math
        bucket_secs = bucket * 60
        buckets: dict = defaultdict(list)
        for ts, price, cp, pp, nf, tp, vol in rows:
            try:
                dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                epoch = int(dt.timestamp())
                key = (epoch // bucket_secs) * bucket_secs
                buckets[key].append((ts, price, cp, pp, nf, tp, vol))
            except Exception:
                continue
        result = []
        for key in sorted(buckets):
            group = buckets[key]
            # Use last snapshot in bucket for price/flow (most recent value)
            last = group[-1]
            bucket_ts = datetime.fromtimestamp(key, tz=_tz.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            result.append({
                "ts":         bucket_ts,
                "price":      last[1],
                "call_prem":  last[2],
                "put_prem":   last[3],
                "net_flow":   last[4],
                "total_prem": last[5],
                "volume":     sum(r[6] for r in group),
            })
        return result

    # ── Raw rows ──────────────────────────────────────────────────────────────
    result = []
    for ts, price, cp, pp, nf, tp, vol in rows:
        result.append({
            "ts":         ts,
            "price":      price,
            "call_prem":  cp,
            "put_prem":   pp,
            "net_flow":   nf,
            "total_prem": tp,
            "volume":     vol,
        })
    return result


@app.get("/market/quotes")
def market_quotes(symbols: str) -> List[Dict[str, Any]]:
    """Return live quotes for a comma-separated list of symbols (e.g. SPY,QQQ,ES=F).
    Uses yfinance — no API key required. Protected by the same CORS policy as the rest of the API.
    """
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not syms or len(syms) > 25:
        raise HTTPException(status_code=400, detail="Provide 1–25 comma-separated symbols")
    results: List[Dict[str, Any]] = []
    for sym in syms:
        try:
            t = yf.Ticker(sym)
            info = t.fast_info  # lightweight, no full scrape
            price     = float(info.last_price)        if info.last_price     is not None else None
            prev      = float(info.previous_close)    if info.previous_close is not None else None
            change    = round(price - prev, 4)        if price is not None and prev is not None else None
            change_pct = round((change / prev) * 100, 4) if change is not None and prev else None
            results.append({
                "symbol":     sym,
                "price":      price,
                "prev_close": prev,
                "change":     change,
                "change_pct": change_pct,
            })
        except Exception:
            results.append({"symbol": sym, "price": None, "prev_close": None, "change": None, "change_pct": None})
    return results


@app.post("/auth/signup", response_model=AuthResponse)
def signup(req: AuthSignupRequest, request: Request) -> AuthResponse:
    # Registration is currently closed.
    raise HTTPException(status_code=403, detail="Registration is not open at this time.")


@app.post("/auth/login", response_model=AuthResponse)
def login(req: AuthLoginRequest, request: Request) -> AuthResponse:
    username = str(req.username).strip().lower()
    ip = getattr(getattr(request, "client", None), "host", None)
    ua = request.headers.get("user-agent")

    try:
        if services.is_login_rate_limited(username=username, ip=str(ip) if ip else None):
            services.log_auth_event(event_type="login_throttled", success=False, username=username, ip=str(ip) if ip else None, user_agent=ua)
            raise HTTPException(status_code=429, detail="Too many login attempts. Please try again later.")
    except HTTPException:
        raise
    except Exception:
        pass

    auth_result = services.authenticate_user(username, req.password)
    if not auth_result:
        services.log_auth_event(
            event_type="login",
            success=False,
            username=username,
            ip=str(ip) if ip else None,
            user_agent=ua,
            detail="invalid credentials",
        )
        raise HTTPException(status_code=401, detail="Invalid username or password")
    user_id = auth_result["user_id"]
    role = auth_result.get("role", "user")
    token = create_access_token(subject=str(user_id), extra={"username": username, "role": role})
    refresh_token = services.create_refresh_token(user_id=int(user_id), ip=str(ip) if ip else None, user_agent=ua)
    services.log_auth_event(event_type="login", success=True, username=username, user_id=int(user_id), ip=str(ip) if ip else None, user_agent=ua)
    return AuthResponse(access_token=token, refresh_token=refresh_token, user_id=int(user_id), username=username, role=role)


@app.post("/auth/refresh", response_model=AuthResponse)
def refresh(req: AuthRefreshRequest, request: Request) -> AuthResponse:
    ip = getattr(getattr(request, "client", None), "host", None)
    ua = request.headers.get("user-agent")
    try:
        if services.is_refresh_rate_limited(ip=str(ip) if ip else None):
            services.log_auth_event(event_type="refresh_throttled", success=False, ip=str(ip) if ip else None, user_agent=ua)
            raise HTTPException(status_code=429, detail="Too many refresh attempts. Please try again later.")
    except HTTPException:
        raise
    except Exception:
        pass

    rotated = services.rotate_refresh_token(refresh_token=req.refresh_token, ip=str(ip) if ip else None, user_agent=ua)
    if not rotated:
        services.log_auth_event(event_type="refresh", success=False, ip=str(ip) if ip else None, user_agent=ua, detail="invalid refresh token")
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    user_id, new_refresh_token = rotated
    u = services.get_user(int(user_id))
    username = str(getattr(u, "username", "") or "") if u is not None else ""
    role = str(getattr(u, "role", None) or "user") if u is not None else "user"
    token = create_access_token(subject=str(user_id), extra={"username": username, "role": role})
    services.log_auth_event(event_type="refresh", success=True, username=username, user_id=int(user_id), ip=str(ip) if ip else None, user_agent=ua)
    return AuthResponse(
        access_token=token,
        refresh_token=new_refresh_token,
        user_id=int(user_id),
        username=username,
        role=role,
    )


@app.get("/auth/events", response_model=List[AuthEventOut])
def auth_events(user=Depends(get_current_user)) -> List[AuthEventOut]:
    rows = services.list_auth_events(user_id=int(user["sub"]), limit=25)
    out: List[AuthEventOut] = []
    for r in rows:
        out.append(
            AuthEventOut(
                created_at=r.get("created_at"),
                event_type=str(r.get("event_type") or ""),
                success=bool(r.get("success")),
                ip=str(r.get("ip") or "") or None,
                detail=str(r.get("detail") or "") or None,
            )
        )
    return out


@app.get("/auth/me", response_model=AuthMeResponse)
def me(user=Depends(get_current_user)) -> AuthMeResponse:
    user_id = int(user["sub"])
    username = str(user.get("username") or "")
    role = str(user.get("role") or "user")
    u = services.get_user(user_id)
    if u is not None:
        username = str(getattr(u, "username", username) or username)
        role = str(getattr(u, "role", None) or role)
    return AuthMeResponse(user_id=user_id, username=username, role=role)


@app.post("/auth/logout")
def logout(req: AuthLogoutRequest | None = None, user=Depends(get_current_user)) -> Dict[str, str]:
    user_id = int(user["sub"])
    jti = str(user.get("jti") or "").strip()
    exp_raw = user.get("exp")
    try:
        exp_dt = datetime.fromtimestamp(int(exp_raw), tz=timezone.utc)
    except Exception:
        exp_dt = datetime.now(timezone.utc)
    if jti:
        services.revoke_token(user_id=user_id, jti=jti, expires_at=exp_dt)

    # Optionally revoke the current refresh token (device logout).
    try:
        if req is not None and getattr(req, "refresh_token", None):
            services.revoke_refresh_token(user_id=user_id, refresh_token=str(req.refresh_token))
    except Exception:
        pass

    services.log_auth_event(event_type="logout", success=True, username=str(user.get("username") or ""), user_id=user_id)
    return {"status": "ok"}


@app.post("/auth/logout-all")
def logout_all(user=Depends(get_current_user)) -> Dict[str, str]:
    """Invalidate all tokens for this user (all devices).

    We set auth_valid_after to (current token iat + 1s) so every token issued at or
    before the current token becomes invalid.
    """
    user_id = int(user["sub"])
    token_iat = int(user.get("iat") or 0)
    cutoff_epoch = int(token_iat) + 1
    services.set_auth_valid_after_epoch(user_id=user_id, epoch_seconds=cutoff_epoch)

    # Revoke all refresh tokens for this user.
    try:
        services.revoke_all_refresh_tokens(user_id=user_id)
    except Exception:
        pass

    # Also revoke this token's jti best-effort (helps even if auth_valid_after isn't enforced somewhere).
    jti = str(user.get("jti") or "").strip()
    exp_raw = user.get("exp")
    try:
        exp_dt = datetime.fromtimestamp(int(exp_raw), tz=timezone.utc)
    except Exception:
        exp_dt = datetime.now(timezone.utc)
    if jti:
        services.revoke_token(user_id=user_id, jti=jti, expires_at=exp_dt)

    services.log_auth_event(event_type="logout_all", success=True, username=str(user.get("username") or ""), user_id=user_id)

    return {"status": "ok"}


@app.post("/auth/change-password", response_model=AuthResponse)
def change_password(req: AuthChangePasswordRequest, user=Depends(get_current_user)) -> AuthResponse:
    user_id = int(user["sub"])
    username = str(user.get("username") or "")
    try:
        services.change_password(
            user_id=user_id,
            old_password=req.current_password,
            new_password=req.new_password,
            # Invalidate tokens issued at/before this one.
            invalidate_tokens_before_epoch=int(user.get("iat") or 0) + 1,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Password change should invalidate refresh tokens too.
    try:
        services.revoke_all_refresh_tokens(user_id=user_id)
    except Exception:
        pass

    services.log_auth_event(event_type="change_password", success=True, username=str(user.get("username") or ""), user_id=user_id)

    # Mint a new token guaranteed to be valid after the cutoff.
    issued_at = datetime.fromtimestamp(int(user.get("iat") or 0) + 1, tz=timezone.utc)
    token = create_access_token(subject=str(user_id), extra={"username": username}, issued_at=issued_at)
    refresh_token = services.create_refresh_token(user_id=int(user_id))
    return AuthResponse(access_token=token, refresh_token=refresh_token, user_id=int(user_id), username=username)


@app.get("/auth/sessions", response_model=List[AuthSessionOut])
def auth_sessions(user=Depends(get_current_user)) -> List[AuthSessionOut]:
    rows = services.list_refresh_sessions(user_id=int(user["sub"]), limit=25)
    out: List[AuthSessionOut] = []
    for r in rows:
        out.append(
            AuthSessionOut(
                id=int(r.get("id")),
                created_at=r.get("created_at"),
                last_used_at=r.get("last_used_at"),
                ip=r.get("ip"),
                user_agent=r.get("user_agent"),
                expires_at=r.get("expires_at"),
            )
        )
    return out


@app.post("/auth/sessions/{session_id}/revoke")
def revoke_session(session_id: int, user=Depends(get_current_user)) -> Dict[str, str]:
    user_id = int(user["sub"])
    ok = services.revoke_refresh_session_by_id(user_id=user_id, session_id=int(session_id), reason="revoked")
    if not ok:
        raise HTTPException(status_code=404, detail="Session not found")
    services.log_auth_event(event_type="revoke_session", success=True, username=str(user.get("username") or ""), user_id=user_id)
    return {"status": "ok"}


@app.get("/accounts", response_model=List[AccountOut])
def list_accounts(user=Depends(get_current_user)) -> List[AccountOut]:
    rows = services.list_accounts(user_id=int(user["sub"]))
    out: List[AccountOut] = []
    for r in rows:
        out.append(
            AccountOut(
                id=int(r.get("id")),
                name=str(r.get("name") or ""),
                broker=(str(r.get("broker") or "") or None),
                currency=str(r.get("currency") or "USD"),
                created_at=r.get("created_at"),
            )
        )
    return out


@app.post("/accounts", response_model=AccountOut)
def create_account(req: AccountCreateRequest, user=Depends(get_current_user)) -> AccountOut:
    user_id = int(user["sub"])
    try:
        account_id = services.create_account(
            user_id=user_id,
            name=req.name,
            broker=req.broker,
            currency=req.currency,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return AccountOut(id=int(account_id), name=str(req.name), broker=req.broker, currency=str(req.currency).upper())


@app.get("/accounts/{account_id}/holdings", response_model=List[HoldingOut])
def list_holdings(account_id: int, user=Depends(get_current_user)) -> List[HoldingOut]:
    try:
        rows = services.list_holdings(user_id=int(user["sub"]), account_id=int(account_id))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    out: List[HoldingOut] = []
    for r in rows:
        out.append(
            HoldingOut(
                id=int(r.get("id")),
                account_id=int(r.get("account_id")),
                symbol=str(r.get("symbol") or ""),
                quantity=float(r.get("quantity") or 0.0),
                avg_cost=r.get("avg_cost"),
                updated_at=r.get("updated_at"),
            )
        )
    return out


@app.put("/accounts/{account_id}/holdings", response_model=HoldingOut)
def upsert_holding(account_id: int, req: HoldingUpsertRequest, user=Depends(get_current_user)) -> HoldingOut:
    try:
        r = services.upsert_holding(
            user_id=int(user["sub"]),
            account_id=int(account_id),
            symbol=req.symbol,
            quantity=float(req.quantity),
            avg_cost=req.avg_cost,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return HoldingOut(
        id=int(r.get("id")),
        account_id=int(r.get("account_id")),
        symbol=str(r.get("symbol") or ""),
        quantity=float(r.get("quantity") or 0.0),
        avg_cost=r.get("avg_cost"),
        updated_at=r.get("updated_at"),
    )


@app.delete("/holdings/{holding_id}")
def delete_holding(holding_id: int, user=Depends(get_current_user)) -> Dict[str, str]:
    ok = services.delete_holding(user_id=int(user["sub"]), holding_id=int(holding_id))
    if not ok:
        raise HTTPException(status_code=404, detail="Holding not found")
    return {"status": "ok"}


@app.get("/orders", response_model=List[OrderOut])
def list_orders(user=Depends(get_current_user)) -> List[OrderOut]:
    rows = services.list_orders(user_id=int(user["sub"]))
    out: List[OrderOut] = []
    for r in rows:
        out.append(
            OrderOut(
                id=int(r.get("id")),
                symbol=str(r.get("symbol") or ""),
                instrument=str(r.get("instrument") or ""),
                action=str(r.get("action") or ""),
                strategy=(str(r.get("strategy") or "") or None),
                quantity=int(r.get("quantity") or 0),
                limit_price=r.get("limit_price"),
                status=str(r.get("status") or ""),
                created_at=r.get("created_at"),
                filled_at=r.get("filled_at"),
                filled_price=r.get("filled_price"),
                trade_id=(int(r.get("trade_id")) if r.get("trade_id") is not None else None),
                client_order_id=(str(r.get("client_order_id") or "") or None),
                external_order_id=(str(r.get("external_order_id") or "") or None),
                venue=(str(r.get("venue") or "") or None),
                external_status=(str(r.get("external_status") or "") or None),
                last_synced_at=r.get("last_synced_at"),
            )
        )
    return out


@app.post("/orders", response_model=Dict[str, Any])
def create_order(req: OrderCreateRequest, user=Depends(get_current_user)) -> Dict[str, Any]:
    try:
        oid = services.create_order(
            user_id=int(user["sub"]),
            symbol=req.symbol,
            instrument=req.instrument,
            action=req.action,
            strategy=req.strategy,
            qty=int(req.qty),
            limit_price=req.limit_price,
            client_order_id=req.client_order_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "ok", "order_id": int(oid)}


@app.post("/orders/{order_id}/cancel")
def cancel_order(order_id: int, user=Depends(get_current_user)) -> Dict[str, str]:
    ok = services.cancel_order(user_id=int(user["sub"]), order_id=int(order_id))
    if not ok:
        raise HTTPException(status_code=400, detail="Order not found or not cancelable")
    return {"status": "ok"}


@app.post("/orders/{order_id}/fill", response_model=Dict[str, Any])
def fill_order(order_id: int, req: OrderFillRequest, user=Depends(get_current_user)) -> Dict[str, Any]:
    try:
        trade_id = services.fill_order(
            user_id=int(user["sub"]),
            order_id=int(order_id),
            filled_price=float(req.filled_price),
            filled_at=req.filled_at,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "ok", "trade_id": int(trade_id)}


@app.post("/orders/{order_id}/sync")
def sync_order(order_id: int, user=Depends(get_current_user)) -> Dict[str, str]:
    ok = services.sync_order_status(user_id=int(user["sub"]), order_id=int(order_id))
    if not ok:
        raise HTTPException(status_code=400, detail="Order not found, not linked to broker, or broker disabled")
    return {"status": "ok"}


@app.post("/orders/sync-pending")
def sync_pending_orders(user=Depends(get_current_user)) -> Dict[str, int]:
    n = services.sync_pending_orders(user_id=int(user["sub"]))
    return {"status": 0, "updated": int(n)}


@app.post("/orders/{order_id}/fill-external", response_model=Dict[str, Any])
def fill_order_external(order_id: int, req: OrderFillRequest, user=Depends(get_current_user)) -> Dict[str, Any]:
    try:
        trade_id = services.fill_order_via_broker(
            user_id=int(user["sub"]),
            order_id=int(order_id),
            filled_price=float(req.filled_price),
            filled_at=req.filled_at,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "ok", "trade_id": int(trade_id)}


@app.get("/orders/{order_id}/events", response_model=List[Dict[str, Any]])
def order_events(order_id: int, user=Depends(get_current_user), limit: int = 200) -> List[Dict[str, Any]]:
    rows = services.list_order_events(user_id=int(user["sub"]), order_id=int(order_id), limit=int(limit))
    cleaned: List[Dict[str, Any]] = []
    for r in rows:
        rec: Dict[str, Any] = dict(r)
        v = rec.get("created_at")
        if isinstance(v, (pd.Timestamp, datetime)):
            rec["created_at"] = pd.to_datetime(v).to_pydatetime().isoformat()
        cleaned.append(rec)
    return cleaned


@app.get("/trades", response_model=List[Dict[str, Any]])
def list_trades(user=Depends(get_current_user)) -> List[Dict[str, Any]]:
    trades, _, _ = services.load_data(user_id=int(user["sub"]))
    return _df_records(trades)


@app.post("/trades")
def create_trade(req: TradeCreateRequest, user=Depends(get_current_user)) -> Dict[str, str]:
    services.save_trade(
        req.symbol,
        req.instrument,
        req.strategy,
        req.action,
        req.qty,
        req.price,
        req.date,
        user_id=int(user["sub"]),
        client_order_id=req.client_order_id,
    )
    return {"status": "ok"}


@app.put("/trades/{trade_id}")
def update_trade(trade_id: int, req: TradeUpdateRequest, user=Depends(get_current_user)) -> Dict[str, str]:
    ok = services.update_trade(
        trade_id,
        req.symbol,
        req.strategy,
        req.action,
        req.qty,
        req.price,
        req.date,
        user_id=int(user["sub"]),
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Trade not found")
    return {"status": "ok"}


@app.post("/trades/{trade_id}/close")
def close_trade(trade_id: int, req: TradeCloseRequest, user=Depends(get_current_user)) -> Dict[str, str]:
    ok = services.close_trade(
        trade_id,
        req.exit_price,
        exit_date=req.exit_date,
        user_id=int(user["sub"]),
    )
    if not ok:
        raise HTTPException(status_code=400, detail="Trade not found or already closed")
    return {"status": "ok"}


@app.delete("/trades/{trade_id}")
def delete_trade(trade_id: int, user=Depends(get_current_user)) -> Dict[str, str]:
    ok = services.delete_trade(trade_id, user_id=int(user["sub"]))
    if not ok:
        raise HTTPException(status_code=404, detail="Trade not found")
    return {"status": "ok"}


# ── Weekly Options Portfolio ──────────────────────────────────────────────────

@app.get("/portfolio/weeks", response_model=List[Dict[str, Any]])
def list_weeks(user=Depends(get_current_user)) -> List[Dict[str, Any]]:
    from logic.portfolio import list_weeks as _list_weeks
    return _list_weeks(user_id=int(user["sub"]))


@app.post("/portfolio/weeks", response_model=Dict[str, Any])
def get_or_create_week(body: Dict[str, Any], user=Depends(get_current_user)) -> Dict[str, Any]:
    """Pass {"for_date": "YYYY-MM-DD"} or {} to get/create the current week."""
    from logic.portfolio import get_or_create_week as _get_or_create, _parse_dt
    for_date = _parse_dt(body.get("for_date"))
    return _get_or_create(user_id=int(user["sub"]), for_date=for_date)


@app.get("/portfolio/weeks/{week_id}", response_model=Dict[str, Any])
def get_week(week_id: int, user=Depends(get_current_user)) -> Dict[str, Any]:
    from logic.portfolio import get_week as _get_week
    w = _get_week(user_id=int(user["sub"]), week_id=week_id)
    if w is None:
        raise HTTPException(status_code=404, detail="Week not found")
    return w


@app.patch("/portfolio/weeks/{week_id}", response_model=Dict[str, Any])
def update_week(week_id: int, body: Dict[str, Any], user=Depends(get_current_user)) -> Dict[str, Any]:
    from logic.portfolio import update_week as _update_week
    try:
        return _update_week(
            user_id=int(user["sub"]),
            week_id=week_id,
            account_value=body.get("account_value"),
            notes=body.get("notes"),
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/portfolio/weeks/{week_id}/complete", response_model=Dict[str, Any])
def mark_week_complete(week_id: int, body: Dict[str, Any], user=Depends(get_current_user)) -> Dict[str, Any]:
    from logic.portfolio import mark_week_complete as _complete
    try:
        return _complete(
            user_id=int(user["sub"]),
            week_id=week_id,
            account_value=body.get("account_value"),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/portfolio/weeks/{week_id}/reopen", response_model=Dict[str, Any])
def reopen_week(week_id: int, user=Depends(get_current_user)) -> Dict[str, Any]:
    from logic.portfolio import reopen_week as _reopen
    try:
        return _reopen(user_id=int(user["sub"]), week_id=week_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/portfolio/weeks/{week_id}/positions", response_model=List[Dict[str, Any]])
def list_positions(week_id: int, user=Depends(get_current_user)) -> List[Dict[str, Any]]:
    from logic.portfolio import list_positions as _list_positions
    return _list_positions(user_id=int(user["sub"]), week_id=week_id)


@app.post("/portfolio/weeks/{week_id}/positions", response_model=Dict[str, Any])
def create_position(week_id: int, body: Dict[str, Any], user=Depends(get_current_user)) -> Dict[str, Any]:
    from logic.portfolio import create_position as _create
    try:
        return _create(user_id=int(user["sub"]), week_id=week_id, data=body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.patch("/portfolio/positions/{position_id}", response_model=Dict[str, Any])
def update_position(position_id: int, body: Dict[str, Any], user=Depends(get_current_user)) -> Dict[str, Any]:
    from logic.portfolio import update_position as _update
    from logic.holdings import apply_position_status_change as _apply_holding
    try:
        result = _update(user_id=int(user["sub"]), position_id=position_id, data=body)
        # Fire holding trigger automatically when status changes
        if "status" in body:
            try:
                _apply_holding(
                    user_id=int(user["sub"]),
                    position_id=position_id,
                    new_status=body["status"],
                )
            except Exception:
                pass  # holding trigger errors never break the position update
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/portfolio/positions/{position_id}")
def delete_position(position_id: int, user=Depends(get_current_user)) -> Dict[str, str]:
    from logic.portfolio import delete_position as _delete
    try:
        _delete(user_id=int(user["sub"]), position_id=position_id)
        return {"status": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/portfolio/positions/{position_id}/assign", response_model=Dict[str, Any])
def create_assignment(position_id: int, body: Dict[str, Any], user=Depends(get_current_user)) -> Dict[str, Any]:
    from logic.portfolio import create_assignment as _assign
    try:
        return _assign(user_id=int(user["sub"]), position_id=position_id, data=body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/portfolio/positions/{position_id}/assignment", response_model=Dict[str, Any])
def get_assignment(position_id: int, user=Depends(get_current_user)) -> Dict[str, Any]:
    from logic.portfolio import get_assignment_for_position as _get_assign
    a = _get_assign(user_id=int(user["sub"]), position_id=position_id)
    if a is None:
        raise HTTPException(status_code=404, detail="No assignment found")
    return a


@app.patch("/portfolio/assignments/{assignment_id}", response_model=Dict[str, Any])
def update_assignment(assignment_id: int, body: Dict[str, Any], user=Depends(get_current_user)) -> Dict[str, Any]:
    from logic.portfolio import update_assignment as _update_assign
    try:
        return _update_assign(user_id=int(user["sub"]), assignment_id=assignment_id, data=body)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/portfolio/summary", response_model=Dict[str, Any])
def portfolio_summary(user=Depends(get_current_user)) -> Dict[str, Any]:
    from logic.portfolio import portfolio_summary as _summary
    return _summary(user_id=int(user["sub"]))


@app.get("/portfolio/symbols", response_model=List[Dict[str, Any]])
def symbol_summary(user=Depends(get_current_user)) -> List[Dict[str, Any]]:
    from logic.portfolio import symbol_summary as _sym_summary
    return _sym_summary(user_id=int(user["sub"]))


# ── Stock Holdings ────────────────────────────────────────────────────────────

@app.get("/portfolio/holdings", response_model=List[Dict[str, Any]])
def list_holdings(user=Depends(get_current_user)) -> List[Dict[str, Any]]:
    from logic.holdings import list_holdings as _list
    return _list(user_id=int(user["sub"]))


@app.post("/portfolio/holdings", response_model=Dict[str, Any])
def create_holding(body: Dict[str, Any], user=Depends(get_current_user)) -> Dict[str, Any]:
    from logic.holdings import create_holding as _create
    try:
        return _create(user_id=int(user["sub"]), data=body)
    except (ValueError, KeyError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/portfolio/holdings/seed-from-positions", response_model=Dict[str, Any])
def seed_holdings_from_positions(user=Depends(get_current_user)) -> Dict[str, Any]:
    """Create one StockHolding per unlinked symbol using strike as cost basis,
    then link each position's holding_id back to the new (or existing) holding."""
    from logic.holdings import seed_holdings_from_positions as _seed
    return _seed(user_id=int(user["sub"]))


@app.post("/portfolio/holdings/recalculate", response_model=Dict[str, Any])
def recalculate_holdings(user=Depends(get_current_user)) -> Dict[str, Any]:
    """Repair adjusted_cost_basis for all holdings by replaying event history
    from cost_basis. Safe to call repeatedly (idempotent)."""
    from logic.holdings import recalculate_all_holdings as _recalc
    return _recalc(user_id=int(user["sub"]))


@app.post("/portfolio/holdings/sync-ledger", response_model=Dict[str, Any])
def sync_premium_ledger(user=Depends(get_current_user)) -> Dict[str, Any]:
    """Rebuild all PremiumLedger rows from existing OptionPosition data.
    Idempotent — safe to call anytime. Also re-syncs adj_basis on all holdings."""
    from logic.premium_ledger import sync_ledger_from_positions as _sync
    from logic.holdings import recalculate_all_holdings as _recalc
    sync_result = _sync(user_id=int(user["sub"]))
    recalc_result = _recalc(user_id=int(user["sub"]))
    return {"synced_rows": sync_result["upserted"], "updated_holdings": recalc_result["updated"]}


@app.get("/portfolio/premium-dashboard", response_model=Dict[str, Any])
def get_premium_dashboard(user=Depends(get_current_user)) -> Dict[str, Any]:
    """Full premium dashboard: by-symbol + by-week breakdown of all collected premium."""
    from logic.premium_ledger import get_premium_dashboard as _dash
    return _dash(user_id=int(user["sub"]))


@app.get("/portfolio/holdings/{holding_id}/premium-ledger", response_model=Dict[str, Any])
def get_holding_premium_ledger(holding_id: int, user=Depends(get_current_user)) -> Dict[str, Any]:
    """Return the full premium ledger (all option positions) for a single holding."""
    from logic.premium_ledger import get_premium_summary as _summary
    return _summary(holding_id=holding_id)


@app.patch("/portfolio/holdings/{holding_id}", response_model=Dict[str, Any])
def update_holding(holding_id: int, body: Dict[str, Any], user=Depends(get_current_user)) -> Dict[str, Any]:
    from logic.holdings import update_holding as _update
    try:
        return _update(user_id=int(user["sub"]), holding_id=holding_id, data=body)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))



@app.delete("/portfolio/holdings/{holding_id}")
def delete_holding(holding_id: int, user=Depends(get_current_user)) -> Dict[str, str]:
    from logic.holdings import delete_holding as _delete
    try:
        _delete(user_id=int(user["sub"]), holding_id=holding_id)
        return {"status": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/portfolio/holdings/{holding_id}/events", response_model=List[Dict[str, Any]])
def list_holding_events(holding_id: int, user=Depends(get_current_user)) -> List[Dict[str, Any]]:
    from logic.holdings import list_holding_events as _events
    return _events(user_id=int(user["sub"]), holding_id=holding_id)


@app.get("/cash", response_model=List[Dict[str, Any]])
def list_cash(user=Depends(get_current_user)) -> List[Dict[str, Any]]:
    _, cash, _ = services.load_data(user_id=int(user["sub"]))
    return _df_records(cash)


@app.get("/cash/balance")
def cash_balance(user=Depends(get_current_user), currency: str = "USD") -> Dict[str, Any]:
    cur = str(currency or "USD").strip().upper() or "USD"
    bal = services.get_cash_balance(user_id=int(user["sub"]), currency=cur)
    return {"currency": cur, "balance": float(bal)}


@app.post("/cash")
def create_cash(req: CashCreateRequest, user=Depends(get_current_user)) -> Dict[str, str]:
    services.save_cash(req.action, req.amount, req.date, req.notes, user_id=int(user["sub"]))
    return {"status": "ok"}


@app.get("/budget", response_model=List[Dict[str, Any]])
def list_budget(user=Depends(get_current_user)) -> List[Dict[str, Any]]:
    _, _, budget = services.load_data(user_id=int(user["sub"]))
    return _df_records(budget)


@app.post("/budget")
def create_budget(req: BudgetCreateRequest, user=Depends(get_current_user)) -> Dict[str, str]:
    services.save_budget(
        req.category, req.type, req.amount, req.date, req.description,
        user_id=int(user["sub"]),
        entry_type=req.entry_type,
        recurrence=req.recurrence,
        merchant=req.merchant,
    )
    return {"status": "ok"}


@app.patch("/budget/{budget_id}")
def patch_budget(budget_id: int, req: BudgetCreateRequest, user=Depends(get_current_user)) -> Dict[str, str]:
    services.update_budget(
        budget_id, user_id=int(user["sub"]),
        category=req.category,
        type=req.type,
        entry_type=req.entry_type,
        recurrence=req.recurrence,
        amount=req.amount,
        date=req.date,
        description=req.description,
        merchant=req.merchant,
    )
    return {"status": "ok"}


@app.delete("/budget/{budget_id}")
def remove_budget(budget_id: int, user=Depends(get_current_user)) -> Dict[str, str]:
    uid = int(user["sub"])
    services.delete_budget_overrides_for_entry(budget_id, user_id=uid)
    services.delete_budget(budget_id, user_id=uid)
    return {"status": "ok"}


# ── Budget Overrides ──────────────────────────────────────────────────────────

@app.get("/budget-overrides", response_model=List[Dict[str, Any]])
def list_overrides(user=Depends(get_current_user)):
    return services.list_budget_overrides(user_id=int(user["sub"]))


@app.post("/budget-overrides", response_model=Dict[str, Any])
def upsert_override(req: BudgetOverrideRequest, user=Depends(get_current_user)):
    oid = services.upsert_budget_override(
        user_id=int(user["sub"]),
        budget_id=req.budget_id,
        month_key=req.month_key,
        amount=req.amount,
        description=req.description,
    )
    return {"id": oid}


@app.delete("/budget-overrides/{override_id}")
def delete_override(override_id: int, user=Depends(get_current_user)) -> Dict[str, str]:
    services.delete_budget_override(override_id, user_id=int(user["sub"]))
    return {"status": "ok"}


# ── Credit Card Weeks ─────────────────────────────────────────────────────────

@app.get("/credit-card/weeks", response_model=List[Dict[str, Any]])
def list_cc_weeks(user=Depends(get_current_user)):
    return services.list_credit_card_weeks(user_id=int(user["sub"]))


@app.post("/credit-card/weeks", response_model=Dict[str, Any])
def create_cc_week(req: CreditCardWeekRequest, user=Depends(get_current_user)):
    row_id = services.create_credit_card_week(
        user_id=int(user["sub"]),
        week_start=req.week_start,
        card_name=req.card_name,
        balance=req.balance,
        squared_off=req.squared_off,
        paid_amount=req.paid_amount,
        note=req.note,
    )
    return {"id": row_id, "status": "ok"}


@app.patch("/credit-card/weeks/{row_id}", response_model=Dict[str, str])
def patch_cc_week(row_id: int, req: CreditCardWeekRequest, user=Depends(get_current_user)):
    services.update_credit_card_week(
        row_id, user_id=int(user["sub"]),
        week_start=req.week_start,
        card_name=req.card_name,
        balance=req.balance,
        squared_off=req.squared_off,
        paid_amount=req.paid_amount,
        note=req.note,
    )
    return {"status": "ok"}


@app.delete("/credit-card/weeks/{row_id}", response_model=Dict[str, str])
def delete_cc_week(row_id: int, user=Depends(get_current_user)):
    services.delete_credit_card_week(row_id, user_id=int(user["sub"]))
    return {"status": "ok"}


@app.get("/ledger/cash-balance")
def ledger_cash_balance(user=Depends(get_current_user)) -> Dict[str, Any]:
    bal = services.get_cash_balance(user_id=int(user["sub"]), currency="USD")
    return {"currency": "USD", "balance": float(bal)}


_STOCK_INFO_CACHE: dict[str, tuple[float, Any]] = {}
_STOCK_INFO_TTL = 300  # 5 minutes — fundamentals don't change quickly

@app.get("/stocks/{symbol}/info", response_model=Dict[str, Any])
def stock_info(symbol: str, _user=Depends(get_current_user)) -> Dict[str, Any]:
    """Return fundamental and descriptive info for a ticker via yfinance.
    Cached for 5 minutes. Returns gracefully if data is unavailable.
    """
    import yfinance as yf
    sym = symbol.strip().upper()
    now = time.monotonic()
    cached = _STOCK_INFO_CACHE.get(sym)
    if cached and (now - cached[0]) < _STOCK_INFO_TTL:
        return cached[1]

    def _safe_float(v: Any) -> Optional[float]:
        try:
            return float(v) if v is not None else None
        except Exception:
            return None

    def _safe_int(v: Any) -> Optional[int]:
        try:
            return int(v) if v is not None else None
        except Exception:
            return None

    try:
        ticker = yf.Ticker(sym)
        info = {}
        try:
            info = ticker.info or {}
        except Exception:
            pass

        fast = None
        try:
            fast = ticker.fast_info
        except Exception:
            pass

        def _fi(attr: str) -> Optional[float]:
            try:
                v = getattr(fast, attr, None)
                return float(v) if v is not None else None
            except Exception:
                return None

        result: Dict[str, Any] = {
            "symbol":              sym,
            "name":                info.get("longName") or info.get("shortName") or sym,
            "sector":              info.get("sector"),
            "industry":            info.get("industry"),
            "description":         info.get("longBusinessSummary"),
            "website":             info.get("website"),
            "exchange":            info.get("exchange") or info.get("exchangeName"),
            "currency":            info.get("currency", "USD"),
            "quote_type":          info.get("quoteType"),
            "country":             info.get("country"),
            "employees":           _safe_int(info.get("fullTimeEmployees")),
            # Price / market data
            "market_cap":          _safe_float(info.get("marketCap")) or _fi("market_cap"),
            "enterprise_value":    _safe_float(info.get("enterpriseValue")),
            "shares_outstanding":  _safe_float(info.get("sharesOutstanding")) or _fi("shares"),
            "float_shares":        _safe_float(info.get("floatShares")),
            "avg_volume":          _safe_float(info.get("averageVolume")) or _safe_float(info.get("averageDailyVolume10Day")),
            "avg_volume_10d":      _safe_float(info.get("averageDailyVolume10Day")),
            # 52-week range
            "week_52_high":        _safe_float(info.get("fiftyTwoWeekHigh")) or _fi("year_high"),
            "week_52_low":         _safe_float(info.get("fiftyTwoWeekLow")) or _fi("year_low"),
            "day_high":            _safe_float(info.get("dayHigh")) or _fi("day_high"),
            "day_low":             _safe_float(info.get("dayLow")) or _fi("day_low"),
            "fifty_day_avg":       _safe_float(info.get("fiftyDayAverage")) or _fi("fifty_day_average"),
            "two_hundred_day_avg": _safe_float(info.get("twoHundredDayAverage")) or _fi("two_hundred_day_average"),
            # Valuation
            "pe_ratio":            _safe_float(info.get("trailingPE")),
            "forward_pe":          _safe_float(info.get("forwardPE")),
            "pb_ratio":            _safe_float(info.get("priceToBook")),
            "ps_ratio":            _safe_float(info.get("priceToSalesTrailing12Months")),
            "peg_ratio":           _safe_float(info.get("pegRatio")),
            "ev_ebitda":           _safe_float(info.get("enterpriseToEbitda")),
            # Earnings
            "eps_ttm":             _safe_float(info.get("trailingEps")),
            "eps_forward":         _safe_float(info.get("forwardEps")),
            "revenue_ttm":         _safe_float(info.get("totalRevenue")),
            "gross_margin":        _safe_float(info.get("grossMargins")),
            "profit_margin":       _safe_float(info.get("profitMargins")),
            "operating_margin":    _safe_float(info.get("operatingMargins")),
            "return_on_equity":    _safe_float(info.get("returnOnEquity")),
            "return_on_assets":    _safe_float(info.get("returnOnAssets")),
            "debt_to_equity":      _safe_float(info.get("debtToEquity")),
            "free_cash_flow":      _safe_float(info.get("freeCashflow")),
            # Dividends
            "dividend_yield":      _safe_float(info.get("dividendYield")),
            "dividend_rate":       _safe_float(info.get("dividendRate")),
            "payout_ratio":        _safe_float(info.get("payoutRatio")),
            "ex_dividend_date":    info.get("exDividendDate"),
            # Risk
            "beta":                _safe_float(info.get("beta")),
            "short_ratio":         _safe_float(info.get("shortRatio")),
            "short_pct_float":     _safe_float(info.get("shortPercentOfFloat")),
            # Next earnings
            "earnings_date":       info.get("earningsTimestamp"),
            "error":               None,
        }
        _STOCK_INFO_CACHE[sym] = (now, result)
        return result
    except Exception as exc:
        err: Dict[str, Any] = {"symbol": sym, "error": str(exc)}
        return err


@app.get("/stocks/{symbol}/history", response_model=Dict[str, Any])
def stock_history(symbol: str, period: str = "6mo", interval: str = "1d", _user=Depends(get_current_user)) -> Dict[str, Any]:
    """Return OHLCV history + current price for a symbol via yfinance.
    `interval` supports: 1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1wk, 1mo, 3mo
    For intraday intervals (< 1d), datetime strings include time component.
    """
    import yfinance as yf

    sym = symbol.strip().upper()
    allowed_periods  = {"1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"}
    allowed_intervals = {"1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d", "5d", "1wk", "1mo", "3mo"}
    p  = period   if period   in allowed_periods   else "6mo"
    iv = interval if interval in allowed_intervals else "1d"
    intraday = iv not in {"1d", "5d", "1wk", "1mo", "3mo"}
    try:
        ticker = yf.Ticker(sym)
        hist = ticker.history(period=p, interval=iv)
        if hist is None or hist.empty:
            return {"symbol": sym, "bars": [], "current_price": None, "error": f"No data for {sym}"}
        hist = hist.reset_index()
        bars: List[Dict[str, Any]] = []
        for _, row in hist.iterrows():
            dt = row.get("Datetime") or row.get("Date")
            close = row.get("Close")
            if dt is None or close is None:
                continue
            try:
                ts = pd.to_datetime(dt)
                # Normalise to UTC
                if ts.tzinfo is None:
                    ts = ts.tz_localize("UTC")
                else:
                    ts = ts.tz_convert("UTC")
                date_str = ts.strftime("%Y-%m-%dT%H:%M:%SZ") if intraday else ts.strftime("%Y-%m-%d")
                close_f  = float(close)
            except Exception:
                continue
            bars.append({
                "date":   date_str,
                "open":   float(row["Open"])   if "Open"   in row and pd.notna(row["Open"])   else None,
                "high":   float(row["High"])   if "High"   in row and pd.notna(row["High"])   else None,
                "low":    float(row["Low"])    if "Low"    in row and pd.notna(row["Low"])    else None,
                "close":  close_f,
                "volume": int(row["Volume"])   if "Volume" in row and pd.notna(row["Volume"]) else None,
            })
        current_price = bars[-1]["close"] if bars else None
        return {"symbol": sym, "bars": bars, "current_price": current_price, "error": None}
    except Exception as exc:
        return {"symbol": sym, "bars": [], "current_price": None, "error": str(exc)}


@app.get("/options/gamma-exposure/{symbol}", response_model=Dict[str, Any])
def gamma_exposure(symbol: str, _user=Depends(get_current_user)) -> Dict[str, Any]:
    """Compute and return Gamma Exposure (GEX) for a given symbol.
    Auth-gated so only logged-in users can call it; no user-specific data returned.
    Results are cached for 15 s (yfinance refresh cadence) to avoid redundant calls.
    """
    from logic.gamma import compute_gamma_exposure

    sym = symbol.upper()
    now = time.monotonic()
    cached = _gex_cache.get(sym)
    if cached and (now - cached[0]) < _GEX_CACHE_TTL:
        result = cached[1]
        fresh = False
    else:
        result = compute_gamma_exposure(sym)
        _gex_cache[sym] = (now, result)
        fresh = True

    # Only record a net-flow snapshot when we actually fetched new data
    if fresh:
        _record_flow_snapshot(
            symbol=result.symbol,
            spot=result.spot,
            call_prem=result.call_premium,
            put_prem=result.put_premium,
            net_flow=result.net_flow,
            total_prem=result.call_premium + result.put_premium,
            volume=result.total_volume,
        )
    return {
        "symbol": result.symbol,
        "spot": result.spot,
        "expiries": result.expiries,
        "strikes": result.strikes,
        "gex_by_strike": result.gex_by_strike,
        "call_gex_by_strike": result.call_gex_by_strike,
        "put_gex_by_strike": result.put_gex_by_strike,
        "heatmap_expiries": result.heatmap_expiries,
        "heatmap_strikes": result.heatmap_strikes,
        "heatmap_values": result.heatmap_values,
        "zero_gamma": result.zero_gamma,
        "max_call_wall": result.max_call_wall,
        "max_put_wall": result.max_put_wall,
        "max_gex_strike": result.max_gex_strike,
        "net_gex": result.net_gex,
        "call_premium": result.call_premium,
        "put_premium": result.put_premium,
        "net_flow": result.net_flow,
        "total_volume": result.total_volume,
        "flow_by_expiry": result.flow_by_expiry,
        "top_flow_strikes": result.top_flow_strikes,
        "data_source": getattr(result, "data_source", "yfinance"),
        "error": result.error,
    }


@app.get("/ledger/entries", response_model=List[Dict[str, Any]])
def ledger_entries(user=Depends(get_current_user), limit: int = 100) -> List[Dict[str, Any]]:
    rows = services.list_ledger_entries(user_id=int(user["sub"]), limit=int(limit))
    # normalize datetimes for JSON
    cleaned: List[Dict[str, Any]] = []
    for r in rows:
        rec: Dict[str, Any] = dict(r)
        for k in ("created_at", "effective_at"):
            v = rec.get(k)
            if isinstance(v, (pd.Timestamp, datetime)):
                rec[k] = pd.to_datetime(v).to_pydatetime().isoformat()
        cleaned.append(rec)
    return cleaned


# ── Admin endpoints ───────────────────────────────────────────────────────────

@app.get("/admin/users", response_model=List[AdminUserOut])
def admin_list_users(_admin=Depends(require_admin)) -> List[AdminUserOut]:
    users = services.list_all_users()
    return [
        AdminUserOut(
            user_id=int(u.id),
            username=str(u.username or ""),
            role=str(getattr(u, "role", None) or "user"),
            is_active=bool(getattr(u, "is_active", True)),
            created_at=getattr(u, "created_at", None),
        )
        for u in users
    ]


@app.post("/admin/users", response_model=AdminUserOut, status_code=201)
def admin_create_user(req: AdminCreateUserRequest, _admin=Depends(require_admin)) -> AdminUserOut:
    try:
        user_id = services.create_user(req.username, req.password, role=req.role)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    u = services.get_user(int(user_id))
    return AdminUserOut(
        user_id=int(user_id),
        username=str(req.username).strip().lower(),
        role=req.role,
        is_active=True,
        created_at=getattr(u, "created_at", None),
    )


@app.delete("/admin/users/{user_id}", status_code=204)
def admin_delete_user(user_id: int, admin=Depends(require_admin)) -> None:
    if int(admin["sub"]) == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    try:
        services.delete_user_admin(user_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/admin/users/{user_id}", status_code=204)
def admin_delete_user(user_id: int, admin=Depends(require_admin)) -> None:
    if int(admin["sub"]) == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    try:
        services.delete_user_admin(user_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.patch("/admin/users/{user_id}", response_model=AdminUserOut)
def admin_patch_user(user_id: int, req: AdminPatchUserRequest, admin=Depends(require_admin)) -> AdminUserOut:
    # Prevent admin from demoting themselves
    if int(admin["sub"]) == user_id and req.role == "user":
        raise HTTPException(status_code=400, detail="Cannot remove your own admin role")
    try:
        services.patch_user_admin(user_id, role=req.role, is_active=req.is_active)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    u = services.get_user(user_id)
    if u is None:
        raise HTTPException(status_code=404, detail="User not found")
    return AdminUserOut(
        user_id=int(u.id),
        username=str(u.username or ""),
        role=str(getattr(u, "role", None) or "user"),
        is_active=bool(getattr(u, "is_active", True)),
        created_at=getattr(u, "created_at", None),
    )
