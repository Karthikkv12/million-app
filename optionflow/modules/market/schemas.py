"""optionflow/modules/market/schemas.py — quotes, search, company data and price history."""
from __future__ import annotations

from typing import List, Optional, Union

from pydantic import BaseModel

Num = Optional[float]


class TickerSearchResult(BaseModel):
    symbol: str
    name: str = ""
    type: str = ""
    exchange: str = ""


class QuoteOut(BaseModel):
    symbol: str
    price: Num = None
    prev_close: Num = None
    change: Num = None
    change_pct: Num = None


class LiveQuoteOut(BaseModel):
    symbol: str
    price: Num = None
    from_cache: Optional[bool] = None
    error: Optional[str] = None


class WatchlistRowOut(BaseModel):
    symbol: str
    name: Optional[str] = None
    price: Num = None
    prev_close: Num = None
    change: Num = None
    change_pct: Num = None
    volume: Optional[int] = None
    avg_volume: Optional[int] = None
    rel_volume: Num = None
    market_cap: Num = None
    market_cap_fmt: Optional[str] = None
    pe_ratio: Num = None
    forward_pe: Num = None
    eps_ttm: Num = None
    eps_growth: Num = None
    div_yield: Num = None
    sector: Optional[str] = None
    industry: Optional[str] = None
    analyst_rating: Optional[str] = None
    beta: Num = None
    week_52_high: Num = None
    week_52_low: Num = None
    day_high: Num = None
    day_low: Num = None
    fifty_day_avg: Num = None
    two_hundred_day_avg: Num = None
    error: Optional[str] = None


class StockInfoOut(BaseModel):
    symbol: str
    name: Optional[str] = None
    sector: Optional[str] = None
    industry: Optional[str] = None
    description: Optional[str] = None
    website: Optional[str] = None
    exchange: Optional[str] = None
    currency: Optional[str] = None
    quote_type: Optional[str] = None
    country: Optional[str] = None
    employees: Optional[int] = None
    market_cap: Num = None
    enterprise_value: Num = None
    shares_outstanding: Num = None
    float_shares: Num = None
    avg_volume: Num = None
    avg_volume_10d: Num = None
    week_52_high: Num = None
    week_52_low: Num = None
    day_high: Num = None
    day_low: Num = None
    fifty_day_avg: Num = None
    two_hundred_day_avg: Num = None
    pe_ratio: Num = None
    forward_pe: Num = None
    pb_ratio: Num = None
    ps_ratio: Num = None
    peg_ratio: Num = None
    ev_ebitda: Num = None
    eps_ttm: Num = None
    eps_forward: Num = None
    revenue_ttm: Num = None
    gross_margin: Num = None
    profit_margin: Num = None
    operating_margin: Num = None
    return_on_equity: Num = None
    return_on_assets: Num = None
    debt_to_equity: Num = None
    free_cash_flow: Num = None
    dividend_yield: Num = None
    dividend_rate: Num = None
    payout_ratio: Num = None
    ex_dividend_date: Optional[Union[int, float, str]] = None   # Yahoo: epoch seconds
    beta: Num = None
    short_ratio: Num = None
    short_pct_float: Num = None
    earnings_date: Optional[Union[int, float, str]] = None      # Yahoo: epoch seconds
    error: Optional[str] = None


class PriceBar(BaseModel):
    date: str
    open: Num = None
    high: Num = None
    low: Num = None
    close: float
    volume: Optional[int] = None


class PriceHistoryOut(BaseModel):
    symbol: str
    bars: List[PriceBar] = []
    current_price: Num = None
    error: Optional[str] = None
