"""Public.com for price history and option contracts (scanner, catalysts), Yahoo as the per-call fallback."""
from datetime import date, timedelta

import httpx
import pandas as pd
import pytest

from optionflow.modules.unusual import service as unusual
from optionflow.providers import market_data
from optionflow.providers.market_data import (
    CONTRACT_COLUMNS,
    ContractChain,
    MarketDataRateLimited,
    PublicFirstMarketData,
    RateLimitGate,
)
from optionflow.providers.public import (
    PublicClient,
    PublicHistory,
    PublicOptionChains,
    history_request,
    parse_bars,
    parse_contract_rows,
)


def _bar(ts, close, volume=1000.5):
    """Shape copied from a real Public historicdata response (AAPL, 2026-11-06)."""
    return {"timestamp": ts, "open": str(close - 1), "close": str(close), "high": str(close + 1),
            "low": str(close - 2), "value": str(close), "volume": volume,
            "gainAmount": "0.49", "gainPercentage": "0.18"}


def _history(regular, pre=(), after=()):
    return {"symbol": "AAPL", "period": "DAY", "totalExpectedBars": len(regular),
            "previousClosePrice": "100", "preMarket": {"expectedBars": 0, "bars": list(pre)},
            "regularMarket": {"expectedBars": len(regular), "bars": list(regular)},
            "afterMarket": {"expectedBars": 0, "bars": list(after)}}


def _contract(strike, oi, volume, last="1.60", bid="1.57", ask="1.73", iv="0.3757", otype="C"):
    return {"instrument": {"symbol": f"AAPL261109{otype}{int(strike * 1000):08d}", "type": "OPTION"},
            "outcome": "SUCCESS", "last": last, "bid": bid, "ask": ask, "volume": volume,
            "openInterest": oi, "previousClose": "4.40",
            "optionDetails": {"greeks": {"gamma": "0.0542", "impliedVolatility": iv},
                              "strikePrice": str(strike), "midPrice": "1.65"}}


SOON = (date.today() + timedelta(days=3)).isoformat()
LATER = (date.today() + timedelta(days=10)).isoformat()


class FakePublic:
    def __init__(self):
        self.requests = []
        self.fail = set()             # path substrings that return HTTP 400
        self.bars = {}                # "PERIOD/AGG" → history payload
        self.chains = {
            SOON: {"calls": [_contract(345, oi=0, volume=5000), _contract(350, oi=1909, volume=12864)],
                   "puts": [_contract(340, oi=10, volume=900, otype="P")]},
            LATER: {"calls": [_contract(360, oi=50, volume=10)], "puts": []},
        }

    def handler(self, req: httpx.Request) -> httpx.Response:
        path = req.url.path
        self.requests.append((req.method, path, dict(req.url.params)))
        if any(f in path for f in self.fail):
            return httpx.Response(400, json={"message": "Period YEAR is not compatible with aggregation ONE_MINUTE"})
        if path.endswith("/access-tokens"):
            return httpx.Response(200, json={"accessToken": "tok"})
        if path.endswith("/trading/account"):
            return httpx.Response(200, json={"accounts": [
                {"accountId": "OPT1", "accountType": "BROKERAGE", "optionsLevel": "LEVEL_3"}]})
        if "/historicdata/" in path:
            key = "/".join(path.split("/")[-2:])
            return httpx.Response(200, json=self.bars.get(key, _history([])))
        body = __import__("json").loads(req.content or b"{}")
        if path.endswith("/quotes"):
            return httpx.Response(200, json={"quotes": [
                {"instrument": i, "outcome": "SUCCESS", "last": "342.37", "previousClose": "344.17",
                 "volume": 44703806} for i in body["instruments"]]})
        if path.endswith("/option-expirations"):
            return httpx.Response(200, json={"expirations": [SOON, LATER]})
        if path.endswith("/option-chain"):
            return httpx.Response(200, json=self.chains.get(body["expirationDate"], {"calls": [], "puts": []}))
        return httpx.Response(404, json={})

    def count(self, part):
        return sum(1 for _, p, _ in self.requests if part in p)


