"""Public.com option chains for GEX, with Yahoo as the fallback."""
from datetime import date, timedelta

import httpx
import pandas as pd
import pytest

from optionflow.modules.flow import gamma
from optionflow.providers import market_data
from optionflow.providers.market_data import (
    CHAIN_COLUMNS,
    ChainFallbackMarketData,
    MarketDataRateLimited,
    OptionChain,
    RateLimitGate,
)
from optionflow.providers.public import (
    PublicClient,
    PublicError,
    PublicOptionChains,
    instrument_for,
    parse_contracts,
)

ACCOUNTS = {"accounts": [
    {"accountId": "IRA1", "accountType": "TRADITIONAL_IRA", "optionsLevel": "NONE"},
    {"accountId": "CASH1", "accountType": "BROKERAGE", "optionsLevel": "NONE"},
    {"accountId": "OPT1", "accountType": "BROKERAGE", "optionsLevel": "LEVEL_3"},
]}


def _contract(strike, oi=100, gamma="0.0287", iv="0.6437", bid="7.60", ask="8.80", mid="8.2"):
    """Shape copied from a real Public option-chain response (KO, 2026-11-06)."""
    return {
        "instrument": {"symbol": f"KO261113C{int(strike * 1000):08d}", "type": "OPTION"},
        "outcome": "SUCCESS", "last": "8.19", "bid": bid, "ask": ask,
        "volume": 19, "openInterest": oi, "previousClose": "8.20",
        "optionDetails": {"greeks": {"delta": "0.8678", "gamma": gamma, "theta": "-0.1522",
                                     "vega": "0.0247", "rho": "0.0109", "impliedVolatility": iv},
                          "strikePrice": str(strike), "midPrice": mid},
    }


class FakePublic:
    """Routes Public API requests; records them. Set `status` to force an HTTP code."""

    def __init__(self):
        self.requests = []
        self.status = {}            # path suffix → status code to return once
        self.tokens = 0
        soon = (date.today() + timedelta(days=5)).isoformat()
        later = (date.today() + timedelta(days=12)).isoformat()
        far = (date.today() + timedelta(days=200)).isoformat()
        self.expirations = [soon, later, far]
        self.chains = {
            soon: {"calls": [_contract(100), _contract(105, oi=0)], "puts": [_contract(95, oi=50)]},
            later: {"calls": [_contract(110, oi=20)], "puts": []},
        }

    def handler(self, req: httpx.Request) -> httpx.Response:
        path = req.url.path
        self.requests.append((req.method, path, req.headers.get("authorization")))
        for suffix, code in list(self.status.items()):
            if path.endswith(suffix):
                del self.status[suffix]
                return httpx.Response(code, json={})
        if path.endswith("/access-tokens"):
            self.tokens += 1
            return httpx.Response(200, json={"accessToken": f"tok{self.tokens}"})
        if path.endswith("/trading/account"):
            return httpx.Response(200, json=ACCOUNTS)
        body = __import__("json").loads(req.content or b"{}")
        if path.endswith("/quotes"):
            return httpx.Response(200, json={"quotes": [
                {"instrument": body["instruments"][0], "outcome": "SUCCESS", "last": "101.5"}]})
        if path.endswith("/option-expirations"):
            return httpx.Response(200, json={"baseSymbol": body["instrument"]["symbol"],
                                             "expirations": self.expirations})
        if path.endswith("/option-chain"):
            return httpx.Response(200, json=self.chains.get(body["expirationDate"], {"calls": [], "puts": []}))
        return httpx.Response(404, json={})


@pytest.fixture
def public():
    fake = FakePublic()
    gate = RateLimitGate(first=60, maximum=900)
    client = PublicClient("secret", transport=httpx.MockTransport(fake.handler), gate=gate, min_gap=0)
    chains = PublicOptionChains(client)
    chains.gate = gate
    return fake, chains


class FakeYahoo:
    name = "yfinance"

    def __init__(self):
        self.gate = RateLimitGate()
        self.calls = 0

    def option_chain(self, symbol):
        self.calls += 1
        return OptionChain(50.0, pd.DataFrame([{"strike": 50.0, "expiry": "2099-01-01", "otype": "call",
                                                "oi": 10, "volume": 1, "iv": 0.3, "mid": 1.0,
                                                "gamma": float("nan"), "T": 0.1}], columns=CHAIN_COLUMNS))

    def quote(self, symbol):
        return {"symbol": symbol, "price": 1.0}


# ── parsing ──────────────────────────────────────────────────────────────────

def test_parse_contracts_real_shape():
    rows = parse_contracts("2026-11-13", {"calls": [_contract(88)], "puts": []}, 0.02)
    assert rows == [{"strike": 88.0, "expiry": "2026-11-13", "otype": "call", "oi": 100, "volume": 19,
                     "iv": 0.6437, "mid": 8.2, "gamma": 0.0287, "T": 0.02}]


