"""optionflow/modules/hedge/schemas.py — request/response models."""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class IngestPosition(BaseModel):
    account: Optional[str] = Field(None, description='Masked label, e.g. "Trading ••8453". Never a full account number.')
    symbol: str
    kind: Literal["stock", "option"]
    quantity: float = Field(..., description="Signed: long > 0, short < 0 (shares or contracts)")
    avg_price: Optional[float] = Field(None, ge=0, description="Per share; option premium per share")
    option_type: Optional[Literal["call", "put"]] = None
    strike: Optional[float] = Field(None, gt=0)
    expiry: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    multiplier: float = 100.0
    opened_at: Optional[str] = None


class IngestAccount(BaseModel):
    account: str = Field(..., description='Masked label, e.g. "Trading ••8453"')
    day: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$", description="Trading day (US Eastern); default today")
    total_value: Optional[float] = None
    equity_value: Optional[float] = None
    options_value: Optional[float] = None
    crypto_value: Optional[float] = None
    cash: Optional[float] = None
    buying_power: Optional[float] = None


class IngestActivity(BaseModel):
    ext_id: str = Field(..., min_length=1, max_length=200, description="Stable broker id: option leg id, or a derived key")
    account: Optional[str] = None
    kind: Literal["option_fill", "realized"]
    ts: str
    symbol: str
    side: Optional[Literal["buy", "sell", ""]] = None
    position_effect: Optional[Literal["open", "close"]] = None
    option_type: Optional[Literal["call", "put"]] = None
    strike: Optional[float] = None
    expiry: Optional[str] = None
    quantity: Optional[float] = None
    price: Optional[float] = None
    amount: Optional[float] = Field(None, description="Option fills: cash, + credit / − debit")
    realized_gain: Optional[float] = None
    strategy: Optional[str] = None


class IngestRequest(BaseModel):
    username: str = Field(..., max_length=64)
    source: Literal["robinhood"] = "robinhood"
    positions: List[IngestPosition] = Field(..., max_length=2000)
    accounts: List[IngestAccount] = Field([], max_length=50)
    activity: List[IngestActivity] = Field([], max_length=20000)


class IngestOut(BaseModel):
    count: int
    synced_at: str
    accounts: int = 0
    activity_new: int = 0
    activity_total: int = 0


class BrokerPositionOut(IngestPosition):
    id: int
    source: str
    synced_at: str


class LegOut(BaseModel):
    kind: str
    quantity: float
    avg_price: Optional[float] = None
    otype: Optional[str] = None
    strike: Optional[float] = None
    expiry: Optional[str] = None
    dte: Optional[float] = None
    iv: Optional[float] = None
    mark: Optional[float] = Field(None, description="Live mid per share (options)")
    delta: float
    gamma: float
    position_delta: float
    position_gamma: float


class SuggestionOut(BaseModel):
    action: Literal["SELL_CALL", "SELL_PUT", "BUY_STOCK", "HOLD", "WAIT", "TRACK"]
    headline: str
    reasons: List[str] = []
    strike: Optional[float] = None
    expiry: Optional[str] = None
    otype: Optional[str] = None
    contracts: int = 0
    option_delta: Optional[float] = None
    premium: Optional[float] = None
    credit: Optional[float] = None
    net_delta_after: Optional[float] = None
    locked_gain: Optional[float] = None
    shares: int = Field(0, description="BUY_STOCK: shares to buy")
    new_avg: Optional[float] = Field(None, description="BUY_STOCK: average after the buy; SELL_PUT: net cost if assigned")
    warnings: List[str] = []
    long_strike: Optional[float] = Field(None, description="Put credit spread: the put bought below the short strike")
    yield_ann: Optional[float] = Field(None, description="Premium ÷ capital at work, annualised (decimal)")
    collateral: Optional[float] = Field(None, description="$ tied up: cash for a put, max loss for a spread")
    max_loss: Optional[float] = Field(None, description="$ max loss (spreads)")


class CloseOut(BaseModel):
    otype: Literal["call", "put"]
    strike: float
    expiry: str
    contracts: int
    dte: Optional[float] = None
    sold_at: float
    mark: float
    profit_pct: float
    cost: float
    kept: float
    headline: str
    reasons: List[str] = []


class UnitOut(BaseModel):
    kind: Literal["covered", "uncovered", "puts", "other"]
    label: str
    shares: float = 0
    contracts: float = 0
    delta: Optional[float] = None
    per_lot: Optional[float] = None


class IvOut(BaseModel):
    atm_iv: Optional[float] = None
    iv_open: Optional[float] = None
    iv_roc_day: Optional[float] = None
    iv_roc_15m: Optional[float] = None
    iv_high: Optional[float] = None
    spike: bool = False
    cooling: bool = False
    hv10: Optional[float] = None
    hv20: Optional[float] = None
    hv60: Optional[float] = None


class LevelsOut(BaseModel):
    king: Optional[float] = None
    put_wall: Optional[float] = None
    call_wall: Optional[float] = None
    net_gex: Optional[float] = None
    zero_gamma: Optional[float] = None


