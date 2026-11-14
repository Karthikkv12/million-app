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
    action: Literal["SELL_CALL", "SELL_PUT", "BUY_CALL", "BUY_STOCK", "HOLD", "WAIT", "TRACK"]
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
    collateral: Optional[float] = Field(None, description="$ tied up: cash for a put, max loss for a spread, the debit of a long call")
    max_loss: Optional[float] = Field(None, description="$ max loss (spreads, long calls)")


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
    max_pain: Optional[float] = None


class SignalLevelOut(BaseModel):
    key: str
    label: str
    price: float
    distance: float = Field(..., description="price ÷ spot − 1")
    strength: int = Field(..., description="0 (expected move) … 3 (dealer walls, gamma flip)")


class SignalReadOut(BaseModel):
    key: Literal["fear", "momentum", "dip", "flow", "trend", "dealers", "volume", "volatility"]
    score: float = Field(..., description="−1 bearish … +1 bullish")
    weight: int
    value: str
    note: str
    tested: bool = Field(False, description="In the verdict (backtested); false = context only")


class ExpectedMoveOut(BaseModel):
    day: float = Field(..., description="±$ one standard deviation today, from ATM IV")
    week: float = Field(..., description="±$ over 5 sessions")


class SignalLegOut(BaseModel):
    label: str
    dte: int
    iv: float
    delta: float
    value: float = Field(..., description="Model value per share at today's price and IV")
    extrinsic_pct: float = Field(..., description="Share of the value that is time value")
    theta_day: float = Field(..., description="$ lost per calendar day across the contracts held")
    decay_20d: float = Field(..., description="Share of the value lost to time over 20 trading days")
    roll: bool = Field(..., description="Within 30 days of expiry: roll or close (expiry mechanics; decay alone didn't pay)")
    warn: bool = Field(..., description="Within 60 days of expiry")
    iv_source: Literal["chain", "model", "atm"] = Field("chain", description="chain: the contract's quote; model: the backtest's IV model (no quote)")


class SignalProbOut(BaseModel):
    """Backtest odds for this setup, 2015–2026 (unseen when the rules were set)."""
    case: Literal["ADD", "LEAN", "CAUTION", "HOLD", "TRIM"]
    cases: int
    months: int
    p_up_20: float
    p_up_60: float = Field(..., description="Share of cases where the stock was up 60 trading days later")
    p_beat_20: float
    p_beat_60: float = Field(..., description="Share that beat simply holding the stock over 60 days")
    p_option_profit_60: Optional[float] = Field(None, description="Share where a 365-day 0.80Δ call made money over 60 days (stress costs)")
    edge_60: float = Field(..., description="Mean 60-day excess vs holding")
    edge_lo: float = Field(..., description="5th percentile of the month-cluster bootstrap")
    edge_hi: float
    p_edge_positive: float = Field(..., description="Share of bootstrap draws with a positive mean edge")


class SignalPnlOut(BaseModel):
    """The holding's P&L and its tested 60-day risk. It never moves the verdict: P&L didn't predict the stock."""
    kind: Literal["options", "shares"]
    pct: float
    dollars: float
    cost: float
    bucket: Optional[str] = None
    p_lose_25_paid: Optional[float] = Field(None, description="Long options at this P&L: share that lost >25% of the original premium in 60 trading days (2015–2026)")
    p_gain_25_paid: Optional[float] = None
    p5_paid: Optional[float] = Field(None, description="Worst 1 in 20 over 60 trading days, as a share of the original premium")
    cases: Optional[int] = None
    note: str


