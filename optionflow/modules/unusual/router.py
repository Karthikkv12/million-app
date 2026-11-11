"""optionflow/modules/unusual/router.py — GET /unusual (HTTP only)."""
from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query

from optionflow.core.deps import get_current_user
from optionflow.modules.unusual.schemas import UnusualScanOut
from optionflow.modules.unusual.service import scan

router = APIRouter(prefix="/unusual", tags=["unusual"])


@router.get("", response_model=UnusualScanOut)
def unusual(
    symbols: Optional[str] = Query(None, description="Comma-separated tickers; default universe if empty"),
    min_premium: float = Query(100_000, ge=10_000, le=50_000_000),
    type: Literal["all", "call", "put"] = "all",
    _user=Depends(get_current_user),
) -> UnusualScanOut:
    """Contracts trading far above open interest with large premium (delayed chain snapshots)."""
    syms = [s for s in (symbols or "").split(",") if s.strip()] or None
    return scan(syms, min_premium=min_premium, kind=type)