class FakeYahoo:
    name = "yfinance"

    def __init__(self):
        self.gate = RateLimitGate()
        self.history_calls = 0
        self.contract_calls = 0

    def price_history(self, symbol, period, interval, prepost=False):
        self.history_calls += 1
        self.last_prepost = prepost
        df = pd.DataFrame({"open": [1.0], "high": [1.0], "low": [1.0], "close": [1.0], "volume": [1]},
                          index=pd.DatetimeIndex([pd.Timestamp("2026-11-06", tz="UTC")]))
        df.attrs["source"] = "yfinance"
        return df

    def option_expiries(self, symbol):
        return [SOON]

    def option_contracts(self, symbol, expiries=None, max_dte=60, max_expiries=4):
        self.contract_calls += 1
        return ContractChain(50.0, pd.DataFrame(
            [{"strike": 50.0, "expiry": SOON, "otype": "call", "oi": 0, "volume": 900,
              "bid": 2.0, "ask": 2.2, "last": 2.1, "iv": 0.4}], columns=CONTRACT_COLUMNS), "yfinance")


@pytest.fixture
def md():
    fake = FakePublic()
    gate = RateLimitGate(first=60, maximum=900, source="Public.com")
    client = PublicClient("secret", transport=httpx.MockTransport(fake.handler), gate=gate, min_gap=0)
    chains = PublicOptionChains(client)
    chains.gate = gate
    yahoo = FakeYahoo()
    provider = PublicFirstMarketData(chains, yahoo, history=PublicHistory(client))
    market_data.use_market_data(provider)
    unusual._cache.clear()
    yield fake, yahoo, provider
    market_data.use_market_data(None)
    unusual._cache.clear()


# ── mapping and parsing ──────────────────────────────────────────────────────

def test_history_request_maps_yahoo_periods_and_intervals():
    assert history_request("1y", "1d") == ("YEAR", "ONE_DAY", None)
    assert history_request("6mo", "1d") == ("HALF_YEAR", "ONE_DAY", None)
    assert history_request("1d", "1m") == ("DAY", "ONE_MINUTE", None)
    assert history_request("5d", "30m") == ("WEEK", "THIRTY_MINUTES", ("sessions", 5))
    assert history_request("2y", "1wk") == ("FIVE_YEARS", "ONE_WEEK", ("days", 731))
    assert history_request("2d", "5m") == ("WEEK", "FIVE_MINUTES", ("sessions", 2))
    assert history_request("14d", "1h") == ("MONTH", "ONE_HOUR", ("days", 14))
    assert history_request("max", "1mo") == ("ALL", "ONE_MONTH", None)
    assert history_request("1d", "2m") is None          # Public has no 2-minute bars → Yahoo
    assert history_request("1mo", "90m") is None


def test_history_request_skips_bar_sizes_public_rejects_for_the_period():
    # Public answers 400 "Period X is not compatible with aggregation Y" for these → straight to Yahoo.
    for period, interval in [("5d", "1m"), ("1mo", "5m"), ("1mo", "30m"), ("14d", "30m"),
                             ("3mo", "1h"), ("6mo", "1h"), ("1y", "1h"), ("ytd", "1h")]:
        assert history_request(period, interval) is None, (period, interval)
    assert history_request("1d", "1h") == ("DAY", "ONE_HOUR", None)
    assert history_request("5d", "5m") == ("WEEK", "FIVE_MINUTES", ("sessions", 5))
    assert history_request("1mo", "1h") == ("MONTH", "ONE_HOUR", None)
    assert history_request("3mo", "1d") == ("QUARTER", "ONE_DAY", None)


def test_parse_bars_regular_session_in_utc():
    df = parse_bars(_history(
        [_bar("2026-11-06T09:30:00-05:00", 340.83, 2043614.368447), _bar("2026-11-06T16:00:00-05:00", 342.37)],
        pre=[_bar("2026-11-06T04:00:00-05:00", 342.21)], after=[_bar("2026-11-06T16:01:00-05:00", 342.37)]))
    assert list(df.columns) == ["open", "high", "low", "close", "volume"]
    assert len(df) == 2                                   # pre/after-market left out, like Yahoo
    assert str(df.index.tz) == "UTC"
    assert df.index[0] == pd.Timestamp("2026-11-06T14:30:00Z")
    assert df["close"].iloc[-1] == 342.37
    bars = market_data.bars_from_history(df, intraday=True)
    assert bars[0]["date"] == "2026-11-06T14:30:00Z" and bars[0]["volume"] == 2043614


