"""Public.com as the default price source (quotes, last prices, watchlist prices), Yahoo as fallback."""
import json

import httpx
import pytest

from optionflow.modules.hedge import service as hedge
from optionflow.modules.market import service as market
from optionflow.providers import market_data
from optionflow.providers.market_data import PublicFirstMarketData, RateLimitGate
from optionflow.providers.public import PublicClient, PublicOptionChains, PublicQuotes, normalize_quote


@pytest.fixture(autouse=True)
def _regular_hours_by_default(monkeypatch):
    """Quotes here are regular-session quotes unless a test passes `now`: don't depend on the wall clock."""
    from optionflow.providers import public as _public
    real = _public.overnight_window_start
    monkeypatch.setattr(_public, "overnight_window_start", lambda now=None: real(now) if now is not None else None)


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


# ── overnight / weekend reference close (T-34) ───────────────────────────────
from datetime import datetime as _dt
from zoneinfo import ZoneInfo as _Z

from optionflow.providers.public import normalize_quote as _nq, overnight_window_start as _ows

_ET = _Z("America/New_York")
_SUN_NIGHT = _dt(2026, 11, 8, 20, 48, tzinfo=_ET)          # overnight session after Friday 2026-11-06


def _real(last, prev, change, ts):
    """Real Public quotes, Sunday 2026-11-08 20:48 ET."""
    return {"instrument": {"symbol": "X", "type": "EQUITY"}, "outcome": "SUCCESS", "last": last,
            "lastTimestamp": ts, "previousClose": prev, "oneDayChange": {"change": change, "percentChange": "0"}}


def test_window_boundaries():
    f = lambda *a: _ows(_dt(*a, tzinfo=_ET))
    fri8pm = _dt(2026, 11, 6, 20, 0, tzinfo=_ET)
    assert f(2026, 11, 6, 19, 59) is None                    # Friday after-hours
    assert f(2026, 11, 6, 20, 0) == fri8pm
    assert f(2026, 11, 7, 12, 0) == fri8pm                   # Saturday
    assert f(2026, 11, 8, 20, 48) == fri8pm                  # Sunday overnight
    assert f(2026, 11, 9, 3, 59) == fri8pm                   # Monday before pre-market
    assert f(2026, 11, 9, 4, 0) is None                      # Monday pre-market
    assert f(2026, 11, 9, 12, 0) is None                     # regular
    assert f(2026, 11, 10, 2, 0) == _dt(2026, 11, 9, 20, 0, tzinfo=_ET)


@pytest.mark.parametrize("last,prev,change,ts,friday_close", [
    ("45.23", "40.87", "5.1", "2026-11-09T01:48:00Z", 45.97),     # SOXL, traded overnight
    ("35.59", "33.74", "1.67", "2026-11-09T01:40:40Z", 35.41),    # MP
    ("21.90", "22.14", "-0.25", "2026-11-09T01:29:35Z", 21.89),   # UPST
    ("7376.86", "7353.73", "23.13", "2026-11-06T21:00:00Z", 7376.86),  # SPX: no overnight prints
])
def test_overnight_change_is_vs_the_last_completed_session(last, prev, change, ts, friday_close):
    q = _nq("X", _real(last, prev, change, ts), now=_SUN_NIGHT)
    assert q["prev_close"] == pytest.approx(friday_close)
    assert q["change"] == pytest.approx(float(last) - friday_close, abs=1e-4)


def test_soxl_overnight_shows_minus_not_plus_ten_percent():
    q = _nq("SOXL", _real("45.05", "40.87", "5.1", "2026-11-09T01:49:13Z"), now=_SUN_NIGHT)
    assert q["change_pct"] == pytest.approx(-2.0, abs=0.05)


def test_rolled_over_previous_close_is_kept():
    # If Public has rolled (previousClose = Friday, oneDayChange live), prev + change == last: keep previousClose.
    q = _nq("X", _real("45.05", "45.97", "-0.92", "2026-11-09T01:49:13Z"), now=_SUN_NIGHT)
    assert q["prev_close"] == 45.97


def test_regular_hours_use_previous_close_unchanged():
    q = _nq("X", _real("46.50", "45.97", "0.53", "2026-11-09T15:00:00Z"), now=_dt(2026, 11, 9, 10, 0, tzinfo=_ET))
    assert q["prev_close"] == 45.97 and q["change"] == pytest.approx(0.53)
