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
    """Quotes here are regular-session quotes unless a test says otherwise: don't depend on the wall clock."""
    from optionflow.providers import public as _public
    monkeypatch.setattr(_public, "_now", lambda: _public._REGULAR_HOURS)


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
                 "change_pct": -0.3999, "volume": 44703806, "session": "regular", "regular_close": 344.17,
                 "regular_close_date": None, "ext_change": None, "ext_change_pct": None}
    assert normalize_quote("X", _q("X", outcome="UNKNOWN")) is None
    assert normalize_quote("X", {**_q("X", last=None), "bid": "9", "ask": "11"})["price"] == 10.0


def test_quote_and_last_price_come_from_public(setup):
    fake, yahoo, md = setup
    assert md.quote("KO") == {"symbol": "KO", "price": 101.5, "prev_close": 100.0, "change": 1.5, "change_pct": 1.5,
                              "session": "regular", "regular_close": 100.0, "regular_close_date": None,
                              "ext_change": None, "ext_change_pct": None}
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


# ── sessions and extended hours (T-34, C-54) ─────────────────────────────────
from datetime import datetime as _dt
from zoneinfo import ZoneInfo as _Z

from optionflow.providers import public as _public
from optionflow.providers.public import last_close_boundary as _lcb, market_session as _ms, normalize_quote as _nq

_ET = _Z("America/New_York")
_SUN_NIGHT = _dt(2026, 11, 8, 20, 48, tzinfo=_ET)          # overnight session after Friday 2026-11-06
_FRI = {"close": 45.97, "date": "2026-11-06", "change": 5.10}   # SOXL's DAY summary, Sunday night


def _real(last, prev, change, ts="2026-11-09T01:48:00Z"):
    """Real Public quote shape, Sunday 2026-11-08 20:48 ET."""
    return {"instrument": {"symbol": "X", "type": "EQUITY"}, "outcome": "SUCCESS", "last": last,
            "lastTimestamp": ts, "previousClose": prev, "oneDayChange": {"change": change, "percentChange": "0"}}


@pytest.mark.parametrize("when,session", [
    ((2026, 11, 6, 9, 29), "pre"), ((2026, 11, 6, 9, 30), "regular"), ((2026, 11, 6, 15, 59), "regular"),
    ((2026, 11, 6, 16, 0), "post"), ((2026, 11, 6, 20, 0), "closed"),      # Friday night: no overnight session
    ((2026, 11, 7, 12, 0), "closed"), ((2026, 11, 8, 19, 59), "closed"), ((2026, 11, 8, 20, 0), "overnight"),
    ((2026, 11, 9, 3, 59), "closed"),                                        # see market_session: Monday 00–04
    ((2026, 11, 9, 4, 0), "pre"), ((2026, 11, 9, 20, 0), "overnight"), ((2026, 11, 10, 3, 0), "overnight"),
])
def test_market_session(when, session):
    assert _ms(_dt(*when, tzinfo=_ET)) == session


def test_last_close_boundary():
    assert _lcb(_SUN_NIGHT) == _dt(2026, 11, 6, 16, 0, tzinfo=_ET)
    assert _lcb(_dt(2026, 11, 9, 15, 0, tzinfo=_ET)) == _dt(2026, 11, 6, 16, 0, tzinfo=_ET)
    assert _lcb(_dt(2026, 11, 9, 16, 0, tzinfo=_ET)) == _dt(2026, 11, 9, 16, 0, tzinfo=_ET)


def test_overnight_like_robinhood_today_plus_overnight():
    q = _nq("SOXL", _real("45.05", "40.87", "5.1"), now=_SUN_NIGHT, regular=_FRI)
    assert q["session"] == "overnight"
    assert q["regular_close"] == 45.97 and q["regular_close_date"] == "2026-11-06"
    assert q["prev_close"] == pytest.approx(40.87) and q["change"] == pytest.approx(5.10)   # "Today": Friday's move
    assert q["change_pct"] == pytest.approx(12.48, abs=0.01)
    assert q["ext_change"] == pytest.approx(-0.92) and q["ext_change_pct"] == pytest.approx(-2.0, abs=0.01)


def test_overnight_trade_at_exactly_friday_close_is_not_misread():
    # The old guard flipped TTD to Thursday's close when an overnight print equalled Friday's close.
    q = _nq("TTD", _real("12.93", "12.81", "0.12"), now=_SUN_NIGHT, regular={"close": 12.93, "date": "2026-11-06", "change": 0.12})
    assert q["regular_close"] == 12.93 and q["ext_change"] == 0.0 and q["prev_close"] == pytest.approx(12.81)


