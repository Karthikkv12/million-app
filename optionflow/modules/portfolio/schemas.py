"""optionflow/modules/portfolio/schemas.py — portfolio request and response models.

Response models declare every field the API returns and are lossless
(extra="allow"): a key added by the services later still reaches the client.
Dates and datetimes are serialized as ISO strings, as before.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Any, Dict, List, Optional, Union

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field


def _iso(v: Any) -> Any:
    return v.isoformat() if isinstance(v, (date, datetime)) else v


Num = Optional[Union[int, float]]
Str = Annotated[Optional[str], BeforeValidator(_iso)]


class Out(BaseModel):
    model_config = ConfigDict(extra="allow", from_attributes=True)


class StatusOut(BaseModel):
    status: str = "ok"


# ── Requests: weeks ────────────────────────────────────────────────────────────
class WeekCreateRequest(BaseModel):
    for_date: Optional[datetime] = None


class _AccountValues(BaseModel):
    account_value: Optional[float] = None
    acct_label_1: Optional[str] = None
    acct_val_1: Optional[float] = None
    acct_label_2: Optional[str] = None
    acct_val_2: Optional[float] = None
    acct_label_3: Optional[str] = None
    acct_val_3: Optional[float] = None


class WeekUpdateRequest(_AccountValues):
    notes: Optional[str] = None


class WeekCompleteRequest(_AccountValues):
    pass


# ── Requests: positions and assignments ────────────────────────────────────────
class PositionCreateRequest(BaseModel):
    symbol: str = Field(min_length=1)
    contracts: int = Field(default=1, ge=1)
    strike: float = Field(gt=0)
    option_type: str  # CALL or PUT
    sold_date: Optional[datetime] = None
    expiry_date: Optional[datetime] = None
    premium_in: Optional[float] = None
    spot_price: Optional[float] = None
    holding_id: Optional[int] = None
    notes: Optional[str] = None


class PositionUpdateRequest(BaseModel):
    symbol: Optional[str] = None
    contracts: Optional[int] = Field(default=None, ge=1)
    strike: Optional[float] = Field(default=None, gt=0)
    option_type: Optional[str] = None
    sold_date: Optional[datetime] = None
    buy_date: Optional[datetime] = None
    expiry_date: Optional[datetime] = None
    premium_in: Optional[float] = None
    premium_out: Optional[float] = None
    spot_price: Optional[float] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    holding_id: Optional[int] = None


class AssignmentCreateRequest(BaseModel):
    symbol: str = Field(min_length=1)
    shares_acquired: int = Field(ge=1)
    acquisition_price: float = Field(gt=0)
    net_option_premium: Optional[float] = None
    notes: Optional[str] = None


class AssignmentUpdateRequest(BaseModel):
    shares_acquired: Optional[int] = Field(default=None, ge=1)
    acquisition_price: Optional[float] = Field(default=None, gt=0)
    net_option_premium: Optional[float] = None
    notes: Optional[str] = None


# ── Requests: holdings and value history ───────────────────────────────────────
class StockHoldingCreateRequest(BaseModel):
    symbol: str = Field(min_length=1)
    shares: float = Field(gt=0)
    cost_basis: Optional[float] = None
    avg_cost: Optional[float] = None
    company_name: Optional[str] = None
    notes: Optional[str] = None


class StockHoldingUpdateRequest(BaseModel):
    shares: Optional[float] = Field(default=None, ge=0)
    cost_basis: Optional[float] = None
    avg_cost: Optional[float] = None
    company_name: Optional[str] = None
    acquired_date: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None
    close_price: Optional[float] = None  # exit price when manually closing a holding


class PortfolioSnapshotCreateRequest(BaseModel):
    snapshot_date: datetime
    total_value: Optional[float] = None
    cash: Optional[float] = None
    stock_value: Optional[float] = None
    options_value: Optional[float] = None
    realized_pnl: Optional[float] = None
    unrealized_pnl: Optional[float] = None
    notes: Optional[str] = None


# ── Requests: broker accounts, balances, deposits (were untyped dicts) ─────────
class BrokerAccountCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    color: Optional[str] = None
    sort_order: int = 0


class BrokerAccountUpdateRequest(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class AccountBalanceUpsertRequest(BaseModel):
    account_id: int
    week_date: str            # YYYY-MM-DD
    balance: float


class CashDepositUpsertRequest(BaseModel):
    id: Optional[int] = None  # set to update an existing deposit
    week_date: str            # YYYY-MM-DD
    amount: float
    note: Optional[str] = None


# ── Requests: trading accounts (/accounts) ─────────────────────────────────────
class AccountCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    broker: Optional[str] = None
    currency: str = Field(default="USD", min_length=1)


class HoldingUpsertRequest(BaseModel):
    symbol: str = Field(min_length=1)
    quantity: float
    avg_cost: Optional[float] = None


# ── Responses ──────────────────────────────────────────────────────────────────
class WeekOut(Out):
    id: Optional[int] = None
    label: Str = None
    week_start: Str = None
    week_end: Str = None
    is_complete: Optional[bool] = None
    completed_at: Str = None
    account_value: Num = None
    acct_label_1: Str = None
    acct_val_1: Num = None
    acct_label_2: Str = None
    acct_val_2: Num = None
    acct_label_3: Str = None
    acct_val_3: Num = None
    notes: Str = None


class PositionOut(Out):
    id: Optional[int] = None
    week_id: Optional[int] = None
    holding_id: Optional[int] = None
    carried_from_id: Optional[int] = None
    rolled_to_id: Optional[int] = None
    symbol: Str = None
    option_type: Str = None
    status: Str = None
    contracts: Optional[int] = None
    strike: Num = None
    spot_price: Num = None
    premium_in: Num = None
    premium_out: Num = None
    net_premium: Num = None
    total_premium: Num = None
    margin: Num = None
    moneyness: Str = None
    intrinsic_value: Num = None
    extrinsic_value: Num = None
    is_roll: Optional[bool] = None
    sold_date: Str = None
    buy_date: Str = None
    expiry_date: Str = None
    notes: Str = None


class AssignmentOut(Out):
    id: Optional[int] = None
    position_id: Optional[int] = None
    symbol: Str = None
    shares_acquired: Optional[int] = None
    acquisition_price: Num = None
    net_option_premium: Num = None
    total_cost: Num = None
    total_shares: Num = None
    weighted_avg_cost: Num = None
    downside_basis: Num = None
    downside_breakeven: Num = None
    upside_basis: Num = None
    upside_breakeven: Num = None
    additional_buys: List[Dict[str, Any]] = []
    covered_calls: List[Dict[str, Any]] = []
    notes: Str = None


class StockHoldingOut(Out):
    id: Optional[int] = None
    symbol: Str = None
    company_name: Str = None
    status: Str = None
    shares: Num = None
    cost_basis: Num = None
    adjusted_cost_basis: Num = None
    live_adj_basis: Num = None
    downside_basis: Num = None
    upside_basis: Num = None
    basis_reduction: Num = None
    basis_reduction_stored: Num = None
    total_original_cost: Num = None
    total_adjusted_cost: Num = None
    total_premium_sold: Num = None
    realized_premium: Num = None
    unrealized_premium: Num = None
    realized_gain: Num = None
    called_away: Optional[bool] = None
    last_assignment_date: Str = None
    last_assignment_type: Str = None
    acquired_date: Str = None
    notes: Str = None
    created_at: Str = None
    updated_at: Str = None


class HoldingEventOut(Out):
    id: Optional[int] = None
    holding_id: Optional[int] = None
    position_id: Optional[int] = None
    event_type: Str = None
    shares_delta: Num = None
    basis_delta: Num = None
    realized_gain: Num = None
    description: Str = None
    created_at: Str = None


class WeekBreakdownOut(Out):
    id: Optional[int] = None
    week_start: Str = None
    week_end: Str = None
    is_complete: Optional[bool] = None
    position_count: Optional[int] = None
    premium: Num = None
    realized_pnl: Num = None
    account_value: Num = None
    acct_label_1: Str = None
    acct_val_1: Num = None
    acct_label_2: Str = None
    acct_val_2: Num = None
    acct_label_3: Str = None
    acct_val_3: Num = None


class PortfolioSummaryOut(Out):
    total_weeks: Optional[int] = None
    complete_weeks: Optional[int] = None
    active_positions: Optional[int] = None
    assigned_positions: Optional[int] = None
    total_premium_collected: Num = None
    realized_pnl: Num = None
    win_rate: Num = None
    cap_gains_tax_rate: Num = None
    estimated_tax: Num = None
    best_week: Any = None
    worst_week: Any = None
    monthly_premium: Optional[Dict[str, Any]] = None           # "YYYY-MM" -> premium
    monthly_account_values: Optional[Dict[str, Any]] = None    # "YYYY-MM" -> value
    weeks_breakdown: List[WeekBreakdownOut] = []


class SymbolSummaryOut(Out):
    symbol: Str = None
    active: Optional[int] = None
    assigned: Optional[int] = None
    closed: Optional[int] = None
    expired: Optional[int] = None
    total_premium: Num = None
    realized_pnl: Num = None


class SeedHoldingsOut(Out):
    created: List[StockHoldingOut] = []
    linked: Optional[int] = None


class RecalculatedHolding(Out):
    id: Optional[int] = None
    symbol: Str = None
    cost_basis: Num = None
    old_adj: Num = None
    new_adj: Num = None
    corrected: Optional[bool] = None


class RecalculateHoldingsOut(Out):
    holdings: List[RecalculatedHolding] = []
    updated: Optional[int] = None


class SyncLedgerOut(Out):
    synced_rows: Optional[int] = None
    updated_holdings: Optional[int] = None


class PremiumLedgerRow(Out):
    id: Optional[int] = None
    holding_id: Optional[int] = None
    position_id: Optional[int] = None
    week_id: Optional[int] = None
    symbol: Str = None
    option_type: Str = None
    status: Str = None
    strike: Num = None
    contracts: Optional[int] = None
    premium_sold: Num = None
    realized_premium: Num = None
    unrealized_premium: Num = None
    expiry_date: Str = None
    created_at: Str = None
    updated_at: Str = None


class PremiumLedgerOut(Out):
    holding_id: Optional[int] = None
    total_premium_sold: Num = None
    realized_premium: Num = None
    unrealized_premium: Num = None
    rows: List[PremiumLedgerRow] = []


class PremiumBySymbol(Out):
    symbol: Str = None
    holding_id: Optional[int] = None
    shares: Num = None
    positions: Optional[int] = None
    cost_basis: Num = None
    adj_basis_db: Num = None
    adj_basis_stored: Num = None
    live_adj_basis: Num = None
    adj_at_exit: Num = None
    total_premium_sold: Num = None
    realized_premium: Num = None
    unrealized_premium: Num = None
    realized_per_share: Num = None
    unrealized_per_share: Num = None
    rows: List[PremiumLedgerRow] = []


class PremiumWeekSymbol(Out):
    symbol: Str = None
    sold: Num = None
    realized: Num = None
    unrealized: Num = None


class PremiumByWeek(Out):
    week_id: Optional[int] = None
    week_label: Str = None
    total_premium_sold: Num = None
    realized_premium: Num = None
    unrealized_premium: Num = None
    symbols: List[PremiumWeekSymbol] = []


class PremiumTotals(Out):
    total_premium_sold: Num = None
    realized_premium: Num = None
    unrealized_premium: Num = None


class PremiumDashboardOut(Out):
    by_symbol: List[PremiumBySymbol] = []
    by_week: List[PremiumByWeek] = []
    grand_total: Optional[PremiumTotals] = None


class PortfolioSnapshotOut(Out):
    id: int
    snapshot_date: datetime
    total_value: Num = None
    cash: Num = None
    stock_value: Num = None
    options_value: Num = None
    realized_pnl: Num = None
    unrealized_pnl: Num = None
    notes: Str = None
    created_at: Optional[datetime] = None


class BrokerAccountOut(Out):
    id: Optional[int] = None
    name: Str = None
    color: Str = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class AccountBalanceOut(Out):
    account_id: Optional[int] = None
    week_date: Str = None
    balance: Num = None


class CashDepositOut(Out):
    id: Optional[int] = None
    week_date: Str = None
    amount: Num = None
    note: Str = None
    created_at: Str = None


class AccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    broker: Optional[str] = None
    currency: str
    created_at: Optional[datetime] = None


class HoldingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    account_id: int
    symbol: str
    quantity: float
    avg_cost: Optional[float] = None
    updated_at: Optional[datetime] = None
