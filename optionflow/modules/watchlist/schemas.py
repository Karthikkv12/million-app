"""optionflow/modules/watchlist/schemas.py"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class WatchlistUpsertRequest(BaseModel):
    symbol: str
    company_name: Optional[str] = None
    notes: Optional[str] = None


class WatchlistItemOut(BaseModel):
    id: int
    symbol: str
    company_name: Optional[str] = None
    source: str
    notes: Optional[str] = None
    is_active: bool
    added_at: Optional[str] = None      # ISO 8601
    updated_at: Optional[str] = None


class WatchlistSyncOut(BaseModel):
    positions_synced: int
    holdings_synced: int
    total_added: int