def test_parse_contracts_filters_like_yahoo():
    rows = parse_contracts("x", {"calls": [
        _contract(0),                                   # no strike
        _contract(90, oi=0),                            # no open interest
        _contract(91, iv="0", bid="0", ask="0", mid="0"),   # phantom: no IV, no market
        _contract(92, gamma=None),                      # no feed gamma → NaN (Black-Scholes fills it)
        {**_contract(93), "outcome": "FAILURE"},
    ], "puts": None}, 0.1)
    assert [r["strike"] for r in rows] == [92.0]
    assert pd.isna(rows[0]["gamma"])


def test_instrument_mapping():
    assert instrument_for("spy") == {"symbol": "SPY", "type": "EQUITY"}
    assert instrument_for("^SPX") == {"symbol": "SPX", "type": "INDEX"}
    assert instrument_for("RELIANCE.NS") is None
    assert instrument_for("ES=F") is None


# ── client ───────────────────────────────────────────────────────────────────

def test_option_chain_from_public(public):
    fake, chains = public
    chain = chains.option_chain("KO")
    assert chain.source == "public" and chain.spot == 101.5
    assert sorted(chain.rows["strike"]) == [95.0, 100.0, 110.0]      # OI-0 dropped; 200-DTE expiry skipped
    assert list(chain.rows.columns) == CHAIN_COLUMNS
    # account auto-picked: first options-enabled BROKERAGE account
    assert any("/marketdata/OPT1/" in p for _, p, _ in fake.requests)
    assert all(a == "Bearer tok1" for m, p, a in fake.requests if "/marketdata/" in p)
    assert not any(p.endswith(fake.expirations[2]) for _, p, _ in fake.requests)


def test_token_refreshed_once_on_401(public):
    fake, chains = public
    chains.client.account_id()
    fake.status["/quotes"] = 401
    chains.option_chain("KO")
    assert fake.tokens == 2


def test_expirations_cached(public):
    fake, chains = public
    chains.option_chain("KO")
    chains.option_chain("KO")
    assert sum(p.endswith("/option-expirations") for _, p, _ in fake.requests) == 1


def test_429_trips_public_gate(public):
    fake, chains = public
    fake.status["/quotes"] = 429
    with pytest.raises(MarketDataRateLimited):
        chains.option_chain("KO")
    assert chains.gate.blocked()
    n = len(fake.requests)
    with pytest.raises(MarketDataRateLimited):
        chains.option_chain("KO")                       # refused locally, no request
    assert len(fake.requests) == n


def test_unsupported_symbol_raises_without_calls(public):
    fake, chains = public
    with pytest.raises(PublicError):
        chains.option_chain("RELIANCE.NS")
    assert fake.requests == []


# ── fallback ─────────────────────────────────────────────────────────────────

def test_fallback_uses_public_first(public):
    _, chains = public
    yahoo = FakeYahoo()
    md = ChainFallbackMarketData(chains, yahoo)
    assert md.option_chain("KO").source == "public"
    assert yahoo.calls == 0
    assert md.quote("KO")["price"] == 1.0                # everything else is Yahoo's
    assert md.gate is yahoo.gate


@pytest.mark.parametrize("status", [500, 403, 429])
def test_fallback_to_yahoo_on_public_failure(public, status):
    fake, chains = public
    fake.status["/access-tokens"] = status
    yahoo = FakeYahoo()
    chain = ChainFallbackMarketData(chains, yahoo).option_chain("KO")
    assert chain.source == "yfinance" and yahoo.calls == 1


def test_fallback_for_non_us_symbol(public):
    _, chains = public
    yahoo = FakeYahoo()
    assert ChainFallbackMarketData(chains, yahoo).option_chain("NIFTY.NS").source == "yfinance"


def test_chains_blocked_only_when_both_sources_are(public):
    _, chains = public
    yahoo = FakeYahoo()
    md = ChainFallbackMarketData(chains, yahoo)
    yahoo.gate.trip()
    assert not md.chains_blocked()                       # Public can still serve: poller keeps running
    chains.gate.trip()
    assert md.chains_blocked()


def test_gex_reports_serving_source(public, monkeypatch):
    _, chains = public
    md = ChainFallbackMarketData(chains, FakeYahoo())
    monkeypatch.setattr(market_data, "_override", md)
    result = gamma.compute_gamma_exposure("KO")
    assert result.data_source == "public" and result.spot == 101.5 and not result.error
    assert market_data.chains_rate_limited() is False


def test_default_provider_is_yahoo_without_secret(monkeypatch):
    from optionflow.core.settings import Settings, override_settings
    monkeypatch.setattr(market_data, "_default", None)
    with override_settings(Settings(_env_file=None, public_api_secret=None)):
        assert market_data.get_market_data().name == "yfinance"
    monkeypatch.setattr(market_data, "_default", None)
    with override_settings(Settings(_env_file=None, public_api_secret="s")):
        assert market_data.get_market_data().name == "public+yfinance"
