"""backend_api/main.py — Thin application factory.

All route logic lives in backend_api/routers/*.py.
Shared state (caches, poller, flow-DB helpers) lives in backend_api/state.py.
This module only:
  1. Loads .env
  2. Creates the FastAPI app and registers middleware, routers and exception handlers
  3. Runs DB init & starts background poller on startup
"""
from __future__ import annotations

import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from typing import Any, Callable, Coroutine, Dict

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from sqlalchemy import text

from database.models import (
    init_db,
    get_users_session,
    get_trades_session,
    get_budget_session,
    get_portfolio_session,
    get_markets_session,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("optionflow.main")

# ── Load .env ─────────────────────────────────────────────────────────────────

def _load_dotenv() -> None:
    env_path = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".env"))
    if not os.path.isfile(env_path):
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val

_load_dotenv()

# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def _lifespan(app: FastAPI):
    """Run startup tasks before yield; shutdown tasks after."""
    from .state import init_flow_db, background_poller

    init_db()
    init_flow_db()
    threading.Thread(target=background_poller, daemon=True, name="gex-poller").start()
    logger.info("OptionFlow API v2.2.0 started — GEX poller running")
    yield
    # (shutdown: nothing to clean up — poller is a daemon thread)


app = FastAPI(
    title="OptionFlow API",
    version="2.2.0",
    description="Option flow, portfolio, budget and market data API.",
    lifespan=_lifespan,
)

_cors_origins_raw = os.getenv("CORS_ALLOW_ORIGINS", "*")
_cors_origins = [o.strip() for o in _cors_origins_raw.split(",") if o.strip()]
_cors_is_wildcard = len(_cors_origins) == 1 and _cors_origins[0] == "*"
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=False if _cors_is_wildcard else True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Request logging middleware ────────────────────────────────────────────────
_req_logger = logging.getLogger("optionflow.requests")


@app.middleware("http")  # type: ignore[misc]
async def log_requests(
    request: Request,
    call_next: Callable[[Request], Coroutine[Any, Any, Response]],
) -> Response:
    t0 = time.perf_counter()
    response: Response = await call_next(request)
    ms = (time.perf_counter() - t0) * 1000
    _req_logger.info("%s %s → %d  %.1fms", request.method, request.url.path, response.status_code, ms)
    return response


# ── Global exception handler ──────────────────────────────────────────────────

@app.exception_handler(Exception)  # type: ignore[misc]
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception(
        "Unhandled error on %s %s: %s", request.method, request.url.path, exc
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


# ── Routers ───────────────────────────────────────────────────────────────────
from .routers import auth, trades, portfolio, budget, markets, admin, watchlist  # noqa: E402

app.include_router(auth.router)
app.include_router(trades.router)
app.include_router(portfolio.router)
app.include_router(budget.router)
app.include_router(markets.router)
app.include_router(admin.router)
app.include_router(watchlist.router)


# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/health", tags=["meta"], response_model=None)
def health() -> Dict[str, Any] | JSONResponse:
    """Liveness + readiness probe: pings all 5 SQLite databases.

    Returns 200 if every database responds to SELECT 1.
    Returns 503 if any database is unreachable, with per-DB status in the body.
    """
    _db_factories = {
        "users":     get_users_session,
        "trades":    get_trades_session,
        "budget":    get_budget_session,
        "portfolio": get_portfolio_session,
        "markets":   get_markets_session,
    }

    db_status: Dict[str, str] = {}
    any_down = False

    for name, factory in _db_factories.items():
        session = factory()
        try:
            session.execute(text("SELECT 1"))
            db_status[name] = "ok"
        except Exception as exc:
            logger.error("Health check failed for %s db: %s", name, exc)
            db_status[name] = "unreachable"
            any_down = True
        finally:
            session.close()

    overall = "unhealthy" if any_down else "healthy"
    payload: Dict[str, Any] = {"status": overall, "databases": db_status}

    if any_down:
        return JSONResponse(status_code=503, content=payload)
    return payload
