"""Volatility targeting: GARCH(1,1) path, the exposure rule, the book scale, risk shares, and the API."""
import math
import random

import pandas as pd
import pytest

from optionflow.modules.risk import voltarget as vt
from tests.hedge.test_api import BODY, TOKEN, _login, client  # noqa: F401  (fixture)


def noise(n, sd, seed=1):
    rnd = random.Random(seed)
    return [rnd.gauss(0, sd) for _ in range(n)]


def test_garch_starts_at_long_run_and_reacts_to_shocks():
    r = noise(500, 0.01)
    path = vt.garch_path(r)
    long_run = sum((x - sum(r) / len(r)) ** 2 for x in r) / (len(r) - 1)
    assert len(path) == len(r) + 1 and path[0] == pytest.approx(long_run)
    calm = vt.garch_path(r + [0.0] * 30)[-1]
    shock = vt.garch_path(r + [0.0] * 29 + [0.08])[-1]
    assert shock > long_run > calm                     # a big move lifts tomorrow's forecast; quiet days lower it
    # without new shocks the forecast decays back towards the long-run variance
    after = vt.garch_path(r + [0.08] + [math.sqrt(long_run)] * 200)[-1]
    assert after == pytest.approx(long_run, rel=0.05)


def test_forecast_is_annualised_and_needs_history():
    f = vt.garch_forecast(noise(600, 0.01))
    assert f["long_run"] == pytest.approx(0.01 * math.sqrt(252), rel=0.1)
    assert 0 < f["forecast"] < 1 and 0 < f["realized_20d"] < 1
    assert vt.garch_forecast(noise(30, 0.01)) == {"forecast": None, "long_run": None, "realized_20d": None}


def test_exposure_rule_and_cap():
    assert vt.exposure_for(0.15, 0.30, 1.0) == pytest.approx(0.5)
    assert vt.exposure_for(0.15, 0.10, 1.0) == 1.0               # capped at all-in
    assert vt.exposure_for(0.15, 0.10, 2.0) == pytest.approx(1.5)
    assert vt.exposure_for(0.15, None, 1.0) is None


def test_book_scale_respects_gross_cap():
    assert vt.scale_book(0.15, 0.30, 50_000, 100_000, 1.0) == (pytest.approx(0.5), False)
    s, capped = vt.scale_book(0.15, 0.05, 80_000, 100_000, 1.0)       # 3× wanted, but gross may only reach 100k
    assert capped and s == pytest.approx(100_000 / 80_000)
    assert vt.scale_book(0.15, None, 1, 1, 1) == (None, False)


def test_risk_shares_sum_to_one_and_follow_volatility():
    a, b = noise(300, 0.01, 1), noise(300, 0.03, 2)
    sh = vt.risk_shares({"A": 0.5, "B": 0.5}, {"A": a, "B": b})
    assert sum(sh.values()) == pytest.approx(1.0) and sh["B"] > 0.8


def test_align_keeps_common_dates():
    dates, rets = vt.align({"A": {"d1": 1, "d2": 2, "d3": 4}, "B": {"d2": 10, "d3": 5, "d4": 1}})
    assert dates == ["d3"] and rets["A"] == [pytest.approx(math.log(2))] and rets["B"] == [pytest.approx(math.log(0.5))]


def test_api_scales_the_synced_book(client):  # noqa: F811
    from optionflow.modules.insight import service as insight
    c, fake = client
    insight.clear_cache()
    n = 400
    closes = [100 * math.exp(sum(noise(i + 1, 0.02, 7)[: i + 1])) for i in range(n)]
    idx = pd.bdate_range("2025-01-02", periods=n)
    fake.price_history = lambda s, p, i: pd.DataFrame({"close": closes, "volume": [1e6] * n}, index=idx)
    fake.last_price = lambda s: closes[-1]
    c.post("/api/v1/hedge/ingest", json={"username": "owner", "positions": [
        {"symbol": "ABC", "kind": "stock", "quantity": 200, "avg_price": 40}]}, headers={"X-Hedge-Ingest-Token": TOKEN})
    assert c.get("/api/v1/risk/vol-target").status_code == 401
    r = c.get("/api/v1/risk/vol-target?target=0.1&capital=100000", headers=_login(c, "owner"))
    assert r.status_code == 200
    d = r.json()
    h = d["holdings"][0]
    assert h["symbol"] == "ABC" and h["exposure"] == pytest.approx(200 * closes[-1], rel=1e-3)
    assert d["capital_source"] == "input" and d["forecast"] > 0 and d["scale"] > 0
    assert h["suggested_exposure"] == pytest.approx(h["exposure"] * d["scale"])
    assert h["change_shares"] == pytest.approx(h["change"] / h["spot"])
    assert h["risk_share"] == pytest.approx(1.0) and len(d["chart"]) > 100
    last = d["chart"][-1]
    assert last["scale"] == pytest.approx(min(0.1 / last["forecast"], d["max_scale"]))
    assert c.get("/api/v1/risk/vol-target?target=0", headers=_login(c, "owner")).status_code == 422
    insight.clear_cache()
