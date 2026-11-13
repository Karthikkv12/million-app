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
    from optionflow.modules.flow.router import history_router, router, stream_router
    return [router, stream_router, history_router]


def _watchlist() -> List[APIRouter]:
    from optionflow.modules.watchlist.router import router
    return [router]


def _watchlists() -> List[APIRouter]:
    from optionflow.modules.watchlists.router import router
    return [router]


def _portfolio() -> List[APIRouter]:
    from optionflow.modules.portfolio.router import accounts_router, router
    return [router, accounts_router]


def _budget() -> List[APIRouter]:
    from optionflow.modules.budget.router import router
    return [router]


def _catalyst() -> List[APIRouter]:
    from optionflow.modules.catalyst.router import router
    return [router]


def _unusual() -> List[APIRouter]:
    from optionflow.modules.unusual.router import router
    return [router]


def _hedge() -> List[APIRouter]:
    from optionflow.modules.hedge.reports import router as reports_router
    from optionflow.modules.hedge.router import broker_router, router, stream_router
    return [router, stream_router, broker_router, reports_router]


def _pulse() -> List[APIRouter]:
    from optionflow.modules.pulse.router import alerts_router, paper_router
    return [alerts_router, paper_router]


def _strategy() -> List[APIRouter]:
    from optionflow.modules.strategy.router import router
    return [router]


def _insight() -> List[APIRouter]:
    from optionflow.modules.insight.router import router
    return [router]


def _ai() -> List[APIRouter]:
    from optionflow.modules.ai.router import router
    return [router]


def _risk() -> List[APIRouter]:
    from optionflow.modules.risk.router import router
    return [router]


def _notify() -> List[APIRouter]:
    from optionflow.modules.notify.router import router
    return [router]


MODULES: Dict[str, Callable[[], List[APIRouter]]] = {
    "auth": _auth,
    "market": _market,
    "flow": _flow,
    "watchlist": _watchlist,
    "watchlists": _watchlists,  # named lists (up to 20), seeded one per sector
    "catalyst": _catalyst,
    "unusual": _unusual,
    "ai": _ai,                 # off by default; the chat UI is hidden for now
    "portfolio": _portfolio,
    "budget": _budget,
    "hedge": _hedge,
    "notify": _notify,          # phone notifications (Web Push) for the hedge desk
    "strategy": _strategy,      # the owner's options strategy (drives the hedge desk's actions)
    "pulse": _pulse,            # server-side price alerts + paper trades for the Pulse chart (C-98)
    "insight": _insight,        # drawdown / spike series and the LEAPS score
    "risk": _risk,              # volatility targeting and factor exposure of the synced book (Hedge tabs)
}
