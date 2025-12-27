from __future__ import annotations

import json
import os
import socket
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

import pandas as pd

@dataclass(frozen=True)
class APIError(RuntimeError):
    status_code: int
    detail: str
    body: str = ""


def _request_json(
    method: str,
    path: str,
    *,
    token: Optional[str] = None,
    json_body: Optional[Dict[str, Any]] = None,
    timeout: float = 30.0,
) -> Any:
    url = f"{_base_url()}{path}"
    data = None
    headers: Dict[str, str] = {"Accept": "application/json"}
    headers.update(_headers(token))

    if json_body is not None:
        data = json.dumps(json_body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=data, method=method.upper(), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            if not raw:
                return None
            try:
                return json.loads(raw)
            except Exception:
                return raw
    except urllib.error.HTTPError as e:
        raw = ""
        try:
            raw = e.read().decode("utf-8")
        except Exception:
            raw = ""

        detail = raw
        try:
            parsed = json.loads(raw) if raw else {}
            if isinstance(parsed, dict) and "detail" in parsed:
                detail = str(parsed.get("detail"))
        except Exception:
            pass

        raise APIError(status_code=int(getattr(e, "code", 0) or 0), detail=str(detail or e), body=raw) from e
    except (urllib.error.URLError, socket.timeout) as e:
        raise APIError(
            status_code=0,
            detail=f"Cannot reach API at {url}. Is the backend running and API_BASE_URL correct?",
            body=str(e),
        ) from e


def _base_url() -> str:
    # Prefer Streamlit secrets when running in Streamlit Cloud.
    try:
        import streamlit as st  # type: ignore

        if hasattr(st, "secrets") and "API_BASE_URL" in st.secrets:
            return str(st.secrets["API_BASE_URL"]).rstrip("/")
    except Exception:
        pass

    return os.getenv("API_BASE_URL", "http://localhost:8000").rstrip("/")


def _headers(token: Optional[str]) -> Dict[str, str]:
    if not token:
        return {}
    return {"Authorization": f"Bearer {token}"}


def api_health() -> bool:
    try:
        _request_json("GET", "/health", timeout=5)
        return True
    except Exception:
        return False


def signup(username: str, password: str) -> Dict[str, Any]:
    resp = _request_json(
        "POST",
        "/auth/signup",
        json_body={"username": username, "password": password},
        timeout=15,
    )
    return dict(resp or {})


def login(username: str, password: str) -> Dict[str, Any]:
    resp = _request_json(
        "POST",
        "/auth/login",
        json_body={"username": username, "password": password},
        timeout=15,
    )
    return dict(resp or {})


def load_data(token: str) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    trades_df = pd.DataFrame(_request_json("GET", "/trades", token=token, timeout=30) or [])
    cash_df = pd.DataFrame(_request_json("GET", "/cash", token=token, timeout=30) or [])
    budget_df = pd.DataFrame(_request_json("GET", "/budget", token=token, timeout=30) or [])

    if not trades_df.empty and "entry_date" in trades_df.columns:
        trades_df["entry_date"] = pd.to_datetime(trades_df["entry_date"], errors="coerce")
    if not cash_df.empty and "date" in cash_df.columns:
        cash_df["date"] = pd.to_datetime(cash_df["date"], errors="coerce")
    if not budget_df.empty and "date" in budget_df.columns:
        budget_df["date"] = pd.to_datetime(budget_df["date"], errors="coerce")

    return trades_df, cash_df, budget_df


def save_trade(
    token: str,
    symbol: str,
    instrument: str,
    strategy: str,
    action: str,
    qty: int,
    price: float,
    date,
) -> None:
    _request_json(
        "POST",
        "/trades",
        token=token,
        json_body={
            "symbol": symbol,
            "instrument": instrument,
            "strategy": strategy,
            "action": action,
            "qty": int(qty),
            "price": float(price),
            "date": pd.to_datetime(date).to_pydatetime().isoformat(),
        },
        timeout=30,
    )


def update_trade(
    token: str,
    trade_id: int,
    symbol: str,
    strategy: str,
    action: str,
    qty: int,
    price: float,
    date,
) -> bool:
    try:
        _request_json(
            "PUT",
            f"/trades/{int(trade_id)}",
            token=token,
            json_body={
                "symbol": symbol,
                "strategy": strategy,
                "action": action,
                "qty": int(qty),
                "price": float(price),
                "date": pd.to_datetime(date).to_pydatetime().isoformat(),
            },
            timeout=30,
        )
        return True
    except APIError as e:
        if e.status_code == 404:
            return False
        raise


def delete_trade(token: str, trade_id: int) -> bool:
    try:
        _request_json("DELETE", f"/trades/{int(trade_id)}", token=token, timeout=30)
        return True
    except APIError as e:
        if e.status_code == 404:
            return False
        raise


def save_budget(token: str, category: str, b_type: str, amount: float, date, desc: str) -> None:
    _request_json(
        "POST",
        "/budget",
        token=token,
        json_body={
            "category": category,
            "type": b_type,
            "amount": float(amount),
            "date": pd.to_datetime(date).to_pydatetime().isoformat(),
            "description": desc,
        },
        timeout=30,
    )


def save_cash(token: str, action: str, amount: float, date, notes: str) -> None:
    _request_json(
        "POST",
        "/cash",
        token=token,
        json_body={
            "action": action,
            "amount": float(amount),
            "date": pd.to_datetime(date).to_pydatetime().isoformat(),
            "notes": notes,
        },
        timeout=30,
    )
