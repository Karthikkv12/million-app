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
    columns: Optional[List[str]] = Field(None, description="Column ids the user picked for this list, in order; null = the default set")
    created_at: str
    updated_at: str


class WatchlistGroupsOut(BaseModel):
    lists: List[WatchlistGroupOut]
    max_lists: int
    max_symbols: int


class ExtendedHoursOut(BaseModel):
    symbols: List[str] = Field(..., description="Stocks and ETFs whose options trade 7:30–9:25 a.m. and 4:00–4:15 p.m. ET on Cboe")
    as_of: str = Field(..., description="When the list was read from Cboe (or the launch date for the built-in list)")
    live: bool = Field(..., description="True = read from Cboe's reference file; False = the built-in launch list")


class WatchlistCreateIn(BaseModel):
    name: str = NAME
    symbols: List[str] = Field(default_factory=list, max_length=100)


class WatchlistUpdateIn(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=40)
    symbols: Optional[List[str]] = Field(None, max_length=100, description="Replaces the list (and its order)")
    columns: Optional[List[str]] = Field(None, max_length=40, description="Replaces the column set (and its order); [] = reset to default")


class WatchlistOrderIn(BaseModel):
    ids: List[int] = Field(..., max_length=20, description="List ids in the new display order")


class OptionMetricsOut(BaseModel):
    symbol: str
    spot: Optional[float] = None
    atm_iv: Optional[float] = Field(None, description="ATM implied vol of the weekly expiry, fraction (0.42 = 42%)")
    iv_change_day: Optional[float] = Field(None, description="ATM IV now vs the first reading today, fraction")
    hv20: Optional[float] = Field(None, description="20-day historical vol, annualised fraction")
    iv_hv: Optional[float] = Field(None, description="atm_iv / hv20")
    expiry: Optional[str] = Field(None, description="The weekly expiry used")
    dte: Optional[float] = None
    expected_move: Optional[float] = Field(None, description="± $ to that expiry: spot × IV × √(dte/365)")
    expected_move_pct: Optional[float] = None
    atm_call_delta: Optional[float] = None
    atm_put_delta: Optional[float] = None
    error: Optional[str] = None
