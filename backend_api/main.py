from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List

import pandas as pd
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from database.models import init_db
from logic import services

from .schemas import (
    AuthLoginRequest,
    AuthResponse,
    AuthSignupRequest,
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


app = FastAPI(title="Million API", version="1.0.0")

# Allow local frontend development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"] ,
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
        return payload
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/auth/signup", response_model=AuthResponse)
def signup(req: AuthSignupRequest) -> AuthResponse:
    try:
        user_id = services.create_user(req.username, req.password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    token = create_access_token(subject=str(user_id), extra={"username": req.username})
    return AuthResponse(access_token=token, user_id=int(user_id), username=req.username)


@app.post("/auth/login", response_model=AuthResponse)
def login(req: AuthLoginRequest) -> AuthResponse:
    user_id = services.authenticate_user(req.username, req.password)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = create_access_token(subject=str(user_id), extra={"username": req.username})
    return AuthResponse(access_token=token, user_id=int(user_id), username=req.username)


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
