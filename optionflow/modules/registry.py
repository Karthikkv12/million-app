"""optionflow/modules/registry.py — every feature module and its routers.

ENABLED_MODULES (settings) picks which are mounted. Routers are imported
lazily, so a disabled module's code is never loaded by the app.
"""
from __future__ import annotations

from typing import Callable, Dict, List

from fastapi import APIRouter


def _auth() -> List[APIRouter]:
    from optionflow.modules.auth.router import admin_router, router
    return [router, admin_router]


def _market() -> List[APIRouter]:
    from optionflow.modules.market.router import router
    return [router]


def _flow() -> List[APIRouter]:
    from optionflow.modules.flow.router import router
    return [router]


def _watchlist() -> List[APIRouter]:
    from optionflow.modules.watchlist.router import router
    return [router]


def _portfolio() -> List[APIRouter]:
    # Moves into optionflow/modules/portfolio in plan step 4b.
    from backend_api.routers.portfolio import router as portfolio
    from backend_api.routers.trades import router as accounts
    return [portfolio, accounts]


def _budget() -> List[APIRouter]:
    # Moves into optionflow/modules/budget in plan step 4b.
    from backend_api.routers.budget import router
    return [router]


MODULES: Dict[str, Callable[[], List[APIRouter]]] = {
    "auth": _auth,
    "market": _market,
    "flow": _flow,
    "watchlist": _watchlist,
    "portfolio": _portfolio,
    "budget": _budget,
}
