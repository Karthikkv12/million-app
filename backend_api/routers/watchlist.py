"""backend_api/routers/watchlist.py — Watchlist management routes."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from logic.watchlist import (
    list_watchlist,
    upsert_symbol,
    remove_symbol,
    sync_from_positions,
    sync_from_holdings,
)
from ..deps import get_current_user

router = APIRouter(prefix="/watchlist", tags=["watchlist"])


# ── Request schemas ───────────────────────────────────────────────────────────

class WatchlistUpsertRequest(BaseModel):
    symbol:       str
    company_name: Optional[str] = None
    notes:        Optional[str] = None


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("", response_model=List[Dict[str, Any]])
def get_watchlist(user=Depends(get_current_user)) -> List[Dict[str, Any]]:
    """Return all active watchlist symbols for the current user."""
    return list_watchlist(user_id=int(user["sub"]))


@router.put("/{symbol}", response_model=Dict[str, Any])
def add_or_update_symbol(
    symbol: str,
    body: WatchlistUpsertRequest,
    user=Depends(get_current_user),
) -> Dict[str, Any]:
    """
    Add a symbol to the watchlist (or reactivate a removed one).
    Source is always 'manual' for user-initiated adds.
    """
    sym = symbol.upper().strip()
    return upsert_symbol(
        user_id=int(user["sub"]),
        symbol=sym,
        company_name=body.company_name,
        notes=body.notes,
        source="manual",
    )


@router.delete("/{symbol}", status_code=204)
def delete_symbol(symbol: str, user=Depends(get_current_user)) -> None:
    """Soft-delete a symbol from the watchlist (preserves history)."""
    remove_symbol(user_id=int(user["sub"]), symbol=symbol.upper().strip())


@router.post("/sync", response_model=Dict[str, Any])
def sync_watchlist(user=Depends(get_current_user)) -> Dict[str, Any]:
    """
    Scan all existing positions and holdings and register any symbols that
    aren't in the watchlist yet.  Safe to call repeatedly (idempotent).
    Returns counts of newly added symbols.
    """
    uid = int(user["sub"])
    positions_added = sync_from_positions(user_id=uid)
    holdings_added  = sync_from_holdings(user_id=uid)
    return {
        "positions_synced": positions_added,
        "holdings_synced":  holdings_added,
        "total_added":      positions_added + holdings_added,
    }
