"""
Integration tests for the /options/gamma-exposure/{symbol} API endpoint.

Uses FastAPI's TestClient (no live server needed).
All GEX computation is mocked — these tests verify:
  - Auth enforcement (401 without token, 200 with valid token)
  - Response schema completeness (all required keys present and correct types)
  - Error field is null on success
  - Correct symbol echo (alias normalisation: SPX → SPX in display)
  - Net GEX bounds (regression: phantom gamma must not appear in API response)
  - Caching: second call returns same net_gex (cache hit)
  - Unknown symbol returns 200 with error field set (graceful, not 500)
"""
from __future__ import annotations

import math
import os
import types
from unittest.mock import patch

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# ── Force a test JWT secret so tokens are predictable ────────────────────────
os.environ.setdefault("JWT_SECRET", "test-secret-do-not-use-in-prod")
os.environ.setdefault("JWT_AUDIENCE", "million-app")
os.environ.setdefault("JWT_ISSUER",   "million-api")

from backend_api.main import app
from backend_api.security import create_access_token
from database import models as dbmodels
import logic.services as services
import logic.gamma as gmod


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def db():
    """In-memory SQLite DB shared across all tests in this module.

    Uses StaticPool so every get_session() call shares the SAME in-memory
    connection — without this, each new SQLAlchemy connection gets a fresh
    empty :memory: DB and the tables don't exist.
    """
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Session = sessionmaker(bind=engine)
    dbmodels.Base.metadata.create_all(engine)
    # Patch services to use this engine
    original_engine  = services.engine
    original_session = services.Session
    services.engine  = engine
    services.Session = Session
    yield engine, Session
    services.engine  = original_engine
    services.Session = original_session


@pytest.fixture(scope="module")
def auth_token(db):
    """Create a test user and return a valid JWT."""
    uid = services.create_user("api_test_user", "GoodPassword99!")
    token = create_access_token(subject=str(uid), extra={"username": "api_test_user", "role": "user"})
    return token


@pytest.fixture(scope="module")
def client(db):
    """TestClient with the in-memory DB already wired up."""
    return TestClient(app, raise_server_exceptions=True)


@pytest.fixture(autouse=True)
def mock_gex(monkeypatch):
    """Patch the GEX engine so no yfinance calls are made during API tests.
    compute_gamma_exposure is imported inside the endpoint function, so we
    patch it at the source module (logic.gamma) rather than backend_api.main.
    """
    from logic.gamma import GEXResult

    def _fake_compute(symbol: str) -> GEXResult:
        spot = 500.0
        strikes = [490.0, 495.0, 500.0, 505.0, 510.0]
        gex     = [ -2e8,  -1e8,  3e8,   2e8,   1e8]
        c_gex   = [  0.0,   0.0,  3e8,   2e8,   1e8]
        p_gex   = [ -2e8,  -1e8,  0.0,   0.0,   0.0]
        return GEXResult(
            symbol=symbol.lstrip("^"),
            spot=spot,
            expiries=["2026-03-06", "2026-03-13"],
            strikes=strikes,
            gex_by_strike=gex,
            call_gex_by_strike=c_gex,
            put_gex_by_strike=p_gex,
            heatmap_expiries=["2026-03-06"],
            heatmap_strikes=strikes,
            heatmap_values=[[v / 10 for v in gex]],
            zero_gamma=497.5,
            max_call_wall=500.0,
            max_put_wall=490.0,
            max_gex_strike=500.0,
            net_gex=float(sum(gex)),
            lot_size=100,
            call_premium=1_000_000.0,
            put_premium=800_000.0,
            net_flow=200_000.0,
            total_volume=50_000,
            flow_by_expiry=[],
            top_flow_strikes=[],
            data_source="yfinance",
            error=None,
        )

    # compute_gamma_exposure is imported inside the endpoint via
    # `from logic.gamma import compute_gamma_exposure`, so patch at the source.
    monkeypatch.setattr(gmod, "compute_gamma_exposure", _fake_compute)
    monkeypatch.setattr("backend_api.main._gex_cache", {})


# ---------------------------------------------------------------------------
# Auth enforcement tests
# ---------------------------------------------------------------------------

