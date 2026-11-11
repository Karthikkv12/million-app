"""optionflow/modules/insight/schemas.py — response models."""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class SwingPoint(BaseModel):
    date: str
    close: float
    drawdown: float = Field(..., description="Close vs the highest close so far in the range (≤ 0, decimal)")
    spike: float = Field(..., description="Close vs the lowest close of the last `lookback` sessions (≥ 0, decimal)")


class SwingStats(BaseModel):
    current_drawdown: float
    max_drawdown: float
    max_drawdown_date: str
    avg_drawdown: float
    peak_date: str
    sessions_since_peak: int
    near_high_share: float = Field(..., description="Share of sessions within 5% of the high")
    current_spike: float
    max_spike: float
    max_spike_date: str
    spike_percentile: float = Field(..., description="Share of sessions whose spike was at or below today's")
    sessions: int
    first_date: str
    last_date: str


class SwingsOut(BaseModel):
    symbol: str
    period: str
    lookback: int = Field(..., description="Sessions in the rolling low the spike is measured from")
    points: List[SwingPoint] = []
    stats: Optional[SwingStats] = None
    source: Optional[str] = None
    error: Optional[str] = None


class ScoreFactor(BaseModel):
    key: str
    label: str
    score: int = Field(..., ge=0, le=100)
    weight: int
    value: str
    note: str


class ScoreTraits(BaseModel):
    trend: Literal["up", "down", "sideways"]
    state: str = Field(..., description="at the high | small dip | pulled back | deep drawdown")
    volatility: Optional[str] = Field(None, description="calm | normal | volatile | super volatile")
    volume: Optional[str] = Field(None, description="low | normal | high, vs its own 90 days")
    off_high: float
    rsi: Optional[float] = None
    daily_move: Optional[float] = Field(None, description="Typical one-day move (1σ, decimal)")
    monthly_move: Optional[float] = None
    sessions: int


class ScoreEntry(BaseModel):
    """The stock price at which to buy the long call (score.entry_plan)."""
    price: float
    when: Literal["now", "pullback", "reclaim"] = Field(..., description="now | wait for a dip to price | wait for a close back above price")
    distance: float = Field(..., description="price vs the last close (decimal; 0 for now)")
    note: str


class LeapsScoreOut(BaseModel):
    symbol: str
    score: Optional[int] = Field(None, description="0 (bad) to 100 (extremely good); None without enough history")
    band: Optional[str] = Field(None, description="Avoid | Weak | Fair | Good | Excellent")
    summary: str = ""
    factors: List[ScoreFactor] = []
    traits: Optional[ScoreTraits] = None
    entry: Optional[ScoreEntry] = None
    as_of: Optional[str] = None
    error: Optional[str] = None
