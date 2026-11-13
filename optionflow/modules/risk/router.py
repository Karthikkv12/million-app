"""optionflow/modules/risk/router.py — GET /risk/vol-target and /risk/factors (HTTP only)."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query

from optionflow.core.deps import get_current_user
from optionflow.modules.risk import factors as fx
from optionflow.modules.risk import voltarget
from optionflow.modules.risk.schemas import FactorsOut, VolTargetOut

router = APIRouter(prefix="/risk", tags=["risk"])


@router.get("/vol-target", response_model=VolTargetOut)
def vol_target(target: float = Query(voltarget.DEFAULT_TARGET, gt=0.0, le=2.0, description="Target annual vol, decimal (0.15 = 15%)"),
               cap: float = Query(voltarget.DEFAULT_CAP, gt=0.0, le=5.0, description="Max gross delta dollars ÷ capital"),
               capital: Optional[float] = Query(None, gt=0.0, description="Override the synced account value"),
               user=Depends(get_current_user)) -> VolTargetOut:
    """Volatility targeting: exposure = target ÷ GARCH forecast, for the whole book and each holding."""
    return VolTargetOut(**voltarget.vol_target(int(user["sub"]), target, cap, capital))


@router.get("/factors", response_model=FactorsOut)
def factors(capital: Optional[float] = Query(None, gt=0.0, description="Override the synced account value"),
            user=Depends(get_current_user)) -> FactorsOut:
    """Factor exposure (APT): the book's betas to market, tech, size and rates, and its risk split by factor."""
    return FactorsOut(**fx.factors(int(user["sub"]), capital))
