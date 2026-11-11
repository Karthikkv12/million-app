"""insight: drawdown / spike series and the LEAPS score (pure), plus the API on a fake provider."""
import math

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from optionflow.modules.insight import score as sc
from optionflow.modules.insight import service
from optionflow.modules.insight import swings as sw
from optionflow.providers import market_data


def dates(n):
    return [d.strftime("%Y-%m-%d") for d in pd.bdate_range("2021-01-04", periods=n)]


def path(n, drift=0.0005, wobble=0.01, start=100.0, period=17):
    return [start * math.exp(drift * i + wobble * math.sin(i / period * 2 * math.pi)) for i in range(n)]


# ── swings ────────────────────────────────────────────────────────────────────
def test_drawdown_is_zero_at_highs_and_spike_is_zero_at_rolling_lows():
    px = [100, 110, 99, 88, 96.8, 121]
    assert sw.drawdown(px) == pytest.approx([0, 0, -0.1, -0.2, -0.12, 0])
    assert sw.spike(px, 3) == pytest.approx([0, 0.10, 0, 0, 0.10, 0.375])       # vs the low of the last 3 closes


def test_swings_stats_and_thinning_keep_the_extremes():
    px = [100, 110, 99, 88, 96.8, 121, 115]
    out = sw.swings(dates(7), px, "1mo")
    s = out["stats"]
    assert out["lookback"] == 5 and len(out["points"]) == 7
    assert s["max_drawdown"] == pytest.approx(-0.2) and s["max_drawdown_date"] == dates(7)[3]
    assert s["current_drawdown"] == pytest.approx(115 / 121 - 1, abs=1e-5) and s["sessions_since_peak"] == 1
    assert s["max_spike"] == pytest.approx(0.375) and s["max_spike_date"] == dates(7)[5]
    thin = sw.swings(dates(7), px, "1mo", max_points=2)["points"]
    assert len(thin) == 2 and min(p["drawdown"] for p in thin) == pytest.approx(-0.2)
    assert max(p["spike"] for p in thin) == pytest.approx(0.375) and thin[-1]["date"] == dates(7)[-1]
    assert sw.swings([], [], "1y") == {"lookback": 21, "points": [], "stats": None}


# ── score ─────────────────────────────────────────────────────────────────────
def by_key(out):
    return {f["key"]: f for f in out["factors"]}


def test_bands_and_lerp():
    assert [sc.band(x) for x in (0, 19, 20, 45, 60, 79, 80, 100)] == ["Avoid", "Avoid", "Weak", "Fair", "Good", "Good", "Excellent", "Excellent"]
    assert sc.lerp(5, [(0, 0), (10, 100)]) == 50 and sc.lerp(-1, [(0, 7), (10, 100)]) == 7 and sc.lerp(99, [(0, 0), (10, 100)]) == 100


def test_uptrend_on_a_pullback_with_cheap_options_scores_high():
    px = path(1000, drift=0.0008, wobble=0.05, period=40)
    px = px + [px[-1] * (1 - 0.12 * i / 10) for i in range(1, 11)]             # 12% slide over two weeks
    cheap = sc.hv(px, 60) * 0.8
    out = sc.leaps_score(px, [5e6] * len(px), spy_closes=path(len(px), drift=0.0003), atm_iv=cheap, net_gex=1e9, zero_gamma=px[-1] * 0.95)
    f = by_key(out)
    assert out["score"] >= 70 and out["band"] in ("Good", "Excellent") and out["error"] is None
    assert set(f) == set(sc.WEIGHTS)                                             # every factor had data
    assert f["pullback"]["score"] >= 85 and out["traits"]["state"] == "pulled back" and out["traits"]["trend"] == "up"
    assert 0 <= f["strength"]["score"] <= 100 and f["dealers"]["score"] == 80


def test_downtrend_scores_low_and_calls_the_pullback_a_falling_knife():
    out = sc.leaps_score(path(1000, drift=-0.0012, wobble=0.03), [2e4] * 1000, atm_iv=1.4)
    f = by_key(out)
    assert out["score"] < 35 and out["band"] in ("Avoid", "Weak")
    assert "falling knife" in f["pullback"]["note"] and f["trend"]["score"] < 38 and f["liquidity"]["score"] < 20
    assert "strength" not in f and "dealers" not in f                            # no data: left out, not scored 0


def test_traits_describe_how_it_trades():
    calm = sc.leaps_score(path(400, wobble=0.004), [1e6] * 400)["traits"]
    wild = sc.leaps_score(path(400, wobble=0.5, period=9), [1e6] * 380 + [5e6] * 20)["traits"]
    assert calm["volatility"] == "calm" and wild["volatility"] == "super volatile"
    assert calm["volume"] == "normal" and wild["volume"] == "high"
    assert 0 < calm["daily_move"] < wild["daily_move"] and calm["monthly_move"] == pytest.approx(calm["daily_move"] * math.sqrt(21), abs=2e-4)


def test_too_little_history_gives_no_score():
    out = sc.leaps_score(path(30))
    assert out["score"] is None and "60 sessions" in out["error"]


# ── service + API ─────────────────────────────────────────────────────────────
class FakeMD:
    name = "fake"

    def __init__(self):
        self.calls = []

    def price_history(self, symbol, period, interval):
        self.calls.append((symbol, period))
        if symbol == "NOPE":
            return pd.DataFrame()
        n = {"1mo": 21, "1y": 252, "5y": 1260, "max": 3000}.get(period, 126)
        df = pd.DataFrame({"close": path(n), "volume": [1e6] * n}, index=pd.bdate_range("2015-01-05", periods=n))
        df.attrs["source"] = "public"
        return df


@pytest.fixture
def md():
    fake = FakeMD()
    market_data.use_market_data(fake)
    service.clear_cache()
    yield fake
    market_data.use_market_data(None)
    service.clear_cache()


def test_service_swings_caches_and_thins_all_time(md):
    out = service.swings("abc", "max")
    assert out["symbol"] == "ABC" and out["lookback"] == 126 and out["source"] == "public" and out["error"] is None
    assert len(out["points"]) <= sw.MAX_POINTS and out["stats"]["sessions"] == 3000
    service.swings("ABC", "max")
    assert md.calls == [("ABC", "max")]
    assert service.swings("ABC", "bogus")["period"] == "1y"
    assert service.swings("NOPE", "1y")["error"] == "No price history for NOPE."


def test_service_score_uses_spy_and_survives_a_dead_provider(md, monkeypatch):
    out = service.leaps_score("abc")
    assert 0 <= out["score"] <= 100 and out["symbol"] == "ABC" and out["as_of"]
    assert ("SPY", "5y") in md.calls and "strength" in {f["key"] for f in out["factors"]}
    service.clear_cache()
    monkeypatch.setattr(md, "price_history", lambda *a: (_ for _ in ()).throw(RuntimeError("rate limited")))
    assert service.leaps_score("abc") == {"symbol": "ABC", "score": None, "band": None, "error": "rate limited"}


def test_api_needs_login_and_validates_the_period(md):
    from optionflow.core.settings import Settings
    from optionflow.main import create_app
    c = TestClient(create_app(Settings(_env_file=None)))
    assert c.get("/api/v1/insight/ABC/swings").status_code == 401
    assert c.get("/api/v1/insight/ABC/leaps-score").status_code == 401
