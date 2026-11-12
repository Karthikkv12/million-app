"""optionflow/modules/pulse/router.py — /alerts/price and /paper-trades (HTTP only). Paper only: never a broker."""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from optionflow.core.deps import get_current_user
from optionflow.modules.pulse import service
from optionflow.modules.pulse.schemas import (
    PaperTradeIn, PaperTradeOut, PaperTradePatch, PriceAlertIn, PriceAlertOut, PriceAlertPatch,
)

alerts_router = APIRouter(prefix="/alerts/price", tags=["pulse"])
paper_router = APIRouter(prefix="/paper-trades", tags=["pulse"])


def _uid(user) -> int:
    return int(user["sub"])


def _run(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except service.NotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except service.PulseError as e:
        raise HTTPException(status_code=400, detail=str(e))


@alerts_router.get("", response_model=List[PriceAlertOut])
def list_alerts(symbol: Optional[str] = None, user=Depends(get_current_user)) -> List[PriceAlertOut]:
    return _run(service.list_alerts, _uid(user), symbol)


@alerts_router.post("", response_model=PriceAlertOut, status_code=201)
def create_alert(body: PriceAlertIn, user=Depends(get_current_user)) -> PriceAlertOut:
    """Push once when the price is at or beyond the level (checked every few seconds, extended hours included)."""
    return _run(service.create_alert, _uid(user), body.symbol, body.price, body.direction, body.note)


@alerts_router.patch("/{alert_id}", response_model=PriceAlertOut)
def update_alert(alert_id: int, body: PriceAlertPatch, user=Depends(get_current_user)) -> PriceAlertOut:
    return _run(service.update_alert, _uid(user), alert_id, body.model_dump(exclude_unset=True))


@alerts_router.delete("/{alert_id}", status_code=204)
def delete_alert(alert_id: int, user=Depends(get_current_user)) -> Response:
    _run(service.delete_alert, _uid(user), alert_id)
    return Response(status_code=204)


@paper_router.get("", response_model=List[PaperTradeOut])
def list_trades(symbol: Optional[str] = None,
                status: Optional[str] = Query(None, pattern="^(planned|open|stopped|target|closed)$"),
                user=Depends(get_current_user)) -> List[PaperTradeOut]:
    return _run(service.list_trades, _uid(user), symbol, status)


@paper_router.post("", response_model=PaperTradeOut, status_code=201)
def create_trade(body: PaperTradeIn, user=Depends(get_current_user)) -> PaperTradeOut:
    """Paper only. planned → open when the price reaches entry; open → stopped / target at those levels."""
    return _run(service.create_trade, _uid(user), body.symbol, body.side, body.qty, body.entry, body.stop,
                body.target, body.note, body.status)


@paper_router.patch("/{trade_id}", response_model=PaperTradeOut)
def update_trade(trade_id: int, body: PaperTradePatch, user=Depends(get_current_user)) -> PaperTradeOut:
    return _run(service.update_trade, _uid(user), trade_id, body.model_dump(exclude_unset=True))


@paper_router.delete("/{trade_id}", status_code=204)
def delete_trade(trade_id: int, user=Depends(get_current_user)) -> Response:
    _run(service.delete_trade, _uid(user), trade_id)
    return Response(status_code=204)
