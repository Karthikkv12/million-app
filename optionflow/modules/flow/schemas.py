"""optionflow/modules/flow/schemas.py — GEX board and net-flow history."""
from __future__ import annotations

from typing import Literal, List, Optional

from pydantic import BaseModel


class FlowByExpiry(BaseModel):
    expiry: str
    call_prem: float
    put_prem: float
    net: float


class TopFlowStrike(BaseModel):
    strike: float
    call_prem: float
    put_prem: float
    net: float
    bias: Literal["call", "put"]


class GexOut(BaseModel):
    symbol: str
    spot: float
    expiries: List[str] = []
    strikes: List[float] = []
    gex_by_strike: List[float] = []
    call_gex_by_strike: List[float] = []
    put_gex_by_strike: List[float] = []
    heatmap_expiries: List[str] = []
    heatmap_strikes: List[float] = []
    heatmap_values: List[List[float]] = []   # [expiry][strike], $ GEX per 1% move
    zero_gamma: Optional[float] = None
    max_call_wall: Optional[float] = None
    max_put_wall: Optional[float] = None
    max_gex_strike: Optional[float] = None
    net_gex: float = 0.0
    call_premium: float = 0.0
    put_premium: float = 0.0
    net_flow: float = 0.0
    total_volume: int = 0
    flow_by_expiry: List[FlowByExpiry] = []
    top_flow_strikes: List[TopFlowStrike] = []
    data_source: str
    error: Optional[str] = None
    as_of: Optional[str] = None      # ISO UTC time the numbers were computed
    stale: bool = False              # True: data source is rate-limiting; showing the last good result


class NetFlowPoint(BaseModel):
    ts: str
    price: Optional[float] = None
    call_prem: Optional[float] = None
    put_prem: Optional[float] = None
    net_flow: Optional[float] = None
    total_prem: Optional[float] = None
    volume: Optional[int] = None


class WatchRequest(BaseModel):
    symbols: List[str] = []


class GexReplaySnapshot(BaseModel):
    ts: str
    spot: float
    net_gex: Optional[float] = None
    zero_gamma: Optional[float] = None
    call_wall: Optional[float] = None
    put_wall: Optional[float] = None
    king: Optional[float] = None
    profile: List[List[float]] = []      # [[strike, net_gex], …] near spot


class GexDayOut(BaseModel):
    symbol: str
    date: Optional[str] = None
    snapshots: List[GexReplaySnapshot] = []
    days: List[str] = []                 # latest 10 days with data, newest first
