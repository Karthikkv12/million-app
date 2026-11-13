"""hedge.signal: levels and the ADD / HOLD / TRIM read for holdings tracked as stock (pure)."""
from optionflow.modules.hedge import signal as sg
from optionflow.modules.hedge.suggest import Context, Leg, evaluate


def ramp(start, step, n=220):
    return [start + step * i for i in range(n)]


def tape(closes, vols=None, **kw):
    vols = vols or [1_000_000] * len(closes)
    spot = kw.pop("spot", closes[-1])
    return sg.Tape(spot, closes, vols, [c * 1.01 for c in closes], [c * 0.99 for c in closes], **kw)


def test_uptrend_with_bullish_flow_and_volume_says_add_for_a_long():
    closes = ramp(100, 0.25)                              # steady uptrend to ~155
    vols = [1_000_000] * (len(closes) - 1) + [2_500_000]
    t = tape(closes, vols, today_bar=True, day_change=1.5, atm_iv=0.35, hv20=0.30,
             zero_gamma=140.0, put_wall=150.0, call_wall=165.0, flow=(3e6, 1e6, 0.5e6, 1.5e6))
    s = sg.evaluate(t, exposure=0.7)
    assert s.bias == "bullish" and s.verdict == "ADD" and s.side == "long"
    assert s.support and s.support["price"] <= t.spot and s.resistance["price"] > t.spot
    assert s.stop < s.support["price"] and s.headline.startswith("Add on a dip to")
    assert {r["key"] for r in s.reads} == {"flow", "trend", "dealers", "volume", "momentum", "volatility"}


def test_same_tape_says_trim_for_long_puts():
    closes = ramp(100, 0.25)
    t = tape(closes, today_bar=True, day_change=1.5, atm_iv=0.35, hv20=0.30, zero_gamma=140.0,
             flow=(3e6, 1e6, 0.5e6, 1.5e6))
    s = sg.evaluate(t, exposure=-0.8)
    assert s.side == "short" and s.verdict == "TRIM" and s.stop > t.spot


def test_downtrend_below_flip_with_iv_spike_is_bearish():
    closes = ramp(200, -0.3)
    vols = [1_000_000] * (len(closes) - 1) + [3_000_000]
    t = tape(closes, vols, today_bar=True, day_change=-4.0, atm_iv=0.7, hv20=0.4, iv_spike=True,
             zero_gamma=150.0, flow=(0.5e6, 2e6, 3e6, 0.5e6))
    s = sg.evaluate(t, exposure=0.6)
    assert s.bias == "bearish" and s.score <= -40 and s.verdict == "TRIM"


def test_flow_under_minimum_and_missing_data_are_left_out():
    t = sg.Tape(100.0, flow=(1e4, 0, 0, 0))
    s = sg.evaluate(t, exposure=1.0)
    assert s.reads == [] and s.score == 0 and s.verdict == "HOLD"


def test_levels_include_walls_averages_and_expected_move():
    t = tape(ramp(100, 0.1), atm_iv=0.40, put_wall=118.0, call_wall=125.0, max_pain=120.0)
    s = sg.evaluate(t, exposure=1.0)
    keys = {l["key"] for l in s.levels}
    assert {"put_wall", "call_wall", "max_pain", "ma20", "ma50", "ma200", "high20", "low20", "em_week_lo"} <= keys
    assert s.expected_move["week"] > s.expected_move["day"] > 0
    assert [l["price"] for l in s.levels] == sorted((l["price"] for l in s.levels), reverse=True)


def test_volume_uses_the_last_session_when_today_has_no_bar():
    closes = ramp(100, 0.2)
    vols = [1_000_000] * (len(closes) - 1) + [3_000_000]
    t = tape(closes, vols, spot=closes[-1] * 1.01, today_bar=False)
    s = sg.evaluate(t, exposure=1.0)
    v = next(r for r in s.reads if r["key"] == "volume")
    assert "last session" in v["note"] and v["score"] > 0


def test_desk_attaches_the_signal_to_long_option_holdings_only():
    ctx = Context("NVDA", 162.0, None, day_change=-2.0, atm_iv=0.45, hv20=0.40, put_wall=155.0, call_wall=175.0)
    legs = [Leg("option", 1, 40.0, "call", 130.0, "2028-01-21", 434, 0.45)]
    book = evaluate(ctx, legs, [], None, None, tape(ramp(120, 0.2), spot=162.0))
    assert book.signal and book.signal["verdict"] in ("ADD", "HOLD", "TRIM")
    assert book.suggestion.headline == book.signal["headline"]
    assert any(r.startswith("Levels:") for r in book.suggestion.reasons)
    book = evaluate(ctx, [Leg("stock", 100, 150.0)], [], None)
    assert book.signal is None
