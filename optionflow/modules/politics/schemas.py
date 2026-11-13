"""optionflow/modules/politics/schemas.py — response models (see service.py for meanings)."""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field

Status = Literal["ok", "none", "unknown_company", "not_configured", "unavailable"]


class CongressTrade(BaseModel):
    symbol: Optional[str] = None
    chamber: str
    member: str
    district: Optional[str] = None
    owner: Optional[str] = Field(None, description="Self, Spouse, Joint, Child … as disclosed")
    side: Literal["buy", "sell", "exchange", "other"]
    type: Optional[str] = Field(None, description="As disclosed, e.g. 'Purchase', 'Sale (Partial)'")
    amount: Optional[str] = Field(None, description="Disclosed range, e.g. '$1,001 - $15,000'")
    asset: Optional[str] = None
    transaction_date: Optional[str] = None
    disclosure_date: Optional[str] = None
    days_late: Optional[int] = Field(None, description="Days between the trade and its disclosure")
    link: Optional[str] = None


class CongressSection(BaseModel):
    status: Status
    message: Optional[str] = None
    stale: bool = False
    trades: List[CongressTrade] = []
    buys_90d: int = 0
    sells_90d: int = 0
    members_90d: int = 0
    trades_12m: int = 0


class LobbyQuarter(BaseModel):
    period: str
    amount: float
    filings: int


class LobbyIssue(BaseModel):
    name: str
    count: int


class LobbyingSection(BaseModel):
    status: Status
    message: Optional[str] = None
    stale: bool = False
    quarters: List[LobbyQuarter] = []
    total: float = 0
    latest: Optional[LobbyQuarter] = None
    issues: List[LobbyIssue] = []
    firms: List[str] = []
    agencies: List[str] = []
    in_house: bool = False


class Amount(BaseModel):
    name: str
    amount: float


class ContractsSection(BaseModel):
    status: Status
    message: Optional[str] = None
    stale: bool = False
    total_12m: float = 0
    recipients: List[Amount] = []
    agencies: List[Amount] = []
    window: Optional[str] = None


class PoliticalProfile(BaseModel):
    symbol: str
    company: Optional[str] = None
    matched_names: List[str] = Field([], description="Normalised names matched in lobbying and contract records")
    congress: CongressSection
    lobbying: LobbyingSection
    contracts: ContractsSection
    as_of: str


class PoliticalCompact(BaseModel):
    symbol: str
    congress_buys_90d: Optional[int] = None
    congress_sells_90d: Optional[int] = None
    lobbying_last_q: Optional[float] = None
    lobbying_period: Optional[str] = None
    lobbying_4q: Optional[float] = None
    contracts_12m: Optional[float] = None


class PoliticalSummary(BaseModel):
    items: List[PoliticalCompact]
    pending: List[str] = Field([], description="Symbols queued for a first fetch; ask again in a minute")


class FeedCongress(BaseModel):
    status: Status
    message: Optional[str] = None
    trades: List[CongressTrade] = []


class FeedLobbying(BaseModel):
    symbol: str
    company: Optional[str] = None
    period: str
    amount: float
    total_4q: Optional[float] = None
    issues: List[str] = []


class PoliticalFeed(BaseModel):
    congress: FeedCongress
    lobbying: List[FeedLobbying]
    pending: List[str] = []
    as_of: str
