from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .base import GetOrderStatusResponse

from .base import BrokerAdapter, CancelOrderResponse, SubmitOrderRequest, SubmitOrderResponse


def _now_utc_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _state_file() -> Path:
    # Defaults to a local file so status survives restarts.
    p = os.getenv("PAPER_BROKER_STATE_FILE", ".paper_broker_state.json")
    return Path(p)


def _load_state() -> dict[str, Any]:
    f = _state_file()
    if not f.exists():
        return {"orders": {}}
    try:
        data = json.loads(f.read_text("utf-8"))
        if isinstance(data, dict) and isinstance(data.get("orders"), dict):
            return data
    except Exception:
        pass
    return {"orders": {}}


def _save_state(data: dict[str, Any]) -> None:
    f = _state_file()
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(f.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True), "utf-8")
    tmp.replace(f)


def _set_status(external_order_id: str, *, status: str, venue: str = "PAPER") -> None:
    data = _load_state()
    orders = data.setdefault("orders", {})
    if not isinstance(orders, dict):
        data["orders"] = {}
        orders = data["orders"]
    orders[str(external_order_id)] = {"status": str(status), "venue": str(venue)}
    _save_state(data)


def _get_status(external_order_id: str) -> tuple[str, str]:
    data = _load_state()
    orders = data.get("orders")
    if isinstance(orders, dict):
        row = orders.get(str(external_order_id))
        if isinstance(row, dict):
            st = str(row.get("status") or "UNKNOWN")
            venue = str(row.get("venue") or "PAPER")
            return st, venue
    return "UNKNOWN", "PAPER"
class PaperBroker:
    """A built-in "paper" broker.

    It simulates a rentable OMS without any external dependency.
    Orders are accepted and stay PENDING until our system marks them filled/cancelled.
    """

    name = "paper"

    def submit_order(self, *, user_id: int, req: SubmitOrderRequest) -> SubmitOrderResponse:
        now = _now_utc_naive()
        # Idempotency: if a client_order_id exists, derive the external id from it.
        if req.client_order_id:
            ext = f"paper:{user_id}:{req.client_order_id}"
        else:
            ext = f"paper:{user_id}:{uuid.uuid4().hex}"
        _set_status(ext, status="ACCEPTED", venue="PAPER")
        return SubmitOrderResponse(
            external_order_id=ext,
            venue="PAPER",
            external_status="ACCEPTED",
            submitted_at=now,
        )

    def cancel_order(self, *, user_id: int, external_order_id: str) -> CancelOrderResponse:
        now = _now_utc_naive()
        _set_status(str(external_order_id), status="CANCELLED", venue="PAPER")
        return CancelOrderResponse(external_status="CANCELLED", cancelled_at=now)

    def get_order_status(self, *, user_id: int, external_order_id: str) -> GetOrderStatusResponse:
        ext = str(external_order_id)
        now = _now_utc_naive()
        status, venue = _get_status(ext)
        return GetOrderStatusResponse(
            external_order_id=ext,
            venue=venue,
            external_status=status,
            last_synced_at=now,
        )

    def fill_order(
        self,
        *,
        user_id: int,
        external_order_id: str,
        filled_price: float | None = None,
        filled_at: datetime | None = None,
    ):
        from .base import FillOrderResponse

        ext = str(external_order_id)
        at = filled_at or _now_utc_naive()
        _set_status(ext, status="FILLED", venue="PAPER")
        return FillOrderResponse(
            external_order_id=ext,
            venue="PAPER",
            external_status="FILLED",
            filled_price=(float(filled_price) if filled_price is not None else None),
            filled_at=at,
        )