def test_without_day_summary_the_frozen_one_day_change_stands_in():
    q = _nq("MP", _real("35.59", "33.74", "1.67"), now=_SUN_NIGHT)
    assert q["regular_close"] == pytest.approx(35.41) and q["regular_close_date"] is None
    assert q["ext_change"] == pytest.approx(0.18)


def test_regular_session_unchanged():
    q = _nq("X", _real("46.50", "45.97", "0.53"), now=_dt(2026, 11, 9, 10, 0, tzinfo=_ET), regular=_FRI)
    assert q["session"] == "regular" and q["prev_close"] == 45.97 and q["change"] == pytest.approx(0.53)
    assert q["regular_close"] == 45.97 and q["regular_close_date"] == "2026-11-06"
    assert q["ext_change"] is None and q["ext_change_pct"] is None


class _SummaryClient:
    def __init__(self):
        self.summaries = 0

    def quotes(self, instruments):
        return [{"instrument": i, "outcome": "SUCCESS", "last": "45.05", "previousClose": "40.87",
                 "oneDayChange": {"change": "5.1"}} for i in instruments]

    def day_summary(self, inst):
        self.summaries += 1
        return {"lastRegularTradingSessionClose": {"close": "45.97", "closeDate": "2026-11-06", "change": "5.10"}}


def test_day_summary_fetched_once_per_session_and_not_in_regular_hours(monkeypatch):
    c = _SummaryClient()
    q = _public.PublicQuotes(c, ttl=0)
    monkeypatch.setattr(_public, "_now", lambda: _SUN_NIGHT)
    got = q.quotes(["SOXL"])["SOXL"]
    assert got["regular_close"] == 45.97 and got["ext_change"] == pytest.approx(-0.92)
    q.quotes(["SOXL"])
    assert c.summaries == 1                                            # cached until the next session close
    monkeypatch.setattr(_public, "_now", lambda: _dt(2026, 11, 9, 10, 0, tzinfo=_ET))
    fresh = _public.PublicQuotes(c, ttl=0)
    fresh.quotes(["SOXL"])
    assert c.summaries == 1                                            # regular hours: quote fields suffice


def test_crypto_keeps_the_plain_day_change(monkeypatch):
    c = _SummaryClient()
    monkeypatch.setattr(_public, "_now", lambda: _SUN_NIGHT)
    got = _public.PublicQuotes(c, ttl=0).quotes(["BTC-USD"])["BTC-USD"]
    assert got["session"] is None and got["ext_change"] is None and got["regular_close"] is None
    assert got["prev_close"] == 40.87
    assert c.summaries == 0


# ── T-38: a stale last trade in an extended session; T-37: the after-hours close is provisional ────────────────
_MON_NIGHT = _dt(2026, 11, 9, 20, 17, tzinfo=_ET)          # weekday overnight after Monday 2026-11-09


def _night(last, ts, bid, ask, prev, change):
    """Real Public quote shape, Monday 2026-11-09 20:17 ET (T-38)."""
    return {**_real(last, prev, change, ts=ts), "bid": bid, "ask": ask}


def test_session_start():
    assert _public.session_start(_MON_NIGHT) == _dt(2026, 11, 9, 20, 0, tzinfo=_ET)
    assert _public.session_start(_dt(2026, 11, 10, 3, 0, tzinfo=_ET)) == _dt(2026, 11, 9, 20, 0, tzinfo=_ET)
    assert _public.session_start(_SUN_NIGHT) == _dt(2026, 11, 8, 20, 0, tzinfo=_ET)
    assert _public.session_start(_dt(2026, 11, 9, 4, 17, tzinfo=_ET)) == _dt(2026, 11, 9, 4, 0, tzinfo=_ET)
    assert _public.session_start(_dt(2026, 11, 9, 16, 17, tzinfo=_ET)) == _dt(2026, 11, 9, 16, 0, tzinfo=_ET)
    assert _public.session_start(_dt(2026, 11, 9, 10, 0, tzinfo=_ET)) is None
    assert _public.session_start(_dt(2026, 11, 7, 12, 0, tzinfo=_ET)) is None


