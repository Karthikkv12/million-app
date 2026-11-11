"""optionflow/main.py — builds the FastAPI app.

Every module listed in ENABLED_MODULES is mounted twice:
  /api/v1/...   the versioned API (website, phone app, scripts)
  /...          legacy paths the current website still calls (hidden from the docs)

Startup creates any missing tables and, when the flow module is on, starts
the GEX poller.
"""
from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from optionflow.core.db import get_session, init_db
from optionflow.core.errors import V1_PREFIX, install_error_handlers
from optionflow.core.settings import Settings, get_settings
from optionflow.modules.registry import MODULES

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("optionflow.main")
_req_logger = logging.getLogger("optionflow.requests")


def enabled_modules(settings: Settings) -> List[str]:
    requested = settings.enabled_modules_list
    for unknown in sorted(set(requested) - set(MODULES)):
        logger.warning("ENABLED_MODULES lists unknown module %r (known: %s)", unknown, ", ".join(MODULES))
    return [m for m in requested if m in MODULES]


def health() -> Dict[str, Any] | JSONResponse:
    """Liveness + readiness: SELECT 1 on the database. 503 if it is unreachable."""
    status: Dict[str, str] = {}
    session = get_session()
    try:
        session.execute(text("SELECT 1"))
        status["optionflow"] = "ok"
    except Exception as exc:
        logger.error("Health check failed: %s", exc)
        status["optionflow"] = "unreachable"
    finally:
        session.close()
    down = any(v != "ok" for v in status.values())
    payload = {"status": "unhealthy" if down else "healthy", "databases": status}
    return JSONResponse(status_code=503, content=payload) if down else payload


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    settings = settings or get_settings()
    modules = enabled_modules(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        init_db()  # creates any missing tables, including net_flow_snapshots
        if "flow" in modules:
            from optionflow.workers import gex_poller
            gex_poller.start()
        if "notify" in modules and "hedge" in modules:
            from optionflow.modules.notify import worker as notify_worker
            notify_worker.start()        # phone notifications: no-op until PUSH_VAPID_* keys are set
        if "strategy" in modules and "notify" in modules:
            from optionflow.modules.strategy import worker as scanner_worker
            scanner_worker.start()       # market scanner for users who turned its notifications on
        logger.info("OptionFlow API started — modules: %s", ", ".join(modules))
        yield

    app = FastAPI(
        title="OptionFlow API",
        version="3.0.0",
        description="Dealer positioning (GEX), options flow and market data. Versioned under /api/v1.",
        lifespan=lifespan,
    )
    app.state.enabled_modules = modules
    install_error_handlers(app)

    origins = settings.cors_origins
    wildcard = origins == ["*"]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=not wildcard,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        t0 = time.perf_counter()
        response = await call_next(request)
        _req_logger.info("%s %s → %d  %.1fms", request.method, request.url.path,
                         response.status_code, (time.perf_counter() - t0) * 1000)
        return response

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error on %s %s: %s", request.method, request.url.path, exc)
        if request.url.path.startswith(V1_PREFIX):
            return JSONResponse({"error": {"code": "server_error", "message": "Internal server error"}}, status_code=500)
        return JSONResponse({"detail": "Internal server error"}, status_code=500)

    for name in modules:
        for router in MODULES[name]():
            app.include_router(router, prefix=V1_PREFIX)
            app.include_router(router, include_in_schema=False)   # legacy alias

    app.add_api_route(V1_PREFIX + "/health", health, methods=["GET"], tags=["meta"], response_model=None)
    app.add_api_route("/health", health, methods=["GET"], include_in_schema=False, response_model=None)
    return app


app = create_app()
