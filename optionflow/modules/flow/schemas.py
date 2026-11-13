"""optionflow/modules/flow/schemas.py — GEX board and net-flow history."""
from __future__ import annotations

from typing import Literal, List, Optional

from pydantic import BaseModel, Field


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


class TradeIdea(BaseModel):
    """One contract suggested from the dealer levels (flow.ideas)."""
    action: Literal["BUY_CALL", "SELL_CALL", "BUY_PUT", "SELL_PUT"]
    otype: Literal["call", "put"]
    strike: float
    expiry: str
    dte: int
    premium: float = Field(..., description="Mid, per share")
    delta: float = Field(..., description="Of one long option")
    breakeven: float
    target: Optional[float] = Field(None, description="Buys: the level the idea aims at")
    fit: Literal["favored", "neutral", "against"] = Field(..., description="How it sits with the gamma regime")
    reason: str


class Outlook(BaseModel):
    """A read of the dealer map (flow.ideas.outlook): not a forecast."""
    direction: Literal["up", "down", "sideways"]
    up: int = Field(..., description="Share of 100; up + down + sideways = 100")
    down: int
    sideways: int
    reasons: List[str] = []
    battleground: Optional[float] = Field(None, description="Strike near the price where call and put gamma are both large")
    expected_low: Optional[float] = Field(None, description="Price − 1σ to the expiry nearest 30 days (ATM IV)")
    expected_high: Optional[float] = None
    expected_dte: Optional[int] = None
    atm_iv: Optional[float] = None


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
    heatmap_vex_values: List[List[float]] = []   # same grid, $ VEX (dealer delta change) per 1 vol-point
    zero_gamma: Optional[float] = None
    max_call_wall: Optional[float] = None
    max_put_wall: Optional[float] = None
    max_gex_strike: Optional[float] = None
    net_gex: float = 0.0
    net_vex: float = 0.0
    call_premium: float = 0.0
    put_premium: float = 0.0
    net_flow: float = 0.0
    total_volume: int = 0
    flow_by_expiry: List[FlowByExpiry] = []
    top_flow_strikes: List[TopFlowStrike] = []
    ideas: List[TradeIdea] = []
    outlook: Optional[Outlook] = None
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
    call_traded: Optional[float] = Field(None, description="Call premium traded today so far (Δvolume × mid per "
                                         "contract, nearest 12 expiries); None outside the session and on rows "
                                         "before 2026-11-13")
    put_traded: Optional[float] = Field(None, description="Put premium traded today so far (as call_traded)")
    net_traded: Optional[float] = Field(None, description="call_traded − put_traded")
    call_bought: Optional[float] = Field(None, description="Part of call_traded filled at or near the ask (buyer "
                                         "started it). Mid fills and volume from before the first refresh have no "
                                         "side, so bought + sold ≤ traded. None on rows before 2026-11-13 11:00 ET")
    call_sold: Optional[float] = Field(None, description="Part of call_traded filled at or near the bid")
    put_bought: Optional[float] = Field(None, description="Part of put_traded filled at or near the ask")
    put_sold: Optional[float] = Field(None, description="Part of put_traded filled at or near the bid")
    ncp: Optional[float] = Field(None, description="Net call premium: call_bought − call_sold")
    npp: Optional[float] = Field(None, description="Net put premium: put_bought − put_sold")


class StrikeFlowRow(BaseModel):
    strike: float
    call_bought: float = 0.0
    call_sold: float = 0.0
    put_bought: float = 0.0
    put_sold: float = 0.0
    call_delta: float = Field(0.0, description="Customer delta $ from calls: bought − sold (Δvolume × delta × 100 × spot)")
    put_delta: float = Field(0.0, description="Customer delta $ from puts (puts bought add negative delta)")
    net_delta: float = 0.0


class StrikeFlowOut(BaseModel):
    symbol: str
    day: Optional[str] = Field(None, description="US-Eastern session date the totals are for")
    live: bool = Field(False, description="True while today's session is being tracked; False = latest saved day")
    expiry: Optional[str] = None
    expiries: List[str] = []
    spot: Optional[float] = None
    zero_gamma: Optional[float] = None
    call_wall: Optional[float] = None
    put_wall: Optional[float] = None
    king: Optional[float] = None
    rows: List[StrikeFlowRow] = []
    call_bought: float = 0.0
    call_sold: float = 0.0
    put_bought: float = 0.0
    put_sold: float = 0.0
    call_delta: float = 0.0
    put_delta: float = 0.0
    net_delta: float = Field(0.0, description="Customer delta $ added today; > 0 = dealers hedge by buying shares")


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


class FlowLeader(BaseModel):
    symbol: str
    net: float = Field(..., description="Call − put premium traded today (Δvolume × mid per contract at each refresh, not prints)")
    call_prem: float
    put_prem: float
    spot: Optional[float] = None
    change_pct: Optional[float] = Field(None, description="Day change %, from real-time quotes when available")


class FlowLeadersOut(BaseModel):
    session: Optional[str] = Field(None, description="US-Eastern session date (YYYY-MM-DD) the totals are for")
    as_of: Optional[str] = Field(None, description="Latest snapshot used (UTC)")
    universe: str
    symbols: int = Field(..., description="Symbols with snapshots in the session")
    bullish: List[FlowLeader]
    bearish: List[FlowLeader]


class TidePoint(BaseModel):
    ts: str = Field(..., description="Bucket start (UTC)")
    net: float
    call_prem: float
    put_prem: float
    spy: Optional[float] = None
    symbols: int = Field(..., description="Symbols contributing at this point")
