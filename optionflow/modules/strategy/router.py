"""optionflow/modules/strategy/router.py — /strategy: the owner's strategy, scanner filters, scans and picks."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool

from optionflow.core.deps import get_current_user
from optionflow.modules.strategy import catalog, filters, service, worker
from optionflow.modules.strategy.schemas import PicksOut, ScanOut, StrategyOut, StrategySettingsOut, StrategyUpdate

router = APIRouter(prefix="/strategy", tags=["strategy"])


@router.get("", response_model=StrategyOut)
def get_strategy(user=Depends(get_current_user)) -> StrategyOut:
    """The strategy the desk runs, its rules, the scanner filters, and every strategy on offer."""
    st = service.get_settings(int(user["sub"]))
    return StrategyOut(**st, strategies=catalog.describe(), filters_default=filters.defaults())


@router.put("", response_model=StrategySettingsOut)
def put_strategy(body: StrategyUpdate, user=Depends(get_current_user)) -> StrategySettingsOut:
    """Set the strategy (the desk's actions follow within seconds), rule overrides, scanner filters, notifications."""
    try:
        st = service.update_settings(int(user["sub"]), strategy=body.strategy, rules=body.rules,
                                     scanner=body.scanner, notify=body.notify)
    except service.StrategyError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return StrategySettingsOut(**st)


@router.post("/scan", response_model=ScanOut)
async def run_scan(user=Depends(get_current_user)) -> ScanOut:
    """Scan the market now with the saved strategy and filters (30–90 s the first time; bars are cached)."""
    uid = int(user["sub"])
    res = await run_in_threadpool(worker.run_for_user, uid, False)
    if res is None:
        return ScanOut(**{**worker.LATEST.get(uid, {}), "running": True})
    return ScanOut(**res)


@router.get("/scan", response_model=ScanOut)
def latest_scan(user=Depends(get_current_user)) -> ScanOut:
    """The last scan (manual or background) since the server started; empty before the first."""
    uid = int(user["sub"])
    lock = worker._user_lock(uid)
    return ScanOut(**worker.LATEST.get(uid, {}), running=lock.locked())


@router.get("/picks", response_model=PicksOut)
def picks(limit: int = Query(100, ge=1, le=500), user=Depends(get_current_user)) -> PicksOut:
    """Every pick the scanner stored, newest first (one per contract per day)."""
    return PicksOut(picks=service.recent_picks(int(user["sub"]), limit))
