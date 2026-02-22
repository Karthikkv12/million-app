from __future__ import annotations

import os
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone

import pandas as pd
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
    CashCreateRequest,
    CashOut,
    TradeCloseRequest,
    TradeCreateRequest,
    TradeOut,
    TradeUpdateRequest,
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


@app.on_event("startup")
def _startup() -> None:
    init_db()


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
        # Optional but recommended: check revocation list.
        jti = str(payload.get("jti") or "").strip()
        if jti and services.is_token_revoked(jti=jti):
            raise HTTPException(status_code=401, detail="Token has been revoked")

        # Invalidate tokens issued before the user's cutoff (logout-everywhere / password change).
        token_iat = int(payload.get("iat") or 0)
        if not services.is_token_time_valid(user_id=int(payload["sub"]), token_iat=token_iat):
            raise HTTPException(status_code=401, detail="Token is no longer valid. Please sign in again.")
        return payload
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/auth/signup", response_model=AuthResponse)
def signup(req: AuthSignupRequest, request: Request) -> AuthResponse:
    try:
        username = str(req.username).strip().lower()
        user_id = services.create_user(username, req.password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    token = create_access_token(subject=str(user_id), extra={"username": username})
    ip = getattr(getattr(request, "client", None), "host", None)
    ua = request.headers.get("user-agent")
    refresh_token = services.create_refresh_token(user_id=int(user_id), ip=str(ip) if ip else None, user_agent=ua)
    return AuthResponse(access_token=token, refresh_token=refresh_token, user_id=int(user_id), username=username)


@app.post("/auth/login", response_model=AuthResponse)
def login(req: AuthLoginRequest, request: Request) -> AuthResponse:
    username = str(req.username).strip().lower()
    ip = getattr(getattr(request, "client", None), "host", None)
    ua = request.headers.get("user-agent")

    # Throttle repeated failed logins per (username, ip).
    try:
        if services.is_login_rate_limited(username=username, ip=str(ip) if ip else None):
            services.log_auth_event(event_type="login_throttled", success=False, username=username, ip=str(ip) if ip else None, user_agent=ua)
            raise HTTPException(status_code=429, detail="Too many login attempts. Please try again later.")
    except HTTPException:
        raise
    except Exception:
        # Best-effort; never block login if limiter fails.
        pass

    user_id = services.authenticate_user(username, req.password)
    if not user_id:
        services.log_auth_event(
            event_type="login",
            success=False,
            username=username,
            ip=str(ip) if ip else None,
            user_agent=ua,
            detail="invalid credentials",
        )
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = create_access_token(subject=str(user_id), extra={"username": username})
    refresh_token = services.create_refresh_token(user_id=int(user_id), ip=str(ip) if ip else None, user_agent=ua)
    services.log_auth_event(event_type="login", success=True, username=username, user_id=int(user_id), ip=str(ip) if ip else None, user_agent=ua)
    return AuthResponse(access_token=token, refresh_token=refresh_token, user_id=int(user_id), username=username)


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
    token = create_access_token(subject=str(user_id), extra={"username": username})
    services.log_auth_event(event_type="refresh", success=True, username=username, user_id=int(user_id), ip=str(ip) if ip else None, user_agent=ua)
    return AuthResponse(
        access_token=token,
        refresh_token=new_refresh_token,
        user_id=int(user_id),
        username=username,
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
    # Prefer DB value if present.
    u = services.get_user(user_id)
    if u is not None:
        username = str(getattr(u, "username", username) or username)
    return AuthMeResponse(user_id=user_id, username=username)


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
    services.save_budget(req.category, req.type, req.amount, req.date, req.description, user_id=int(user["sub"]))
    return {"status": "ok"}


@app.get("/ledger/cash-balance")
def ledger_cash_balance(user=Depends(get_current_user)) -> Dict[str, Any]:
    bal = services.get_cash_balance(user_id=int(user["sub"]), currency="USD")
    return {"currency": "USD", "balance": float(bal)}


@app.get("/stocks/{symbol}/history", response_model=Dict[str, Any])
def stock_history(symbol: str, period: str = "6mo", _user=Depends(get_current_user)) -> Dict[str, Any]:
    """Return OHLCV history + current price for a symbol via yfinance."""
    import yfinance as yf

    sym = symbol.strip().upper()
    allowed_periods = {"1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"}
    p = period if period in allowed_periods else "6mo"
    try:
        ticker = yf.Ticker(sym)
        hist = ticker.history(period=p)
        if hist is None or hist.empty:
            return {"symbol": sym, "bars": [], "current_price": None, "error": f"No data for {sym}"}
        hist = hist.reset_index()
        bars: List[Dict[str, Any]] = []
        for _, row in hist.iterrows():
            dt = row.get("Date") or row.get("Datetime")
            close = row.get("Close")
            if dt is None or close is None:
                continue
            try:
                date_str = pd.to_datetime(dt).strftime("%Y-%m-%d")
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
    """
    from logic.gamma import compute_gamma_exposure

    result = compute_gamma_exposure(symbol.upper())
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
