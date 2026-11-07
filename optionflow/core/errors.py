"""optionflow/core/errors.py — domain errors and the API error shape.

Services raise these instead of HTTP exceptions, so they stay usable outside
FastAPI. The API turns them (and FastAPI's own errors) into:

  /api/v1/*      {"error": {"code": "not_found", "message": "User not found"}}
  legacy paths   {"detail": "User not found"}   (what the current website reads)
"""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

V1_PREFIX = "/api/v1"


class AppError(Exception):
    status_code = 400
    code = "bad_request"

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class BadRequest(AppError):
    status_code, code = 400, "bad_request"


class Unauthorized(AppError):
    status_code, code = 401, "unauthorized"


class Forbidden(AppError):
    status_code, code = 403, "forbidden"


class NotFound(AppError):
    status_code, code = 404, "not_found"


class Conflict(AppError):
    status_code, code = 409, "conflict"


class Unprocessable(AppError):
    status_code, code = 422, "unprocessable"


class RateLimited(AppError):
    status_code, code = 429, "rate_limited"


class ServerError(AppError):
    status_code, code = 500, "server_error"


_CODES = {400: "bad_request", 401: "unauthorized", 403: "forbidden", 404: "not_found",
          405: "method_not_allowed", 409: "conflict", 422: "unprocessable", 429: "rate_limited"}


def _respond(request: Request, status: int, code: str, message, headers=None) -> JSONResponse:
    if request.url.path.startswith(V1_PREFIX):
        return JSONResponse({"error": {"code": code, "message": message}}, status_code=status, headers=headers)
    return JSONResponse({"detail": message}, status_code=status, headers=headers)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError):
        return _respond(request, exc.status_code, exc.code, exc.message)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException):
        code = _CODES.get(exc.status_code, "server_error" if exc.status_code >= 500 else "error")
        return _respond(request, exc.status_code, code, exc.detail, getattr(exc, "headers", None))

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError):
        if request.url.path.startswith(V1_PREFIX):
            first = exc.errors()[0] if exc.errors() else {}
            where = ".".join(str(p) for p in first.get("loc", []) if p != "body")
            msg = f"{where}: {first.get('msg', 'invalid request')}" if where else first.get("msg", "invalid request")
            return JSONResponse({"error": {"code": "invalid_request", "message": msg}}, status_code=422)
        from fastapi.encoders import jsonable_encoder
        return JSONResponse({"detail": jsonable_encoder(exc.errors())}, status_code=422)
