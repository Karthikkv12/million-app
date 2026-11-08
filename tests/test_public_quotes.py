"""Public.com as the default price source (quotes, last prices, watchlist prices), Yahoo as fallback."""
import json

import httpx
import pytest

from optionflow.modules.hedge import service as hedge
from optionflow.modules.market import service as market
from optionflow.providers import market_data
from optionflow.providers.market_data import PublicFirstMarketData, RateLimitGate
from optionflow.providers.public import PublicClient, PublicOptionChains, PublicQuotes, normalize_quote


def _q(symbol, typ="EQUITY", last="101.5", prev="100", volume=1000, outcome="SUCCESS"):
    """Shape copied from a real Public quotes response (AAPL / SPX, 2026-11-07)."""
    return {"instrument": {"symbol": symbol, "type": typ}, "outcome": outcome, "last": last,
            "bid": None, "ask": None, "volume": volume, "previousClose": prev,
            "oneDayChange": {"change": "1.5", "percentChange": "1.5"}}


class FakePublic:
    def __init__(self):
        self.quote_requests = []          # instruments per /quotes request
        self.unknown = {"ZZZZQ"}
        self.fail = None                  # status code for the next /quotes request

    def handler(self, req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if path.endswith("/access-tokens"):
            return httpx.Response(200, json={"accessToken": "tok"})
        if path.endswith("/trading/account"):
            return httpx.Response(200, json={"accounts": [{"accountId": "A", "accountType": "BROKERAGE",
                                                           "optionsLevel": "LEVEL_3"}]})
        if path.endswith("/quotes"):
            if self.fail:
                code, self.fail = self.fail, None
                return httpx.Response(code, json={})
            insts = json.loads(req.content)["instruments"]
            self.quote_requests.append(insts)
            return httpx.Response(200, json={"quotes": [
                _q(i["symbol"], i["type"], last=None, prev=None, volume=None, outcome="UNKNOWN")
                if i["symbol"] in self.unknown else _q(i["symbol"], i["type"]) for i in insts]})
        return httpx.Response(404, json={})


class FakeYahoo:
    name = "yfinance"

    def __init__(self):
        self.gate = RateLimitGate()
        self.calls = []

    def quote(self, symbol):
        self.calls.append(("quote", symbol))
        return {"symbol": symbol, "price": 1.0, "prev_close": 1.0, "change": 0.0, "change_pct": 0.0}

    def last_price(self, symbol):
        self.calls.append(("last_price", symbol))
        return 2.0

    def watchlist_row(self, symbol):
        self.calls.append(("watchlist_row", symbol))
        return {"symbol": symbol, "name": symbol, "price": 1.0, "prev_close": 1.0, "change": 0.0,
                "change_pct": 0.0, "volume": 10, "avg_volume": 500, "rel_volume": 0.02,
                "pe_ratio": 20.0, "error": None}


@pytest.fixture
def setup(monkeypatch):
    fake = FakePublic()
    gate = RateLimitGate(first=60, maximum=900, source="Public.com")
    client = PublicClient("secret", transport=httpx.MockTransport(fake.handler), gate=gate, min_gap=0)
    yahoo = FakeYahoo()
    md = PublicFirstMarketData(PublicOptionChains(client), yahoo, PublicQuotes(client))
    monkeypatch.setattr(market_data, "_override", md)
    market.clear_caches()
    hedge.CACHE.clear()
    return fake, yahoo, md


def test_normalize_quote_real_shape():
    q = normalize_quote("AAPL", {**_q("AAPL", last="342.7937", prev="344.17", volume=44703806)})
    assert q == {"symbol": "AAPL", "price": 342.7937, "prev_close": 344.17, "change": -1.3763,
                 "change_pct": -0.3999, "volume": 44703806}
    assert normalize_quote("X", _q("X", outcome="UNKNOWN")) is None
    assert normalize_quote("X", {**_q("X", last=None), "bid": "9", "ask": "11"})["price"] == 10.0


def test_quote_and_last_price_come_from_public(setup):
    fake, yahoo, md = setup
    assert md.quote("KO") == {"symbol": "KO", "price": 101.5, "prev_close": 100.0, "change": 1.5, "change_pct": 1.5}
    assert md.last_price("^SPX") == 101.5
    assert fake.quote_requests[-1] == [{"symbol": "SPX", "type": "INDEX"}]
    assert yahoo.calls == []


def test_last_prices_one_request_and_yahoo_for_the_rest(setup):
    fake, yahoo, md = setup
    prices = md.last_prices(["KO", "aapl", "ZZZZQ", "VOD.L"])
    assert prices == {"KO": 101.5, "aapl": 101.5, "ZZZZQ": 2.0, "VOD.L": 2.0}
    assert len(fake.quote_requests) == 1 and len(fake.quote_requests[0]) == 3   # .L never sent to Public
    assert yahoo.calls == [("last_price", "ZZZZQ"), ("last_price", "VOD.L")]


def test_quotes_cached_for_a_second(setup):
    fake, _, md = setup
    md.last_prices(["KO", "PEP"])
    md.last_price("KO")
    md.quote("PEP")
    assert len(fake.quote_requests) == 1


@pytest.mark.parametrize("status", [500, 429])
def test_falls_back_to_yahoo_when_public_fails(setup, status):
    fake, yahoo, md = setup
    fake.fail = status
    assert md.quote("KO")["price"] == 1.0
    assert ("quote", "KO") in yahoo.calls


def test_market_quotes_endpoint_batches(setup):
    fake, yahoo, _ = setup
    out = market.quotes("KO,PEP,ZZZZQ")
    assert [q["price"] for q in out] == [101.5, 101.5, 1.0]
    assert len(fake.quote_requests) == 1 and yahoo.calls == [("quote", "ZZZZQ")]


def test_watchlist_rows_live_prices_over_cached_fundamentals(setup):
    fake, yahoo, _ = setup
    row = market.watchlist_rows("KO")[0]
    assert row["price"] == 101.5 and row["prev_close"] == 100.0 and row["change_pct"] == 1.5
    assert row["volume"] == 1000 and row["rel_volume"] == 2.0 and row["pe_ratio"] == 20.0
    market.watchlist_rows("KO")
    assert yahoo.calls == [("watchlist_row", "KO")]          # fundamentals cached; price refetched live


def test_live_quote_skips_the_60s_cache(setup):
    assert market.live_quote("KO") == {"symbol": "KO", "price": 101.5, "from_cache": False}


def test_hedge_prefetch_is_one_request(setup):
    fake, _, _ = setup
    hedge.prefetch_spots(["KO", "PEP", "AAPL"])
    assert [hedge._spot(s) for s in ("KO", "PEP", "AAPL")] == [101.5] * 3
    assert len(fake.quote_requests) == 1
