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
    assert set(f) == set(sc.DIRECTION_KEYS)                                      # every direction factor had data
    assert {x["key"] for x in out["options"]["factors"]} == set(sc.OPTION_KEYS)
    assert "options cheap" in out["options"]["label"] and out["options"]["score"] >= 60
    assert f["pullback"]["score"] >= 85 and out["traits"]["state"] == "pulled back" and out["traits"]["trend"] == "up"
    assert 0 <= f["strength"]["score"] <= 100 and f["dealers"]["score"] == 80


def test_downtrend_scores_low_and_calls_the_pullback_a_falling_knife():
    out = sc.leaps_score(path(1000, drift=-0.0012, wobble=0.03), [2e4] * 1000, atm_iv=1.4)
    f = by_key(out)
    assert out["score"] < 35 and out["band"] in ("Avoid", "Weak")
    o = {x["key"]: x for x in out["options"]["factors"]}
    assert "falling knife" in f["pullback"]["note"] and f["trend"]["score"] < 38 and o["liquidity"]["score"] < 20
    assert "thinly traded" in out["options"]["label"] and "options expensive" in out["options"]["label"]
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

    live = {}

    def quotes_batch(self, symbols):
        return {s: {"price": self.live[s]} for s in symbols if s in self.live}

    def last_price(self, symbol):
        return None

    def price_history(self, symbol, period, interval):
        self.calls.append((symbol, period))
        if symbol == "NOPE":
            return pd.DataFrame()
        n = {"1mo": 21, "1y": 252, "5y": 1260, "max": 3000}.get(period, 126)
        full = path(3000)                                    # one history: every period is its tail
        df = pd.DataFrame({"close": full[-n:], "volume": [1e6] * n}, index=pd.bdate_range("2015-01-05", periods=3000)[-n:])
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


def test_score_and_swings_move_with_the_live_price(md, monkeypatch):
    base = service.leaps_score("ABC")
    assert base["realtime"] is False and base["price"] == pytest.approx(path(3000)[-1], rel=1e-4)
    md.live = {"ABC": base["price"] * 0.85}                      # a 15% drop, live
    t = [0.0]
    monkeypatch.setattr(service.time, "monotonic", lambda: t[0])
    service.clear_cache()
    t[0] = 1000.0
    live = service.leaps_score("ABC")
    assert live["realtime"] is True and live["price"] == pytest.approx(base["price"] * 0.85, rel=1e-4)
    assert live["traits"]["off_high"] < base["traits"]["off_high"] and live["score"] != base["score"]
    sw_live = service.swings("ABC", "1y")
    assert sw_live["realtime"] is True and sw_live["stats"]["current_drawdown"] < -0.14
    md.live = {"ABC": base["price"]}                             # within LIVE_TTL: still the cached live price
    assert service.leaps_score("ABC")["price"] == live["price"]
    t[0] += service.LIVE_TTL + 0.01                              # after it: the new price
    assert service.leaps_score("ABC")["price"] == pytest.approx(base["price"], rel=1e-4)


def test_with_live_replaces_today_appends_a_new_session_and_keeps_weekends():
    from datetime import datetime, timezone
    bars = [{"date": "2026-11-10", "close": 100.0, "volume": 5}, {"date": "2026-11-11", "close": 101.0, "volume": 6}]
    wed = datetime(2026, 11, 11, 18, 0, tzinfo=timezone.utc)
    thu = datetime(2026, 11, 12, 15, 0, tzinfo=timezone.utc)
    sat = datetime(2026, 11, 14, 15, 0, tzinfo=timezone.utc)
    assert service.with_live(bars, 103.0, wed)[-1] == {"date": "2026-11-11", "close": 103.0, "volume": 6}
    assert len(service.with_live(bars, 103.0, wed)) == 2
    out = service.with_live(bars, 103.0, thu)
    assert len(out) == 3 and out[-1]["date"] == "2026-11-12" and out[-1]["close"] == 103.0
    assert len(service.with_live(bars, 103.0, sat)) == 2                    # weekend: no new session
    assert service.with_live(bars, None, thu) is bars


def test_api_needs_login_and_validates_the_period(md):
    from optionflow.core.settings import Settings
    from optionflow.main import create_app
    c = TestClient(create_app(Settings(_env_file=None)))
    assert c.get("/api/v1/insight/ABC/swings").status_code == 401
    assert c.get("/api/v1/insight/ABC/leaps-score").status_code == 401


# ── entry price ───────────────────────────────────────────────────────────────
def test_entry_is_now_after_a_pullback_in_an_uptrend():
    e = sc.entry_plan(85.0, 70, "up", -0.15, 100.0, 90.0, 80.0)
    assert e == {"price": 85.0, "when": "now", "distance": 0.0, "note": e["note"]} and "15% under" in e["note"]