def test_daily_bars_keep_their_date():
    df = parse_bars(_history([_bar("2025-11-10T00:00:00-05:00", 269.43)]))
    assert market_data.bars_from_history(df, intraday=False)[0]["date"] == "2025-11-10"


def test_parse_contract_rows_keeps_zero_open_interest():
    rows = parse_contract_rows(SOON, FakePublic().chains[SOON])
    assert len(rows) == 3
    first = rows[0]
    assert first == {"strike": 345.0, "expiry": SOON, "otype": "call", "oi": 0, "volume": 5000,
                     "bid": 1.57, "ask": 1.73, "last": 1.60, "iv": 0.3757}


# ── price history: Public first, Yahoo fallback ──────────────────────────────

def test_price_history_from_public(md):
    fake, yahoo, provider = md
    fake.bars["YEAR/ONE_DAY"] = _history([_bar("2026-11-05T00:00:00-05:00", 340.0),
                                          _bar("2026-11-06T00:00:00-05:00", 342.37)])
    df = provider.price_history("AAPL", "1y", "1d")
    assert df.attrs["source"] == "public" and len(df) == 2 and yahoo.history_calls == 0
    _, path, params = [r for r in fake.requests if "/historicdata/" in r[1]][0]
    assert path.endswith("/historicdata/EQUITY/AAPL/YEAR/ONE_DAY")
    assert params == {"tradingSessionToggle": "REGULAR_HOURS"}
    provider.price_history("AAPL", "1y", "1d")
    assert fake.count("/historicdata/") == 1              # cached


def test_index_history_uses_index_type_without_session_toggle(md):
    fake, _, provider = md
    fake.bars["MONTH/ONE_DAY"] = _history([_bar("2026-11-06T00:00:00-05:00", 7376.86, 0)])
    provider.price_history("^SPX", "1mo", "1d")
    _, path, params = [r for r in fake.requests if "/historicdata/" in r[1]][0]
    assert path.endswith("/historicdata/INDEX/SPX/MONTH/ONE_DAY") and params == {}


@pytest.mark.parametrize("symbol,period,interval,why", [
    ("AAPL", "1d", "2m", "no 2-minute bars"),
    ("VOD.L", "1y", "1d", "non-US listing"),
    ("ZZZZQQ", "1mo", "1d", "unknown symbol: HTTP 200, no bars"),
    ("AAPL", "1y", "1m", "incompatible pair: HTTP 400"),
])
def test_price_history_falls_back_to_yahoo(md, symbol, period, interval, why):
    fake, yahoo, provider = md
    fake.fail.add("/YEAR/ONE_MINUTE")
    df = provider.price_history(symbol, period, interval)
    assert df.attrs["source"] == "yfinance" and yahoo.history_calls == 1, why


def test_price_history_falls_back_on_public_429(md):
    fake, yahoo, provider = md
    provider.history.client._gate.trip()
    assert provider.price_history("AAPL", "1y", "1d").attrs["source"] == "yfinance"
    assert fake.count("/historicdata/") == 0


def test_short_week_widens_to_month_and_trims_sessions(md):
    fake, _, provider = md
    fake.bars["WEEK/FIVE_MINUTES"] = _history([_bar("2026-11-09T09:30:00-05:00", 1.0)])   # Monday only
    fake.bars["MONTH/FIVE_MINUTES"] = _history([
        _bar(f"2026-11-{d:02d}T10:00:00-05:00", float(d)) for d in (2, 3, 4, 5, 6, 9)])
    df = provider.price_history("AAPL", "5d", "5m")
    days = sorted(set(df.index.tz_convert("America/New_York").date))
    assert [d.day for d in days] == [3, 4, 5, 6, 9]