class BookOut(BaseModel):
    symbol: str
    error: Optional[str] = None
    accounts: List[str] = []
    shares: Optional[float] = None
    avg_cost: Optional[float] = None
    lots: Optional[float] = None
    net_delta: Optional[float] = None
    net_gamma: Optional[float] = None
    dollar_gamma_1pct: Optional[float] = None
    target_delta: Optional[float] = None
    regime: Optional[Literal["bull", "high-vol"]] = None
    gap: Optional[float] = None
    iv_hv: Optional[float] = None
    beta: Optional[float] = Field(None, description="1-year beta of daily returns vs SPY")
    legs: List[LegOut] = []
    units: List[UnitOut] = Field([], description="Covered (shares + their short calls), uncovered shares, short puts")
    suggestion: Optional[SuggestionOut] = None
    closes: List[CloseOut] = Field([], description="Short options worth buying back now (most of the premium captured)")
    strategy: Optional[str] = Field(None, description="Strategy key that produced the suggestion (GET /strategy)")
    spot: Optional[float] = None
    prev_close: Optional[float] = Field(None, description="Yesterday's close in the regular session; outside it, the close "
                                        "before the last regular session (so day_change = that session's move)")
    day_change: Optional[float] = None
    session: Optional[Literal["pre", "regular", "post", "overnight", "closed"]] = None
    regular_close: Optional[float] = Field(None, description="Close of the last completed regular session")
    regular_close_date: Optional[str] = None
    ext_change: Optional[float] = Field(None, description="spot − regular_close outside the regular session; null during it")
    ext_change_pct: Optional[float] = None
    day_high: Optional[float] = None
    weekly_expiry: Optional[str] = None
    chain_source: Optional[str] = None
    iv: Optional[IvOut] = None
    levels: Optional[LevelsOut] = None


class BooksOut(BaseModel):
    as_of: str
    synced_at: Optional[str] = None
    books: List[BookOut]


# ── Portfolio (broker-synced) ─────────────────────────────────────────────────
class BrokerAccountOut(BaseModel):
    account: str
    day: Optional[str] = None
    total_value: Optional[float] = None
    equity_value: Optional[float] = None
    options_value: Optional[float] = None
    crypto_value: Optional[float] = None
    cash: Optional[float] = None
    buying_power: Optional[float] = None
    prev_total: Optional[float] = None
    change: Optional[float] = None


class BrokerHoldingOut(BaseModel):
    symbol: str
    accounts: List[str] = []
    shares: float
    avg_cost: Optional[float] = None
    price: Optional[float] = None
    prev_close: Optional[float] = None
    market_value: Optional[float] = None
    cost_basis: Optional[float] = None
    unrealized: Optional[float] = None
    unrealized_pct: Optional[float] = None
    day_change_pct: Optional[float] = Field(None, description="Fraction. Outside the regular session: that last session's move")
    session: Optional[Literal["pre", "regular", "post", "overnight", "closed"]] = None
    regular_close: Optional[float] = None
    ext_change_pct: Optional[float] = Field(None, description="Percent since regular_close, outside the regular session")
    weight: Optional[float] = None
    short_calls: float = 0
    covered_pct: float = 0


class BrokerOptionOut(BaseModel):
    symbol: str
    account: Optional[str] = None
    option_type: str
    strike: float
    expiry: str
    dte: Optional[int] = None
    contracts: float
    avg_price: Optional[float] = None
    premium: Optional[float] = None
    spot: Optional[float] = None
    moneyness: Optional[Literal["ITM", "OTM", "ATM"]] = None
    distance_pct: Optional[float] = None
    opened_at: Optional[str] = None


class BrokerPortfolioOut(BaseModel):
    as_of: str
    synced_at: Optional[str] = None
    account_filter: Optional[str] = None
    accounts: List[BrokerAccountOut]
    total_value: Optional[float] = None
    cash: Optional[float] = None
    buying_power: Optional[float] = None
    day_change: Optional[float] = None
    stock_value: Optional[float] = None
    unrealized: Optional[float] = None
    holdings: List[BrokerHoldingOut]
    options: List[BrokerOptionOut]


class BrokerHistoryPoint(BaseModel):
    day: str
    total_value: Optional[float] = None
    cash: Optional[float] = None


class BrokerIncomeBucket(BaseModel):
    period: str
    premium: float = 0.0
    collected: float = 0.0
    bought_back: float = 0.0
    realized: float = 0.0
    trades: int = 0
    wins: int = 0


class BrokerSymbolIncome(BaseModel):
    symbol: str
    premium: float = 0.0
    collected: float = 0.0
    bought_back: float = 0.0
    realized: float = 0.0
    trades: int = 0


class BrokerIncomeOut(BaseModel):
    weekly: List[BrokerIncomeBucket]
    monthly: List[BrokerIncomeBucket]
    by_symbol: List[BrokerSymbolIncome]
    premium_total: float = 0.0
    collected_total: float = 0.0
    bought_back_total: float = 0.0
    realized_total: float = 0.0
    trades: int = 0
    win_rate: Optional[float] = None
    since: Optional[str] = None


class BrokerActivityOut(IngestActivity):
    id: int
