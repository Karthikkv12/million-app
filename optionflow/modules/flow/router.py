"""optionflow/modules/flow/router.py — GEX board, watch heartbeat, net-flow history (HTTP only)."""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends

from optionflow.core.deps import get_current_user
from optionflow.modules.flow import service
from optionflow.modules.flow.schemas import GexOut, NetFlowPoint, WatchRequest
from optionflow.workers import backfill

router = APIRouter(prefix="/options", tags=["flow"])


@router.get("/gamma-exposure/{symbol}", response_model=GexOut)
def gamma_exposure(symbol: str, _user=Depends(get_current_user)) -> GexOut:
    return service.gex_payload(service.get_gex(symbol.upper()))


@router.post("/watch", status_code=204)
def watch(body: WatchRequest, _user=Depends(get_current_user)) -> None:
    """Heartbeat from open flow boards: keeps the GEX poller refreshing these symbols."""
    for sym in service.watch(body.symbols):
        backfill.start_backfill(sym)


@router.get("/net-flow-history/{symbol}", response_model=List[NetFlowPoint])
def net_flow_history(symbol: str, days: int = 1, bucket: int = 0,
                     _user=Depends(get_current_user)) -> List[NetFlowPoint]:
    return service.net_flow_history(symbol, days=days, bucket_minutes=bucket)
