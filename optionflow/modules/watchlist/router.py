"""optionflow/modules/watchlist/router.py — the user's watchlist (HTTP only)."""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends

from optionflow.core.deps import get_current_user
from optionflow.modules.watchlist import service
from optionflow.modules.watchlist.schemas import WatchlistItemOut, WatchlistSyncOut, WatchlistUpsertRequest

router = APIRouter(prefix="/watchlist", tags=["watchlist"])


@router.get("", response_model=List[WatchlistItemOut])
def get_watchlist(user=Depends(get_current_user)) -> List[WatchlistItemOut]:
    return service.list_watchlist(user_id=int(user["sub"]))


@router.put("/{symbol}", response_model=WatchlistItemOut)
def add_or_update(symbol: str, body: WatchlistUpsertRequest, user=Depends(get_current_user)) -> WatchlistItemOut:
    """Add a symbol (or reactivate a removed one). Source is always 'manual'."""
    return service.upsert_symbol(user_id=int(user["sub"]), symbol=symbol.upper().strip(),
                                 company_name=body.company_name, notes=body.notes, source="manual")


@router.delete("/{symbol}", status_code=204)
def remove(symbol: str, user=Depends(get_current_user)) -> None:
    """Soft-delete (history is kept)."""
    service.remove_symbol(user_id=int(user["sub"]), symbol=symbol.upper().strip())


@router.post("/sync", response_model=WatchlistSyncOut)
def sync(user=Depends(get_current_user)) -> WatchlistSyncOut:
    """Register symbols from existing positions and holdings. Idempotent."""
    return service.sync_all(user_id=int(user["sub"]))
