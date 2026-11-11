"""optionflow/modules/strategy/router.py — /strategy: the strategy the hedge desk runs, and its rules."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from optionflow.core.deps import get_current_user
from optionflow.modules.strategy import catalog, service
from optionflow.modules.strategy.schemas import StrategyOut, StrategySettingsOut, StrategyUpdate

router = APIRouter(prefix="/strategy", tags=["strategy"])


@router.get("", response_model=StrategyOut)
def get_strategy(user=Depends(get_current_user)) -> StrategyOut:
    """The strategy the desk runs, its rules, and every strategy on offer."""
    return StrategyOut(**service.get_settings(int(user["sub"])), strategies=catalog.describe())


@router.put("", response_model=StrategySettingsOut)
def put_strategy(body: StrategyUpdate, user=Depends(get_current_user)) -> StrategySettingsOut:
    """Set the strategy (the desk's actions follow within seconds) and/or rule overrides."""
    try:
        st = service.update_settings(int(user["sub"]), strategy=body.strategy, rules=body.rules)
    except service.StrategyError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return StrategySettingsOut(**st)
