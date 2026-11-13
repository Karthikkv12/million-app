"""Factor exposure: the regression recovers known betas, the risk split adds up, hedges zero the beta, and the API."""
import math
import random

import numpy as np
import pandas as pd
import pytest

from optionflow.modules.risk import book
from optionflow.modules.risk import factors as fx
from tests.hedge.test_api import TOKEN, _login, client  # noqa: F401  (fixture)

N = 400
DATES = [d.strftime("%Y-%m-%d") for d in pd.bdate_range("2025-01-02", periods=N + 1)]


def market(seed=11):
    """Daily log returns of the four factor ETFs and a few stocks with known factor betas."""
    rnd = random.Random(seed)
    g = lambda sd: [rnd.gauss(0, sd) for _ in range(N)]          # noqa: E731
    mkt, tech, size, rates = g(0.010), g(0.006), g(0.007), g(0.009)
    etf = {"SPY": mkt, "QQQ": [m + t for m, t in zip(mkt, tech)], "IWM": [m + s for m, s in zip(mkt, size)], "TLT": rates}
    true = {"AAA": (1.5, 1.2, 0.0, -0.3), "BBB": (0.8, -0.4, 0.9, 0.2), "CCC": (1.0, 0.0, 0.0, 0.0)}
    stocks = {}
    for sym, (bm, bt, bs, br) in true.items():
        noise = g(0.004)
        stocks[sym] = [bm * a + bt * b + bs * c + br * d + e for a, b, c, d, e in zip(mkt, tech, size, rates, noise)]
    return etf, stocks, true


def to_closes(rets, start=100.0):
    px, out = start, {DATES[0]: start}
    for d, r in zip(DATES[1:], rets):
        px *= math.exp(r)
        out[d] = px
    return out


def test_regression_recovers_known_betas():
    etf, stocks, true = market()
    X = fx.factor_returns(etf)
    for sym, betas in true.items():
        fit = fx.regress(stocks[sym], X)
        assert fit["betas"] == pytest.approx(list(betas), abs=0.08)
        assert fit["r2"] > 0.8 and fit["specific_vol"] == pytest.approx(0.004 * math.sqrt(252), rel=0.15)


def test_factor_etfs_load_only_on_their_own_factor():
    etf, _, _ = market()
    X = fx.factor_returns(etf)
    spy = fx.regress(etf["SPY"], X)["betas"]
    qqq = fx.regress(etf["QQQ"], X)["betas"]
    assert spy == pytest.approx([1, 0, 0, 0], abs=1e-9) and qqq == pytest.approx([1, 1, 0, 0], abs=1e-9)


def test_decomposition_adds_up_to_the_variance():
    etf, stocks, _ = market()
    X = fx.factor_returns(etf)
    fit = fx.regress(stocks["AAA"], X)
    dec = fx.decompose(fit["betas"], np.cov(X, rowvar=False, ddof=1), fit["resid_var"])
    assert sum(dec["shares"]) + dec["specific_share"] == pytest.approx(1.0)
    assert dec["total"] == pytest.approx(np.var(stocks["AAA"], ddof=1) * 252, rel=0.02)


def test_hedge_legs_cancel_the_factor():
    prices = {"SPY": 500.0, "QQQ": 400.0}
    assert fx.hedge_legs("market", 60_000, prices) == [{"symbol": "SPY", "dollars": -60_000, "shares": -120.0}]
    legs = fx.hedge_legs("tech", 20_000, prices)
    assert legs == [{"symbol": "QQQ", "dollars": -20_000, "shares": -50.0}, {"symbol": "SPY", "dollars": 20_000, "shares": 40.0}]


def test_service_book_betas_are_the_weighted_holding_betas(monkeypatch):
    etf, stocks, true = market()
    closes = {**{k: to_closes(v) for k, v in etf.items()}, **{k: to_closes(v) for k, v in stocks.items()}}
    rows = [{"symbol": "AAA", "spot": 100.0, "net_delta": 3.0, "exposure": 30_000.0, "shares": 300, "has_options": False},
            {"symbol": "BBB", "spot": 100.0, "net_delta": -1.0, "exposure": -10_000.0, "shares": 0, "has_options": True},
            {"symbol": "NEW", "spot": 50.0, "net_delta": 1.0, "exposure": 5_000.0, "shares": 100, "has_options": False}]
    monkeypatch.setattr(book, "holdings", lambda uid: [dict(r) for r in rows])
    monkeypatch.setattr(book, "capital", lambda uid: 100_000.0)
    monkeypatch.setattr(book, "safe_closes", lambda s: (closes.get(s, {}), None))
    out = fx.factors(1)
    assert out["error"] is None and out["capital_source"] == "account" and out["sessions"] == 252
    by = {h["symbol"]: h for h in out["holdings"]}
    assert by["NEW"]["betas"] is None and "Not enough price history" in by["NEW"]["error"]
    mk = next(f for f in out["book"]["factors"] if f["key"] == "market")
    want = 0.3 * by["AAA"]["betas"]["market"] - 0.1 * by["BBB"]["betas"]["market"]
    assert mk["beta"] == pytest.approx(want, abs=1e-9)
    assert mk["dollar_per_pct"] == pytest.approx(want * 1000)
    assert mk["hedge"][0]["symbol"] == "SPY" and mk["hedge"][0]["dollars"] == pytest.approx(-want * 100_000)
    shares = [f["risk_share"] for f in out["book"]["factors"]]
    assert sum(shares) + out["book"]["specific_share"] == pytest.approx(1.0)
    assert by["AAA"]["dollar_betas"]["tech"] == pytest.approx(by["AAA"]["betas"]["tech"] * 300)


def test_service_says_why_when_it_cannot(monkeypatch):
    monkeypatch.setattr(book, "holdings", lambda uid: [])
    monkeypatch.setattr(book, "capital", lambda uid: None)
    assert fx.factors(1)["error"] == "No positions synced yet."
    monkeypatch.setattr(book, "holdings", lambda uid: [{"symbol": "AAA", "spot": 1.0, "exposure": 1.0}])
    monkeypatch.setattr(book, "safe_closes", lambda s: ({}, "rate limited"))
    assert fx.factors(1)["error"] == "No price history for the IWM factor right now (rate limited)."


def test_api(client):  # noqa: F811
    from optionflow.modules.insight import service as insight
    c, fake = client
    insight.clear_cache()
    etf, stocks, _ = market()
    series = {**etf, "ABC": stocks["AAA"]}
    idx = pd.bdate_range("2025-01-02", periods=N + 1)
    fake.price_history = lambda s, p, i: pd.DataFrame({"close": list(to_closes(series[s]).values()), "volume": [1e6] * (N + 1)}, index=idx)
    fake.last_price = lambda s: list(to_closes(series[s]).values())[-1]
    c.post("/api/v1/hedge/ingest", json={"username": "owner", "positions": [
        {"symbol": "ABC", "kind": "stock", "quantity": 100, "avg_price": 40}]}, headers={"X-Hedge-Ingest-Token": TOKEN})
    assert c.get("/api/v1/risk/factors").status_code == 401
    d = c.get("/api/v1/risk/factors?capital=50000", headers=_login(c, "owner")).json()
    assert d["error"] is None and [f["key"] for f in d["factors"]] == ["market", "tech", "size", "rates"]
    h = d["holdings"][0]
    assert h["symbol"] == "ABC" and h["betas"]["market"] == pytest.approx(1.5, abs=0.1) and h["risk_share"] > 0.9
    assert d["book"]["factors"][0]["beta"] == pytest.approx(h["betas"]["market"] * h["exposure"] / 50_000)
    insight.clear_cache()
