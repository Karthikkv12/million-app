"""Scanner: indicators, the price screen, the chain stage, scoring and a full scan on a fake market."""
import pandas as pd
import pytest

from optionflow.modules.strategy import scanner
from optionflow.modules.strategy.catalog import rules_for
from optionflow.modules.strategy.filters import clean_filters, defaults

from .helpers import rows


def test_rsi_extremes_and_middle():
    assert scanner.rsi(list(range(1, 30))) == 100.0
    assert scanner.rsi(list(range(30, 1, -1))) == pytest.approx(0.0)
    assert 40 < scanner.rsi([100 + (i % 2) for i in range(30)]) < 60
    assert scanner.rsi([1, 2]) is None


def test_filters_clean_bounds_symbols_and_order():
    f = clean_filters({"min_price": 500, "max_price": 50, "pullback_min": -1, "symbols": "nvda, tsla  bad$ NVDA",
                       "above_sma200": False, "interval_min": 1, "max_results": 7.6})
    assert (f["min_price"], f["max_price"]) == (50, 500) and f["pullback_min"] == 0.0
    assert f["symbols"] == ["NVDA", "TSLA"] and f["above_sma200"] is False
    assert f["interval_min"] == 5 and f["max_results"] == 8
    assert clean_filters(None) == defaults()


def uptrend_then_dip(n=260, top=120.0, now=110.0):
    closes = [80 + 40 * i / (n - 20) for i in range(n - 20)] + [top - (top - now) * i / 19 for i in range(20)]
    return closes, [c * 1.005 for c in closes]


def test_screen_measures_pullback_trend_and_hv():
    closes, highs = uptrend_then_dip()
    m = scanner.screen("XYZ", closes, highs, 108.0)
    assert m["pullback"] == pytest.approx(1 - 108.0 / max(highs[-20:]), rel=1e-6)
    assert m["sma200_gap"] > 0 and m["rsi"] < 50
    f = defaults()
    assert scanner.passes_screen(m, f) is None
    assert scanner.passes_screen({**m, "spot": 5.0}, f) == "price"
    assert scanner.passes_screen({**m, "pullback": 0.01}, f) == "pullback"
    assert scanner.passes_screen({**m, "rsi": 80}, f) == "rsi"
    assert scanner.passes_screen({**m, "sma200": 200.0}, f) == "trend"
    assert scanner.passes_screen({**m, "sma200": 200.0}, {**f, "above_sma200": False}) is None


def test_score_is_bounded_and_rewards_yield_and_iv():
    f, r = defaults(), rules_for("cash_secured_put")
    lo = scanner.score(0.03, f, 0.8, 0.0, r, 0.0, f["max_spread_pct"])
    hi = scanner.score(0.20, f, 2.0, 1.0, r, 1.0, 0.0)
    assert lo == 0.0 and hi == 100.0
    assert scanner.score(0.1, f, 1.3, 0.3, r, 0.5, 0.05) > scanner.score(0.1, f, 1.0, 0.3, r, 0.5, 0.05)


def test_trade_for_each_strategy():
    from datetime import date
    qs, _ = scanner.quotes_from_rows(rows(spot=100), 100.0, date.today())
    put, _ = scanner.trade_for(rules_for("cash_secured_put"), qs, 100.0)
    bw, _ = scanner.trade_for(rules_for("covered_call"), qs, 100.0)
    sp, _ = scanner.trade_for(rules_for("put_credit_spread"), qs, 100.0)
    assert put["action"] == "SELL_PUT" and put["strike"] < 100 and put["collateral"] == put["strike"] * 100
    assert bw["action"] == "BUY_WRITE" and bw["strike"] > 100
    assert sp["action"] == "SELL_PUT_SPREAD" and sp["long_strike"] < sp["strike"]


class Chain:
    def __init__(self, df):
        self.rows, self.spot, self.source = df, None, "fake"


@pytest.fixture
def market(monkeypatch, fake_market_data):
    """XYZ: uptrend then a ~8% dip with 40% IV (≈2× realized); FLAT: no pullback; DOWN: below its 200-day."""
    dip = uptrend_then_dip()
    bars = {"XYZ": dip, "FLAT": ([100.0] * 260, [100.0] * 260),
            "DOWN": ([150 - i * 0.2 for i in range(260)], [150 - i * 0.2 for i in range(260)])}
    monkeypatch.setattr(scanner, "_bars_for", lambda s: bars[s])
    monkeypatch.setattr(scanner, "earnings_date", lambda s: None)
    fake_market_data.last_prices = lambda syms: {"XYZ": 110.0, "FLAT": 100.0, "DOWN": 98.0}
    calls = []
    def contracts(sym, expiries=None, max_dte=60, max_expiries=4):
        calls.append(sym)
        return Chain(pd.DataFrame(rows(spot=110.0, iv=0.40, dtes=(7, 30), lo=80, hi=140)))
    fake_market_data.option_contracts = contracts
    return calls


def test_full_scan_finds_the_pullback_and_skips_the_rest(market):
    f = clean_filters({"use_default_universe": False, "symbols": ["XYZ", "FLAT", "DOWN"]})
    out = scanner.scan(rules_for("cash_secured_put"), f)
    assert market == ["XYZ"]                                   # only the survivor's chain is fetched
    assert out["universe"] == 3 and out["screened"] == 1 and out["skipped"] == {"pullback": 1, "trend": 1}
    [r] = out["rows"]
    assert r["symbol"] == "XYZ" and r["action"] == "SELL_PUT" and r["strike"] < 110 and 21 <= r["dte"] <= 46
    assert r["iv_hv"] > 1 and 0 < r["score"] <= 100 and r["key"].startswith("cash_secured_put:XYZ:")
    assert any("off the 20-day high" in x for x in r["reasons"])


def test_scan_respects_iv_liquidity_and_earnings(market, monkeypatch):
    base = {"use_default_universe": False, "symbols": ["XYZ"]}
    assert scanner.scan(rules_for("wheel"), clean_filters({**base, "min_iv": 0.9}))["skipped"] == {"iv": 1}
    assert scanner.scan(rules_for("wheel"), clean_filters({**base, "min_oi": 5000}))["skipped"] == {"no_contract": 1}
    from datetime import date, timedelta
    monkeypatch.setattr(scanner, "earnings_date", lambda s: (date.today() + timedelta(days=10)).isoformat())
    assert scanner.scan(rules_for("wheel"), clean_filters(base))["skipped"] == {"earnings": 1}
    assert scanner.scan(rules_for("wheel"), clean_filters({**base, "skip_earnings": False}))["rows"]