class SignalPlanOut(BaseModel):
    """Prices for the decision (hedge.signal.plan)."""
    lines: List[str] = Field([], description="The plan in plain words: buy / add trigger, support, upside, exit line, covered calls")
    trigger_text: Optional[str] = Field(None, description="What would turn it into Buy / Add, e.g. 'if X closes ≤ 280.10 … or if the VIX closes ≥ 22.4 …'")
    buy_below: Optional[float] = Field(None, description="Close at or under this (today's VIX) makes it Buy / Add")
    buy_rsi: Optional[float] = Field(None, description="The RSI(14) that close means")
    vix_trigger: Optional[float] = Field(None, description="VIX close at or over this (today's price) makes it Buy / Add")
    vix_pct_needed: Optional[float] = None
    clears_text: Optional[str] = Field(None, description="What clears a Don't add / Don't buy yet")
    upside: Optional[float] = Field(None, description="Nearest resistance (held): no tested sell price")
    exit_below: Optional[float] = Field(None, description="Held, long: the 200-day average. Under it while the market is calm (VIX < 60th pct) is the exit (−1.5% to −1.65% vs holding over 60 days); not in fear")
    covered_call: Optional[Literal["0.15", "0.30"]] = Field(None, description="Covered-call delta to sell now (held shares)")


class SignalOut(BaseModel):
    """The tested read, levels and price plan for any holding or ticker (hedge.signal)."""
    score: int = Field(..., description="Rebound score −100 … +100 (VIX percentile, oversold RSI, depth under the 50-day)")
    bias: Literal["bullish", "bearish", "neutral"]
    verdict: Literal["ADD", "HOLD", "CAUTION", "TRIM", "ROLL", "EXIT"] = Field(..., description="Long: ADD / HOLD / CAUTION (don't add) / EXIT (held, under the 200-day in a calm market). Net short (puts, short calls): TRIM (take profit) / HOLD. ROLL: a long leg within 30 days of expiry. Horizon: the next 20–60 trading days (1–3 months)")
    side: Literal["long", "short"]
    headline: str
    support: Optional[SignalLevelOut] = None
    resistance: Optional[SignalLevelOut] = None
    stop: Optional[float] = Field(None, description="Held, calm market: the 200-day average (under it = EXIT)")
    add_at: Optional[float] = None
    target: Optional[float] = None
    reads: List[SignalReadOut] = []
    levels: List[SignalLevelOut] = []
    expected_move: Optional[ExpectedMoveOut] = None
    vix_pct: Optional[float] = Field(None, description="VIX percentile over the last year (0–1)")
    evidence: str = Field("", description="Backtest result for this verdict")
    iv_model: Optional[float] = Field(None, description="Modelled 30-day IV now (the backtest's model)")
    iv_normal: Optional[float] = Field(None, description="Its 5-year average")
    iv_ratio: Optional[float] = Field(None, description="Stock IV ÷ its 5-year normal (the lower of the model's and the live ATM IV's); context only, no gate")
    legs: List[SignalLegOut] = []
    probability: Optional[SignalProbOut] = None
    pnl: Optional[SignalPnlOut] = None
    fear_score: Optional[float] = Field(None, description="0–1: VIX percentile × how oversold; ADD at ≥ 0.283")
    plan: Optional[SignalPlanOut] = None


class SwingReadOut(BaseModel):
    """The swing read (hedge.swing): 1 week – 1 month, its own backtest."""
    verdict: Literal["BUY", "WAIT"]
    reason: str
    buy_below: Optional[float] = Field(None, description="A close at or under this would make it a swing buy")
    exit_above: float = Field(..., description="Sell at the first close above the 10-day average (today's value)")
    max_days: int = Field(20, description="…or after this many trading days")
    ret5: float = Field(..., description="5-day change")
    vs_200d: float
    fear: bool = Field(..., description="Fear dip (the 1–3 month Add)")
    drop: bool = Field(..., description="≥ 5% down in 5 days above the 200-day")
    stats: Optional["SwingStatsSetOut"] = None


