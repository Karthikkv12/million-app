"""optionflow/modules/watchlists/router.py — /watchlists: named lists (HTTP only)."""
from __future__ import annotations

from typing import Callable, Dict, List, TypeVar

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from optionflow.core.deps import get_current_user
from optionflow.modules.watchlists import cboe, options, service
from optionflow.modules.watchlists.schemas import (
    ExtendedHoursOut, OptionMetricsOut, WatchlistCreateIn, WatchlistGroupOut, WatchlistGroupsOut, WatchlistOrderIn, WatchlistUpdateIn,
)

router = APIRouter(prefix="/watchlists", tags=["watchlists"])
T = TypeVar("T")


def _run(fn: Callable[[], T]) -> T:
    try:
        return fn()
    except service.WatchlistError as e:
        raise HTTPException(status_code=e.status, detail=str(e)) from e


def _all(rows: List[Dict]) -> WatchlistGroupsOut:
    return WatchlistGroupsOut(lists=[WatchlistGroupOut(**r) for r in rows],
                              max_lists=service.MAX_LISTS, max_symbols=service.MAX_SYMBOLS)


@router.get("", response_model=WatchlistGroupsOut)
def get_lists(user=Depends(get_current_user)) -> WatchlistGroupsOut:
    """Every list in display order. The first call creates "My watchlist" plus one list per sector."""
    return _all(service.list_groups(int(user["sub"])))


@router.get("/option-metrics", response_model=List[OptionMetricsOut])
def option_metrics(symbols: str = Query(..., max_length=600, description="Comma-separated, up to 40"),
                   _user=Depends(get_current_user)) -> List[OptionMetricsOut]:
    """ATM IV, IV change today, HV20, IV/HV, weekly expected move and ATM deltas, for the option columns."""
    syms = []
    for s in symbols.split(","):
        try:
            syms.append(service.clean_symbol(s))
        except service.WatchlistError:
            continue
    return [OptionMetricsOut(**m) for m in options.batch(syms)]


@router.get("/extended-hours", response_model=ExtendedHoursOut)
def extended_hours(_user=Depends(get_current_user)) -> ExtendedHoursOut:
    """Cboe's extended-hours options list (stocks and ETFs), read from Cboe's reference file and refreshed every 12 h."""
    return ExtendedHoursOut(**cboe.extended_hours())


@router.post("", response_model=WatchlistGroupOut, status_code=201)
def create_list(body: WatchlistCreateIn, user=Depends(get_current_user)) -> WatchlistGroupOut:
    """New list (409 at the 20-list limit or on a duplicate name)."""
    return WatchlistGroupOut(**_run(lambda: service.create_group(int(user["sub"]), body.name, body.symbols)))


@router.patch("/{list_id}", response_model=WatchlistGroupOut)
def update_list(list_id: int, body: WatchlistUpdateIn, user=Depends(get_current_user)) -> WatchlistGroupOut:
    """Rename, replace the symbols, and/or replace the columns (each in order)."""
    return WatchlistGroupOut(**_run(lambda: service.update_group(int(user["sub"]), list_id, body.name, body.symbols, body.columns)))


@router.delete("/{list_id}", status_code=204)
def delete_list(list_id: int, user=Depends(get_current_user)) -> Response:
    _run(lambda: service.delete_group(int(user["sub"]), list_id))
    return Response(status_code=204)


@router.put("/{list_id}/symbols/{symbol}", response_model=WatchlistGroupOut)
def add_symbol(list_id: int, symbol: str, user=Depends(get_current_user)) -> WatchlistGroupOut:
    return WatchlistGroupOut(**_run(lambda: service.add_symbol(int(user["sub"]), list_id, symbol)))


@router.delete("/{list_id}/symbols/{symbol}", response_model=WatchlistGroupOut)
def remove_symbol(list_id: int, symbol: str, user=Depends(get_current_user)) -> WatchlistGroupOut:
    return WatchlistGroupOut(**_run(lambda: service.remove_symbol(int(user["sub"]), list_id, symbol)))


@router.post("/order", response_model=WatchlistGroupsOut)
def reorder(body: WatchlistOrderIn, user=Depends(get_current_user)) -> WatchlistGroupsOut:
    return _all(service.reorder(int(user["sub"]), body.ids))


@router.post("/restore-sectors", response_model=WatchlistGroupsOut)
def restore_sectors(user=Depends(get_current_user)) -> WatchlistGroupsOut:
    """Put back any deleted sector list, while there is room under 20."""
    return _all(service.restore_sectors(int(user["sub"])))
