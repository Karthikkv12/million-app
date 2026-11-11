"""optionflow/modules/catalyst/schemas.py — the catalysts response.

Mirrors the dict built by ``service._fetch``. Every value that comes from Yahoo is
Optional: one missing source must degrade a section, never 500 the page.
"""
from __future__ import annotations

from typing import List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field


class CatalystSignal(BaseModel):
    label: str
    tone: Literal["good", "bad", "warn", "neutral"]


class EarningsOut(BaseModel):
    date: Optional[str] = None
    days_until: Optional[int] = None
    timing: Optional[str] = None            # before open | after close | during market
    eps_avg: Optional[float] = None
    eps_low: Optional[float] = None
    eps_high: Optional[float] = None
    revenue_avg: Optional[float] = None
    revenue_low: Optional[float] = None
    revenue_high: Optional[float] = None


class DividendOut(BaseModel):
    ex_date: Optional[str] = None
    ex_days_until: Optional[int] = None
    pay_date: Optional[str] = None
    rate: Optional[float] = None
    yield_pct: Optional[float] = None       # computed: rate / price


class ExpectedMoveOut(BaseModel):
    """ATM straddle on the first expiry covering earnings (else the nearest)."""
    dollars: float
    pct: float
    low: float
    high: float
    expiry: str
    strike: float
    covers_earnings: bool


class EarningsHistoryRow(BaseModel):
    date: str
    estimate: Optional[float] = None
    reported: float
    surprise_pct: Optional[float] = None


class AnalystConsensus(BaseModel):
    strongBuy: int = 0
    buy: int = 0
    hold: int = 0
    sell: int = 0
    strongSell: int = 0


class AnalystTargets(BaseModel):
    low: Optional[float] = None
    mean: Optional[float] = None
    median: Optional[float] = None
    high: Optional[float] = None


class AnalystAction(BaseModel):
    date: str
    firm: Optional[str] = None
    action: str                             # up | down | init | main (or Yahoo's raw value)
    from_: Optional[str] = Field(None, alias="from")   # "from" is a Python keyword
    to: Optional[str] = None
    target: Optional[float] = None
    prior_target: Optional[float] = None

    model_config = ConfigDict(populate_by_name=True)


class AnalystsOut(BaseModel):
    rating: Optional[str] = None
    consensus: Optional[AnalystConsensus] = None
    targets: AnalystTargets = AnalystTargets()
    upside_pct: Optional[float] = None      # computed: mean target vs price
    actions: List[AnalystAction] = []       # last 30 days, max 12


class VolumeOut(BaseModel):
    today: Optional[float] = None
    average: Optional[float] = None
    relative: Optional[float] = None        # computed: today / average
    short_pct_float: Optional[float] = None
    short_ratio: Optional[float] = None
    beta: Optional[float] = None


class RangeOut(BaseModel):
    high: Optional[float] = None
    low: Optional[float] = None
    position_pct: Optional[float] = None    # computed: where price sits in the 52-week range


class NewsItem(BaseModel):
    title: str
    publisher: Optional[str] = None
    url: Optional[str] = None
    published: Optional[Union[str, int]] = None   # ISO string or epoch seconds


class CatalystsOut(BaseModel):
    symbol: str
    name: str
    price: Optional[float] = None
    change_pct: Optional[float] = None
    earnings: EarningsOut
    dividend: DividendOut
    expected_move: Optional[ExpectedMoveOut] = None
    earnings_history: List[EarningsHistoryRow] = []
    analysts: AnalystsOut
    volume: VolumeOut
    range: RangeOut
    news: List[NewsItem] = []
    signals: List[CatalystSignal] = []
    as_of: str
    source: str
