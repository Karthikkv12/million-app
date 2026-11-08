"""backend_api/routers/catalyst.py — catalysts for one stock (HTTP only)."""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool

from ..deps import get_current_user
from logic.catalyst import get_catalysts

router = APIRouter(prefix="/catalyst", tags=["catalyst"])


@router.get("/{symbol}")
async def catalyst(symbol: str, _user=Depends(get_current_user)) -> Dict[str, Any]:
    try:
        return await run_in_threadpool(get_catalysts, symbol)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid symbol")
    except LookupError:
        raise HTTPException(status_code=404, detail=f"No data found for {symbol.upper()}")