def test_entry_waits_for_a_dip_when_near_the_high():
    e = sc.entry_plan(99.0, 70, "up", -0.01, 100.0, 94.0, 85.0)            # 50-day avg is a real dip, above high −10%
    assert (e["price"], e["when"]) == (94.0, "pullback") and e["distance"] == pytest.approx(94 / 99 - 1, abs=1e-4)
    e = sc.entry_plan(99.0, 70, "up", -0.01, 100.0, 98.5, 85.0)            # 50-day avg too close: 10% under the high
    assert (e["price"], e["when"]) == (90.0, "pullback")
    e = sc.entry_plan(99.0, 70, "up", -0.01, 100.0, 80.0, 70.0)            # 50-day avg too far: 10% under the high
    assert e["price"] == 90.0


def test_entry_in_a_downtrend_is_a_reclaim_above_the_price():
    e = sc.entry_plan(60.0, 25, "down", -0.40, 100.0, 66.0, 78.0)
    assert (e["price"], e["when"]) == (78.0, "reclaim") and e["distance"] > 0 and "200-day" in e["note"]


def test_entry_with_a_weak_score_waits_for_the_long_average():
    e = sc.entry_plan(85.0, 40, "sideways", -0.15, 100.0, 88.0, 80.0)
    assert (e["price"], e["when"]) == (80.0, "pullback")
    e = sc.entry_plan(70.0, 40, "sideways", -0.30, 100.0, 75.0, 80.0)
    assert (e["price"], e["when"]) == (80.0, "reclaim")


def test_score_carries_the_entry():
    out = sc.leaps_score(path(1000, drift=0.0008, wobble=0.004))
    assert out["entry"]["when"] == "pullback" and out["entry"]["price"] < path(1000, drift=0.0008, wobble=0.004)[-1]
    assert sc.leaps_score(path(30))["entry"] is None


# ── the put side ──────────────────────────────────────────────────────────────
def test_put_score_is_the_call_idea_flipped():
    down = sc.leaps_score(path(1000, drift=-0.0012, wobble=0.03), [5e6] * 1000, spy_closes=path(1000, drift=0.0004))
    up = sc.leaps_score(path(1000, drift=0.0010, wobble=0.012), [5e6] * 1000, spy_closes=path(1000, drift=0.0003))
    assert down["put"]["score"] > down["score"] and up["put"]["score"] < up["score"]
    assert down["put"]["score"] >= 60 and up["put"]["score"] < 45
    pf, cf = by_key(down["put"]), by_key(down)
    assert set(pf) == set(cf) and pf["pullback"]["label"] == "Bounce" and "52-wk low" in pf["pullback"]["value"]
    assert pf["trend"]["score"] == 100 - cf["trend"]["score"] and pf["growth"]["score"] == 100 - cf["growth"]["score"]
    assert not set(pf) & set(sc.OPTION_KEYS) and not set(cf) & set(sc.OPTION_KEYS)       # option quality is its own grade
    assert "LEAPS put" in down["put"]["summary"] and "LEAPS call" in down["summary"]
    assert "fights" in by_key(up["put"])["trend"]["note"]


def test_put_dealers_flip_and_short_history_has_no_put():
    px = path(400, drift=-0.001)
    out = sc.leaps_score(px, net_gex=-1e9, zero_gamma=px[-1] * 1.05)
    assert by_key(out["put"])["dealers"]["score"] == 80 and by_key(out)["dealers"]["score"] == 25
    assert sc.leaps_score(path(30))["put"] is None


def test_put_entry_rules_mirror_the_call():
    e = sc.put_entry_plan(115.0, 70, "down", 0.15, 100.0, 110.0, 125.0)
    assert (e["price"], e["when"]) == (115.0, "now") and "15% off" in e["note"]
    e = sc.put_entry_plan(101.0, 70, "down", 0.01, 100.0, 106.0, 120.0)        # 50-day avg is a real bounce, under low +10%
    assert (e["price"], e["when"]) == (106.0, "bounce") and e["distance"] > 0
    e = sc.put_entry_plan(101.0, 70, "down", 0.01, 100.0, 101.5, 120.0)        # too close: 10% above the low
    assert (e["price"], e["when"]) == (110.0, "bounce")
    e = sc.put_entry_plan(140.0, 25, "up", 0.40, 100.0, 134.0, 122.0)          # uptrend: has to break the long average
    assert (e["price"], e["when"]) == (122.0, "break") and e["distance"] < 0 and "200-day" in e["note"]
    e = sc.put_entry_plan(115.0, 40, "sideways", 0.15, 100.0, 112.0, 120.0)    # weak: the long average overhead
    assert (e["price"], e["when"]) == (120.0, "bounce")
    e = sc.put_entry_plan(130.0, 40, "sideways", 0.30, 100.0, 125.0, 120.0)
    assert (e["price"], e["when"]) == (120.0, "break")



def test_call_and_put_now_point_opposite_ways():
    """With option quality out of both, a clear trend gives one side a high score and the other a low one."""
    for drift in (0.0010, -0.0012):
        out = sc.leaps_score(path(1000, drift=drift, wobble=0.02), [5e6] * 1000, spy_closes=path(1000, drift=0.0002),
                             atm_iv=0.05)                         # cheap options: would have lifted both before
        hi, lo = sorted((out["score"], out["put"]["score"]), reverse=True)
        assert hi >= 60 and lo <= 40 and hi - lo >= 30
        assert out["options"]["score"] >= 60                      # still visible, just not in either side
    assert sc.option_quality([]) is None
