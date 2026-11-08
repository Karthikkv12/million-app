"""optionflow/modules/flow/router.py — GEX board, watch heartbeat, net-flow history (HTTP only)."""
from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse

from optionflow.core import errors
from optionflow.core.deps import get_current_user, get_current_user_for_stream
from optionflow.modules.flow import service
from optionflow.modules.flow.schemas import GexOut, NetFlowPoint, WatchRequest
from optionflow.workers import backfill

router = APIRouter(prefix="/options", tags=["flow"])
stream_router = APIRouter(prefix="/flow", tags=["flow"])


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


@stream_router.get("/{symbol}/stream", response_class=StreamingResponse)
async def gex_stream(
    symbol: str,
    request: Request,
    interval: float = Query(default=10.0, ge=2.0, le=60.0, description="Seconds between checks"),
    limit: int = Query(default=0, ge=0, description="Stop after this many events (0 = until the client leaves)"),
    _user=Depends(get_current_user_for_stream),
) -> StreamingResponse:
    """Server-Sent Events: a `gex` event (same body as gamma-exposure) whenever GEX changes.

    Keeps the symbol watched while connected, so the poller keeps it fresh.
    Between changes it sends `: keepalive` comments.
    """
    sym = symbol.upper()

    async def events():
        yield "retry: 5000\n\n"
        last, sent = None, 0
        while not await request.is_disconnected():
            for new in service.watch([sym]):
                backfill.start_backfill(new)
            result = await run_in_threadpool(service.get_gex, sym)
            body = GexOut(**service.gex_payload(result)).model_dump_json()
            if body != last:
                last = body
                sent += 1
                yield f"event: gex\ndata: {body}\n\n"
                if limit and sent >= limit:
                    return
            else:
                yield ": keepalive\n\n"
            await asyncio.sleep(interval)

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@stream_router.get("/{symbol}/replay")
def gex_replay(symbol: str, on: Optional[str] = None, _user=Depends(get_current_user)) -> Dict[str, Any]:
    """A day of GEX snapshots for replay (`on` = YYYY-MM-DD UTC; latest day if omitted)."""
    from datetime import date as _date
    from optionflow.modules.flow import replay
    try:
        d = _date.fromisoformat(on) if on else None
    except ValueError:
        raise errors.BadRequest("Use YYYY-MM-DD for 'on'")
    return replay.day(symbol, d)
