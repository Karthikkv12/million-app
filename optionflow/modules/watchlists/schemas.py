"""optionflow/modules/watchlists/schemas.py — request/response models."""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field

NAME = Field(..., min_length=1, max_length=40)


class WatchlistGroupOut(BaseModel):
    id: int
    name: str
    kind: Literal["custom", "sector"] = Field(..., description='"sector" = seeded one per sector; "custom" = made by the user')
    sector: Optional[str] = Field(None, description="Sector name (Yahoo naming) for kind='sector'")
    position: int
    symbols: List[str]
    created_at: str
    updated_at: str


class WatchlistGroupsOut(BaseModel):
    lists: List[WatchlistGroupOut]
    max_lists: int
    max_symbols: int


class WatchlistCreateIn(BaseModel):
    name: str = NAME
    symbols: List[str] = Field(default_factory=list, max_length=100)


class WatchlistUpdateIn(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=40)
    symbols: Optional[List[str]] = Field(None, max_length=100, description="Replaces the list (and its order)")


class WatchlistOrderIn(BaseModel):
    ids: List[int] = Field(..., max_length=20, description="List ids in the new display order")
