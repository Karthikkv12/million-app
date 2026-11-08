"""Yahoo rate-limit handling (coordination C-5 part B)."""
import time
from datetime import date, timedelta

import pandas as pd
import pytest

from optionflow.modules.flow import service as flow_service
from optionflow.modules.flow.gamma import GEXResult
from optionflow.providers import yahoo
from optionflow.providers.market_data import MarketDataRateLimited, RateLimitGate


@pytest.fixture(autouse=True)
def fresh_gate():
    yahoo.GATE.reset()
    yahoo._chain_cache.clear()
    flow_service.clear_cache()
    yield
    yahoo.GATE.reset()
    yahoo._chain_cache.clear()
    flow_service.clear_cache()


class _FakeTicker:
    """Counts calls; raises Yahoo's rate-limit error when `limited` is set."""
    calls = 0
    limited = False

    def __init__(self, symbol):
        self.symbol = symbol

    def _hit(self):
        type(self).calls += 1
        if type(self).limited:
            raise yahoo.YFRateLimitError()

    @property
    def fast_info(self):
        self._hit()
        return type("F", (), {"last_price": 100.0, "previous_close": 99.0})()

    @property
    def options(self):
        self._hit()
        today = date.today()
        return [(today + timedelta(days=d)).isoformat() for d in (1, 8, 15, 30, 59, 61, 90, 120)] + \
               [(today + timedelta(days=d)).isoformat() for d in range(2, 30, 2)]

    def option_chain(self, exp):
        self._hit()
        calls = pd.DataFrame([{"strike": 100.0, "openInterest": 10, "impliedVolatility": 0.3, "bid": 1.0, "ask": 1.2, "volume": 5}])
        return type("C", (), {"calls": calls, "puts": calls.iloc[0:0]})()

    def history(self, **kw):
        self._hit()
        return pd.DataFrame()


@pytest.fixture
def fake_yf(monkeypatch):
    _FakeTicker.calls, _FakeTicker.limited = 0, False
    monkeypatch.setattr(yahoo.yf, "Ticker", _FakeTicker)
    return _FakeTicker


def test_gate_doubles_to_30_minutes_and_resets_on_success(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr("optionflow.providers.market_data._time.monotonic", lambda: clock[0])
    g = RateLimitGate()
    delays = []
    for _ in range(6):
        g.trip(); delays.append(round(g.remaining())); clock[0] += g.remaining() + 1
    assert delays == [120, 240, 480, 960, 1800, 1800]
    g.trip()
    g.trip()                                    # tripping again while blocked doesn't extend
    assert round(g.remaining()) == 1800
    clock[0] += 1801
    g.ok()
    g.trip()
    assert round(g.remaining()) == 120          # a success reset the delay


def test_rate_limit_trips_gate_and_stops_all_yahoo_calls(fake_yf):
    md = yahoo.YahooMarketData()
    fake_yf.limited = True
    with pytest.raises(MarketDataRateLimited):
        md.quote("SPY")                         # quote() catches errors itself; the gate still trips
    assert yahoo.GATE.blocked()
    before = fake_yf.calls
    fake_yf.limited = False
    for call in (lambda: md.last_price("SPY"), lambda: md.option_chain("SPY"), lambda: md.raw_ticker("SPY").fast_info,
                 lambda: md.stock_info("SPY"), lambda: md.search("spy", 5)):
        with pytest.raises(MarketDataRateLimited):
            call()
    assert fake_yf.calls == before              # nothing reached Yahoo while backing off


def test_guarded_raw_ticker_trips_on_attribute_access(fake_yf):
    t = yahoo.YahooMarketData().raw_ticker("SPY")
    fake_yf.limited = True
    with pytest.raises(MarketDataRateLimited):
        t.option_chain("2026-11-20")
    assert yahoo.GATE.blocked()


def test_option_chain_limits_expiries_and_caches_each_chain(fake_yf):
    md = yahoo.YahooMarketData()
    chain = md.option_chain("SPY")
    exps = sorted(set(chain.rows["expiry"]))
    assert len(exps) == yahoo.MAX_CHAIN_EXPIRIES
    assert max(pd.to_datetime(exps)) <= pd.Timestamp(date.today() + timedelta(days=yahoo.MAX_CHAIN_DTE))
    first = fake_yf.calls
    md.option_chain("SPY")                      # chains come from the 5-minute cache
    assert fake_yf.calls - first == 2           # only fast_info + options again


def test_gex_serves_stale_result_while_rate_limited(db_engine_and_session, monkeypatch):
    good = GEXResult(symbol="SPY", spot=500.0, expiries=[], as_of="2026-11-08T09:01:00+00:00")
    monkeypatch.setattr(flow_service, "compute_gamma_exposure", lambda s: good)
    assert flow_service.get_gex("SPY").stale is False

    def limited(s):
        raise MarketDataRateLimited(120)
    monkeypatch.setattr(flow_service, "compute_gamma_exposure", limited)
    stale = flow_service.get_gex("SPY", max_age=0)          # cache expired, refresh rate-limited
    assert stale.stale is True and stale.as_of == "2026-11-08T09:01:00+00:00" and stale.spot == 500.0
    payload = flow_service.gex_payload(stale)
    assert payload["stale"] is True and payload["as_of"] == good.as_of
    with pytest.raises(MarketDataRateLimited):
        flow_service.get_gex("QQQ")                          # nothing cached: 503


def test_rate_limited_api_responses(db_engine_and_session, monkeypatch, fake_market_data):
    from fastapi.testclient import TestClient
    from optionflow.main import app
    from optionflow.modules.auth import service as auth
    auth.create_user("rl", "RateLimit12345")
    c = TestClient(app)
    h = {"Authorization": "Bearer " + c.post("/api/v1/auth/login", json={"username": "rl", "password": "RateLimit12345"}).json()["access_token"]}

    def limited(s):
        raise MarketDataRateLimited(300)
    monkeypatch.setattr(flow_service, "compute_gamma_exposure", limited)
    r = c.get("/api/v1/options/gamma-exposure/SPY", headers=h)
    assert r.status_code == 503 and r.json()["error"]["code"] == "unavailable" and "about 5 min" in r.json()["error"]["message"]
    assert c.get("/options/gamma-exposure/SPY", headers=h).json() == {"detail": "Yahoo Finance is rate-limiting requests; try again in about 5 min"}


def test_poller_makes_no_calls_while_backing_off(monkeypatch):
    from optionflow.workers import gex_poller
    calls = []
    monkeypatch.setattr(flow_service, "active_symbols", lambda: ["SPY"])
    monkeypatch.setattr(flow_service, "refresh_gex", lambda s: calls.append(s))
    monkeypatch.setattr(gex_poller, "chains_rate_limited", lambda: True)
    gex_poller.poll_once()
    assert calls == []
    assert gex_poller.POLL_INTERVAL == 120 and flow_service.GEX_CACHE_TTL == 120


def test_catalyst_and_scanner_honour_backoff_and_do_not_cache(monkeypatch):
    from optionflow.modules.catalyst import service as catalyst
    from optionflow.modules.unusual import service as unusual
    monkeypatch.setattr("optionflow.providers.market_data.get_market_data", lambda: type("M", (), {"gate": yahoo.GATE})())
    yahoo.GATE.trip()
    with pytest.raises(MarketDataRateLimited):
        catalyst.get_catalysts("AAPL")
    with pytest.raises(MarketDataRateLimited):
        unusual.scan(["AAPL"])
    assert "AAPL" not in catalyst._cache and not any(k[0] == "AAPL" for k in unusual._cache)
