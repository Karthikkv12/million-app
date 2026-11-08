"""backend_api/routers/gex_history.py — GEX replay snapshots (HTTP only)."""
from __future__ import annotations

from datetime import date
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool

from ..deps import get_current_user
from logic import gex_history

router = APIRouter(prefix="/gex-history", tags=["gex-history"])


@router.get("/{symbol}")
async def gex_day(symbol: str, on: Optional[str] = Query(None, description="YYYY-MM-DD (UTC); latest day if omitted"),
                  _user=Depends(get_current_user)) -> Dict[str, Any]:
    try:
        d = date.fromisoformat(on) if on else None
    except ValueError:
        raise HTTPException(status_code=400, detail="Use YYYY-MM-DD for 'on'")
    return await run_in_threadpool(gex_history.day, symbol, d)