def test_market_history_endpoint_reports_source(md):
    fake, _, _ = md
    fake.bars["HALF_YEAR/ONE_DAY"] = _history([_bar("2026-11-06T00:00:00-05:00", 342.37)])
    from optionflow.modules.market import service
    out = service.price_history("AAPL", "6mo", "1d")
    assert out["source"] == "public" and out["current_price"] == 342.37 and out["error"] is None


# ── extended hours (prepost) ─────────────────────────────────────────────────

def test_parse_bars_extended_adds_pre_and_after_market():
    payload = _history([_bar("2026-11-06T09:30:00-05:00", 340.0)],
                       pre=[_bar("2026-11-06T04:00:00-05:00", 339.0)], after=[_bar("2026-11-06T16:05:00-05:00", 341.0)])
    assert len(parse_bars(payload)) == 1
    df = parse_bars(payload, extended=True)
    assert list(df["close"]) == [339.0, 340.0, 341.0] and df.index.is_monotonic_increasing


def test_prepost_one_day_from_public_without_session_toggle(md):
    fake, yahoo, provider = md
    fake.bars["DAY/FIVE_MINUTES"] = _history([_bar("2026-11-06T09:30:00-05:00", 340.0)],
                                             pre=[_bar("2026-11-06T04:00:00-05:00", 339.0)],
                                             after=[_bar("2026-11-06T16:05:00-05:00", 341.0)])
    assert len(provider.price_history("AAPL", "1d", "5m")) == 1          # regular only, cached separately
    df = provider.price_history("AAPL", "1d", "5m", prepost=True)
    assert df.attrs["source"] == "public" and len(df) == 3 and yahoo.history_calls == 0
    params = [r[2] for r in fake.requests if "/historicdata/" in r[1]]
    assert params == [{"tradingSessionToggle": "REGULAR_HOURS"}, {}]


def test_prepost_beyond_one_day_goes_straight_to_yahoo(md):
    # Public's WEEK and longer periods carry no pre/after-market bars (probed 2026-11-11).
    fake, yahoo, provider = md
    df = provider.price_history("AAPL", "5d", "15m", prepost=True)
    assert df.attrs["source"] == "yfinance" and yahoo.last_prepost is True
    assert fake.count("/historicdata/") == 0


def test_prepost_ignored_for_daily_bars(md):
    fake, yahoo, _ = md
    fake.bars["HALF_YEAR/ONE_DAY"] = _history([_bar("2026-11-06T00:00:00-05:00", 342.37)])
    from optionflow.modules.market import service
    out = service.price_history("AAPL", "6mo", "1d", prepost=True)
    assert out["source"] == "public" and out["prepost"] is False and yahoo.history_calls == 0


def test_market_history_endpoint_prepost_flag(md):
    fake, _, _ = md
    fake.bars["DAY/ONE_MINUTE"] = _history([_bar("2026-11-06T09:30:00-05:00", 340.0)],
                                           after=[_bar("2026-11-06T16:01:00-05:00", 341.0)])
    from optionflow.modules.market import service
    out = service.price_history("AAPL", "1d", "1m", prepost=True)
    assert out["prepost"] is True and len(out["bars"]) == 2 and out["current_price"] == 341.0
    assert service.price_history("AAPL", "1d", "1m")["prepost"] is False


# ── option contracts: scanner and catalysts ──────────────────────────────────

def test_option_contracts_from_public_share_the_chain_cache(md):
    fake, yahoo, provider = md
    c = provider.option_contracts("AAPL", max_dte=60, max_expiries=4)
    assert c.source == "public" and c.spot == 342.37 and len(c.rows) == 4 and yahoo.contract_calls == 0
    provider.chains.option_chain("AAPL")                 # GEX right after: no new chain requests
    assert fake.count("/option-chain") == 2


def test_option_contracts_fall_back_to_yahoo(md):
    fake, yahoo, provider = md
    fake.fail.add("/option-expirations")
    c = provider.option_contracts("AAPL")
    assert c.source == "yfinance" and yahoo.contract_calls == 1


