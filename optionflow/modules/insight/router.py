"""optionflow/modules/insight/router.py — GET /insight/{symbol}/swings and /leaps-score (HTTP only)."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query

from optionflow.core.deps import get_current_user
from optionflow.modules.insight import service
from optionflow.modules.insight.schemas import LeapsScoreOut, SwingsOut

router = APIRouter(prefix="/insight", tags=["insight"])


@router.get("/{symbol}/swings", response_model=SwingsOut)
def swings(symbol: str, period: Literal["1mo", "3mo", "6mo", "1y", "5y", "max"] = Query("1y"),
           _user=Depends(get_current_user)) -> SwingsOut:
    """Drawdown (below the range's high) and upside spike (above the rolling low) for each session of the range."""
    return service.swings(symbol, period)


@router.get("/{symbol}/leaps-score", response_model=LeapsScoreOut)
def leaps_score(symbol: str, _user=Depends(get_current_user)) -> LeapsScoreOut:
    """0–100: how good a moment it is to buy a long-dated call on this stock, with the factors behind it."""
    return service.leaps_score(symbol)