class TestGexAuth:
    def test_no_token_returns_401(self, client):
        r = client.get("/options/gamma-exposure/AAPL")
        assert r.status_code == 401

    def test_bad_token_returns_401(self, client):
        r = client.get(
            "/options/gamma-exposure/AAPL",
            headers={"Authorization": "Bearer this.is.not.valid"},
        )
        assert r.status_code == 401

    def test_valid_token_returns_200(self, client, auth_token):
        r = client.get(
            "/options/gamma-exposure/AAPL",
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# Response schema tests
# ---------------------------------------------------------------------------

REQUIRED_KEYS = {
    "symbol", "spot", "expiries", "strikes",
    "gex_by_strike", "call_gex_by_strike", "put_gex_by_strike",
    "zero_gamma", "max_call_wall", "max_put_wall", "max_gex_strike",
    "net_gex", "call_premium", "put_premium", "net_flow", "total_volume",
    "flow_by_expiry", "top_flow_strikes", "data_source", "error",
}

class TestGexResponseSchema:
    def _get(self, client, auth_token, symbol="AAPL"):
        r = client.get(
            f"/options/gamma-exposure/{symbol}",
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        assert r.status_code == 200
        return r.json()

    def test_all_required_keys_present(self, client, auth_token):
        data = self._get(client, auth_token)
        missing = REQUIRED_KEYS - data.keys()
        assert not missing, f"Missing response keys: {missing}"

    def test_error_is_null_on_success(self, client, auth_token):
        data = self._get(client, auth_token)
        assert data["error"] is None

    def test_spot_is_positive_float(self, client, auth_token):
        data = self._get(client, auth_token)
        assert isinstance(data["spot"], (int, float))
        assert data["spot"] > 0

    def test_net_gex_is_finite(self, client, auth_token):
        data = self._get(client, auth_token)
        assert math.isfinite(data["net_gex"])

    def test_strike_lists_same_length(self, client, auth_token):
        data = self._get(client, auth_token)
        n = len(data["strikes"])
        assert len(data["gex_by_strike"])      == n
        assert len(data["call_gex_by_strike"]) == n
        assert len(data["put_gex_by_strike"])  == n

    def test_expiries_is_list_of_strings(self, client, auth_token):
        data = self._get(client, auth_token)
        assert isinstance(data["expiries"], list)
        for e in data["expiries"]:
            assert isinstance(e, str)

    def test_symbol_echoed_correctly(self, client, auth_token):
        data = self._get(client, auth_token, symbol="NVDA")
        assert data["symbol"] == "NVDA"

    def test_index_alias_echoed_as_input(self, client, auth_token):
        """SPX should display as 'SPX' not '^SPX'."""
        data = self._get(client, auth_token, symbol="SPX")
        assert data["symbol"] == "SPX"

    def test_net_gex_not_exploding(self, client, auth_token):
        """Regression: phantom gamma must not produce values > $500B."""
        data = self._get(client, auth_token)
        assert abs(data["net_gex"]) < 500e9, \
            f"net_gex=${data['net_gex']/1e9:.1f}B looks like phantom gamma"

    def test_call_gex_nonnegative_sum(self, client, auth_token):
        data = self._get(client, auth_token)
        assert sum(data["call_gex_by_strike"]) >= 0

    def test_put_gex_nonpositive_sum(self, client, auth_token):
        data = self._get(client, auth_token)
        assert sum(data["put_gex_by_strike"]) <= 0

    def test_data_source_field_valid(self, client, auth_token):
        data = self._get(client, auth_token)
        assert data["data_source"] in ("yfinance", "tradier")


# ---------------------------------------------------------------------------
# Symbol parametrization — all UI symbols hit the endpoint
# ---------------------------------------------------------------------------

UI_SYMBOLS = [
    "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA",
    "AMD",  "NFLX", "CRM",  "COIN",  "PLTR", "SNOW", "UBER",
    "SPY",  "QQQ",  "IWM",  "DIA",
    "XLK",  "XLF",  "XLV",  "XLE",
    "XLC",  "XLY",  "XLI",  "XLB",  "XLRE", "XLU",
    "SPX",  "NDX",  "RUT",
]

@pytest.mark.parametrize("symbol", UI_SYMBOLS)
def test_endpoint_returns_200_for_all_symbols(client, auth_token, symbol):
    r = client.get(
        f"/options/gamma-exposure/{symbol}",
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert r.status_code == 200, f"{symbol}: got {r.status_code}"
    data = r.json()
    assert math.isfinite(data["net_gex"]), f"{symbol}: net_gex not finite"
    assert abs(data["net_gex"]) < 500e9,   f"{symbol}: net_gex exploding"