def test_unusual_scan_runs_on_public_chains(md):
    fake, yahoo, _ = md
    out = unusual.scan(["AAPL"], min_premium=100_000)
    strikes = sorted(r["strike"] for r in out["rows"])
    assert strikes == [340.0, 345.0, 350.0]               # 900 on 10 OI; 5000 on 0 OI; 12864 on 1909 OI
    row = next(r for r in out["rows"] if r["strike"] == 345.0)
    assert row["spot"] == 342.37 and row["vol_oi"] is None and row["iv_pct"] == 37.6
    assert out["source"].startswith("Public.com option chains (real-time)")
    assert yahoo.contract_calls == 0


def test_unusual_scan_labels_mixed_sources(md):
    fake, yahoo, _ = md
    out = unusual.scan(["AAPL", "VOD.L"], min_premium=100_000)
    assert yahoo.contract_calls == 1                      # VOD.L isn't a Public instrument
    assert "Yahoo Finance (delayed) for 1 of 2 symbols" in out["source"]


def test_unusual_scan_refuses_only_when_both_sources_are_blocked(md):
    fake, yahoo, provider = md
    provider.chains.gate.trip()
    unusual.scan(["AAPL"], min_premium=100_000)          # Public blocked, Yahoo serves: fine
    yahoo.gate.trip()
    with pytest.raises(MarketDataRateLimited):
        unusual.scan(["MSFT"], min_premium=100_000)


# ── quotes: indexes Public refuses, crypto pairs ─────────────────────────────

def test_rejected_index_is_dropped_and_the_batch_retried():
    from optionflow.providers import public
    from optionflow.providers.public import PublicQuotes
    public._UNSUPPORTED.clear()
    sent = []

    def handler(req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if path.endswith("/access-tokens"):
            return httpx.Response(200, json={"accessToken": "tok"})
        insts = __import__("json").loads(req.content)["instruments"]
        sent.append([f"{i['type']}:{i['symbol']}" for i in insts])
        if any(i["type"] == "INDEX" and i["symbol"] == "TNX" for i in insts):
            return httpx.Response(400, json={"code": 40, "message":
                                  "No enum constant com.hellopublic.trading.core.symbology.Index.TNX"})
        return httpx.Response(200, json={"quotes": [
            {"instrument": i, "outcome": "SUCCESS", "last": "10", "previousClose": "9"} for i in insts]})

    client = PublicClient("s", account_id="A", transport=httpx.MockTransport(handler),
                          gate=RateLimitGate(source="Public.com"), min_gap=0)
    q = PublicQuotes(client, ttl=0)
    try:
        got = q.quotes(["AAPL", "^TNX", "^VIX", "BTC-USD"])
        assert set(got) == {"AAPL", "^VIX", "BTC-USD"}            # ^TNX left for Yahoo
        assert sent == [["EQUITY:AAPL", "INDEX:TNX", "INDEX:VIX", "CRYPTO:BTC"],
                        ["EQUITY:AAPL", "INDEX:VIX", "CRYPTO:BTC"]]
        q.quotes(["AAPL", "^TNX"])                                 # remembered: never sent again
        assert sent[-1] == ["EQUITY:AAPL"]
    finally:
        public._UNSUPPORTED.clear()


def test_other_400s_still_raise_for_the_fallback():
    from optionflow.providers.public import PublicError

    def handler(req):
        if req.url.path.endswith("/access-tokens"):
            return httpx.Response(200, json={"accessToken": "tok"})
        return httpx.Response(400, json={"message": "bad request"})

    client = PublicClient("s", account_id="A", transport=httpx.MockTransport(handler),
                          gate=RateLimitGate(source="Public.com"), min_gap=0)
    with pytest.raises(PublicError):
        client.quotes([{"symbol": "AAPL", "type": "EQUITY"}])


def test_crypto_pairs_map_to_public_crypto():
    from optionflow.providers.public import instrument_for
    assert instrument_for("BTC-USD") == {"symbol": "BTC", "type": "CRYPTO"}
    assert instrument_for("BRK-B") == {"symbol": "BRK-B", "type": "EQUITY"}
