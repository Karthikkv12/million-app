from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Protocol


@dataclass(frozen=True)
class SubmitOrderRequest:
    symbol: str
    instrument: str
    action: str
    quantity: int
    limit_price: Optional[float]
    client_order_id: Optional[str]


@dataclass(frozen=True)
class SubmitOrderResponse:
    external_order_id: str
    venue: str
    external_status: str
    submitted_at: datetime


@dataclass(frozen=True)
class CancelOrderResponse:
    external_status: str
    cancelled_at: datetime


@dataclass(frozen=True)
class FillOrderResponse:
    external_order_id: str
    venue: str
    external_status: str
    filled_price: Optional[float]
    filled_at: datetime


@dataclass(frozen=True)
class GetOrderStatusResponse:
    external_order_id: str
    venue: str
    external_status: str
    last_synced_at: datetime


class BrokerAdapter(Protocol):
    """Provider-agnostic broker/OMS adapter.

    This is the abstraction layer that lets us swap rentable OMS providers later.
    """

    name: str

    def submit_order(self, *, user_id: int, req: SubmitOrderRequest) -> SubmitOrderResponse: ...

    def cancel_order(self, *, user_id: int, external_order_id: str) -> CancelOrderResponse: ...

    def get_order_status(self, *, user_id: int, external_order_id: str) -> GetOrderStatusResponse: ...

    def fill_order(
        self,
        *,
        user_id: int,
        external_order_id: str,
        filled_price: Optional[float] = None,
        filled_at: Optional[datetime] = None,
    ) -> FillOrderResponse: ...
