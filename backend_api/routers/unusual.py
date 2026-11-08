"""backend_api/routers/unusual.py — unusual options activity scanner (HTTP only)."""
from __future__ import annotations

from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, Depends, Query
from fastapi.concurrency import run_in_threadpool

from ..deps import get_current_user
from logic.unusual import scan

router = APIRouter(prefix="/unusual", tags=["unusual"])


@router.get("")
async def unusual(
    symbols: Optional[str] = Query(None, description="Comma-separated tickers; default universe if empty"),
    min_premium: float = Query(100_000, ge=10_000, le=50_000_000),
    type: Literal["all", "call", "put"] = "all",
    _user=Depends(get_current_user),
) -> Dict[str, Any]:
    syms = [s for s in (symbols or "").split(",") if s.strip()] or None
    return await run_in_threadpool(lambda: scan(syms, min_premium=min_premium, kind=type))