@pytest.mark.parametrize("sym,last,ts,bid,ask,prev,change,close,mid", [
    # last = Sunday-night overnight print (Mon 02:45–03:57 ET); Robinhood showed 22.35 / 37.70 / 17.98
    ("UPST", "22.00", "2026-11-09T07:45:11Z", "22.20", "22.51", "21.89", "0.36", 22.25, 22.355),
    ("MP", "35.54", "2026-11-09T08:49:53.123456789Z", "37.38", "37.99", "35.41", "2.34", 37.75, 37.685),
    ("RIOT", "16.19", "2026-11-09T08:57:45Z", "17.88", "18.12", "16.71", "0.95", 17.66, 18.00),
])
def test_stale_overnight_last_uses_the_live_book(sym, last, ts, bid, ask, prev, change, close, mid):
    reg = {"close": close, "date": "2026-11-09", "change": float(change)}
    q = _nq(sym, _night(last, ts, bid, ask, prev, change), now=_MON_NIGHT, regular=reg)
    assert q["price"] == pytest.approx(mid)
    assert q["regular_close"] == close
    assert q["ext_change"] == pytest.approx(mid - close)
    assert abs(q["ext_change_pct"]) < 2                       # was −1.1 / −5.9 / −8.3 %


def test_fresh_overnight_last_is_kept():
    q = _nq("SPY", _night("753.56", "2026-11-10T01:16:51Z", "753.48", "753.57", "735.29", "17.4"), now=_MON_NIGHT,
            regular={"close": 752.69, "date": "2026-11-09", "change": 17.4})
    assert q["price"] == 753.56 and q["ext_change"] == pytest.approx(0.87)


@pytest.mark.parametrize("bid,ask", [("55.21", "55.20"), ("0", "0"), (None, None), ("15.00", "25.00")])
def test_stale_last_without_a_usable_book_shows_no_ext_move(bid, ask):
    # crossed, empty or too wide (> 5%): price falls back to the regular close
    q = _nq("X", _night("16.19", "2026-11-09T08:57:45Z", bid, ask, "16.71", "0.95"), now=_MON_NIGHT,
            regular={"close": 17.66, "date": "2026-11-09", "change": 0.95})
    assert q["price"] == 17.66 and q["ext_change"] == 0.0 and q["change"] == pytest.approx(0.95)


def test_stale_last_without_any_regular_close_keeps_the_last():
    q = _nq("X", {**_night("16.19", "2026-11-09T08:57:45Z", None, None, None, None)}, now=_MON_NIGHT)
    assert q["price"] == 16.19


def test_regular_session_ignores_last_timestamp():
    q = _nq("X", _night("46.50", "2026-11-06T20:59:00Z", "46.00", "47.00", "45.97", "0.53"),
            now=_dt(2026, 11, 9, 10, 0, tzinfo=_ET))
    assert q["price"] == 46.50


class _ProvisionalClient(_SummaryClient):
    """DAY summary that is preliminary at first, then final (UPST, Monday 2026-11-09)."""
    def __init__(self):
        super().__init__()
        self.close = ("22.30", "0.41")

    def quotes(self, instruments):
        return [{"instrument": i, "outcome": "SUCCESS", "last": "22.40", "previousClose": "21.89",
                 "oneDayChange": {"change": "0.36"}} for i in instruments]

    def day_summary(self, inst):
        self.summaries += 1
        return {"lastRegularTradingSessionClose": {"close": self.close[0], "closeDate": "2026-11-09",
                                                   "change": self.close[1]}}


def test_after_hours_close_is_refreshed_until_20(monkeypatch):
    c = _ProvisionalClient()
    q = _public.PublicQuotes(c, ttl=0)
    clock = [1000.0]
    monkeypatch.setattr(_public.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(_public, "_now", lambda: _dt(2026, 11, 9, 16, 17, tzinfo=_ET))
    assert q.quotes(["UPST"])["UPST"]["regular_close"] == 22.30
    q.quotes(["UPST"])
    assert c.summaries == 1                                   # within REGULAR_RETRY: cached
    c.close = ("22.25", "0.36")
    clock[0] += _public.REGULAR_RETRY + 1
    assert q.quotes(["UPST"])["UPST"]["regular_close"] == 22.25   # post: refetched although the date was fresh
    assert c.summaries == 2
    monkeypatch.setattr(_public, "_now", lambda: _MON_NIGHT)
    q.quotes(["UPST"])
    assert c.summaries == 3                                   # first overnight read replaces the provisional value
    clock[0] += 10 * _public.REGULAR_RETRY
    q.quotes(["UPST"])
    assert c.summaries == 3                                   # final from then on