class StockSignalOut(BaseModel):
    """The desk's signal for one ticker, held or not (GET /hedge/signal/{symbol})."""
    symbol: str
    held: Literal["none", "stock", "long_options", "options", "mixed"] = Field(..., description="Held in any form: the Hedge desk's own book signal")
    label: Optional[str] = Field(None, description="Buy / Wait / Don't buy yet when not held; Add / Hold / Don't add / Roll / Take profit when held")
    spot: Optional[float] = None
    day_change: Optional[float] = None
    signal: Optional[SignalOut] = None
    reasons: List[str] = Field([], description="Why: backtest odds, evidence, levels, IV, legs and the reads")
    error: Optional[str] = None
    swing: Optional[SwingReadOut] = Field(None, description="Swing read, 1 week – 1 month (None without 200 days of history)")


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
    signal: Optional[SignalOut] = Field(None, description="Long options only (strategy long_stock): levels, reads, ADD/HOLD/TRIM")
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
    long_paid: float = 0.0       # bought long options (buy to open): not premium
    long_received: float = 0.0   # sold long options (sell to close)
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
    long_paid_total: float = 0.0
    this_week: Optional[str] = None   # Monday (ET) of the current week, to match against weekly[].period
    trades: int = 0
    win_rate: Optional[float] = None
    since: Optional[str] = None


class BrokerActivityOut(IngestActivity):
    id: int


class SignalScanRowOut(BaseModel):
    symbol: str
    price: float
    day_change: Optional[float] = None
    as_of: str = Field(..., description="Date of the last daily bar")
    verdict: Literal["ADD", "HOLD", "CAUTION", "TRIM", "ROLL"]
    label: str = Field(..., description="Buy / Wait / Don't buy yet (read as not held)")
    case: Optional[Literal["ADD", "LEAN", "CAUTION", "HOLD", "TRIM"]] = None
    fear_score: Optional[float] = Field(None, description="0–1; Buy at ≥ 0.283")
    rsi: Optional[float] = None
    vs_50d: Optional[float] = None
    off_high: Optional[float] = Field(None, description="vs the 52-week high")
    buy_below: Optional[float] = Field(None, description="Close at or under this (today's VIX) makes it Buy")
    vix_trigger: Optional[float] = Field(None, description="VIX close at or over this (today's price) makes it Buy")
    support: Optional[float] = None
    headline: str
    p_edge_positive: Optional[float] = None
    edge_60: Optional[float] = None
    held: bool = Field(False, description="You hold it (any form)")
    swing: Optional[Literal["BUY", "WAIT"]] = Field(None, description="Swing read (1 week – 1 month); None without 200 days of history")
    swing_reason: Optional[str] = None
    swing_buy_below: Optional[float] = Field(None, description="A close at or under this would make it a swing buy")
    swing_exit_above: Optional[float] = Field(None, description="Swing exit: the first close above the 10-day average (this is today's)")
    ret5: Optional[float] = Field(None, description="5-day change")
    vs_200d: Optional[float] = None


class SwingStatsOut(BaseModel):
    trades: int
    avg: float
    median: float
    win: float
    days: float
    worst5: float
    t: float


class SwingBaselineOut(BaseModel):
    avg: float
    win: float


class SwingStatsSetOut(BaseModel):
    """Backtest of the swing rule (hedge.swing.STATS): IS 1995–2014 (chosen), OOS 2015–2026 (unseen)."""
    is_: SwingStatsOut = Field(..., alias="is")
    oos: SwingStatsOut
    baseline_oos_5d: SwingBaselineOut

    model_config = {"populate_by_name": True}


class SignalScanOut(BaseModel):
    """The tested signal across a universe of US stocks and ETFs, by fear score (GET /hedge/scan)."""
    as_of: Optional[str] = None
    building: bool = Field(False, description="A scan is being built; poll again")
    universe: int = Field(..., description="Tickers in the universe")
    universe_key: Literal["popular", "sp500"] = "popular"
    score_cut: float
    vix: Optional[float] = None
    vix_pct: Optional[float] = None
    rows: List[SignalScanRowOut] = []
    failed: List[str] = Field([], description="Symbols with no history this scan")
    swing_stats: Optional[SwingStatsSetOut] = None


SwingReadOut.model_rebuild()
