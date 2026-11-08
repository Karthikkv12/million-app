"""optionflow/modules/unusual/schemas.py — scanner response (mirrors service.scan)."""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel


class UnusualRow(BaseModel):
    symbol: str
    type: Literal["call", "put"]
    strike: float
    expiry: str
    dte: int
    spot: Optional[float] = None
    otm_pct: Optional[float] = None
    last: Optional[float] = None
    bid: Optional[float] = None
    ask: Optional[float] = None
    side: Literal["ask", "bid", "mid", "unknown"]   # where the last trade printed vs the quote
    volume: int
    open_interest: int
    vol_oi: Optional[float] = None
    iv_pct: Optional[float] = None
    premium: float
    score: float


class UnusualScanOut(BaseModel):
    rows: List[UnusualRow] = []
    count: int = 0
    symbols: List[str] = []
    call_premium: float = 0.0
    put_premium: float = 0.0
    as_of: str
    source: str
