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
    gate = RateLimitGate(first=60, maximum=900, source="Public.com")
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
                     "iv": 0.6437, "mid": 8.2, "gamma": 0.0287, "T": 0.02,
                     "bid": 7.6, "ask": 8.8, "last": 8.19}]


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
    assert instrument_for("VOD.L") is None
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
        chains.option_chain("VOD.L")
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
    assert ChainFallbackMarketData(chains, yahoo).option_chain("VOD.L").source == "yfinance"


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


# ── error messages and poll interval ─────────────────────────────────────────

class LimitedYahoo(FakeYahoo):
    def option_chain(self, symbol):
        self.calls += 1
        raise MarketDataRateLimited(300)


def test_both_failing_names_both_sources(public):
    fake, chains = public
    fake.status["/access-tokens"] = 500
    with pytest.raises(MarketDataRateLimited) as e:
        ChainFallbackMarketData(chains, LimitedYahoo()).option_chain("KO")
    msg = str(e.value)
    assert "Public.com is unavailable" in msg and "Yahoo Finance is rate-limiting" in msg and "5 min" in msg


def test_both_rate_limited_message(public):
    fake, chains = public
    fake.status["/quotes"] = 429
    with pytest.raises(MarketDataRateLimited) as e:
        ChainFallbackMarketData(chains, LimitedYahoo()).option_chain("KO")
    assert "Public.com is rate-limiting and Yahoo Finance is rate-limiting" in str(e.value)


def test_public_429_message_names_public(public):
    fake, chains = public
    fake.status["/quotes"] = 429
    with pytest.raises(MarketDataRateLimited, match="^Public.com is rate-limiting"):
        chains.option_chain("KO")


def test_yahoo_message_unchanged():
    assert str(MarketDataRateLimited(120)).startswith("Yahoo Finance is rate-limiting")


def test_poll_interval_follows_chain_source(public, monkeypatch):
    from optionflow.workers import gex_poller
    _, chains = public
    monkeypatch.setattr(market_data, "_override", FakeYahoo())
    assert gex_poller.poll_interval() == 120                 # Yahoo only
    monkeypatch.setattr(market_data, "_override", ChainFallbackMarketData(chains, FakeYahoo()))
    assert gex_poller.poll_interval() == gex_poller.REALTIME_POLL_INTERVAL == 10   # Public serving
    chains.gate.trip()
    assert gex_poller.poll_interval() == 120                 # Public backing off → Yahoo pace
    from optionflow.modules.flow import service
    assert service.GEX_CACHE_TTL >= gex_poller.POLL_INTERVAL  # streams never trigger extra fetches


def test_chain_rows_carry_quotes_for_flow_sides():
    """The GEX chain must keep bid / ask / last: flow.traded.side files each refresh's volume by them, and without
    them every print was 'mid' (all bought/sold zero on live, 2026-11-13)."""
    from optionflow.modules.flow import traded
    rows = parse_contracts("2026-11-20", {"calls": [_contract(92)], "puts": None}, 0.1)
    df = pd.DataFrame(rows, columns=CHAIN_COLUMNS)
    assert (df.loc[0, "bid"], df.loc[0, "ask"], df.loc[0, "last"]) == (7.60, 8.80, 8.19)
    (key, vol, prem, bid, ask, last), = traded.contracts(df)
    assert traded.side(bid, ask, last) == "mid"          # 8.19 is mid-spread
    assert traded.side(bid, ask, 8.70) == "bought"
