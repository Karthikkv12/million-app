"""hedge.signal: the backtested ADD / HOLD / CAUTION read for holdings tracked as stock (pure)."""
from optionflow.modules.hedge import signal as sg
from optionflow.modules.hedge.suggest import Context, Leg, evaluate


def ramp(start, step, n=260):
    return [start + step * i for i in range(n)]


def vix(last, n=252, lo=12.0, hi=30.0):
    """A year of VIX closes spread lo…hi, ending at `last`."""
    return [lo + (hi - lo) * i / (n - 2) for i in range(n - 1)] + [last]


def tape(closes, **kw):
    spot = kw.pop("spot", closes[-1])
    return sg.Tape(spot, closes, [1_000_000] * len(closes), [c * 1.01 for c in closes], [c * 0.99 for c in closes],
                   today_bar=True, **kw)


def selloff(n=260):
    """Up for most of the year, then a sharp 3-week drop: RSI deep under 40."""
    return ramp(100, 0.2, n - 15) + [149 - 2.5 * i for i in range(1, 16)]


def test_vix_percentile_matches_the_backtest_rank():
    assert sg.vix_percentile(vix(40.0)) == 1.0
    assert sg.vix_percentile(vix(5.0)) == 1 / 252
    assert sg.vix_percentile([20.0] * 50) is None                    # under half a year: no read


def long_history(n=1600, calm_vol=0.01, crash_days=15, seed=1):
    """Years of quiet random-walk closes, then a sharp, volatile sell-off; a VIX that sits low then spikes."""
    import random
    rnd = random.Random(seed)
    px, p = [], 100.0
    for i in range(n - crash_days):
        p *= 1 + rnd.gauss(0.0004, calm_vol); px.append(p)
    for i in range(crash_days):
        p *= 1 + (-0.03 if i % 3 else 0.035); px.append(p)
    vx = [14.0 + 2 * ((i * 7919) % 10) / 10 for i in range(n - 10)] + [24, 27, 30, 33, 35, 36, 38, 37, 39, 40]
    return px, vx


def test_dip_during_market_fear_with_elevated_stock_iv_is_add():
    px, vx = long_history()
    s = sg.evaluate(tape(px, vix=vx), exposure=0.7)
    assert s.iv_ratio and s.iv_ratio >= sg.IV_GATE
    assert s.verdict == "ADD" and s.side == "long" and s.vix_pct >= 0.8
    assert s.headline.startswith("Add: fear dip with the stock's IV elevated") and "365+ days" in s.headline
    assert "simulated 365-day" in s.evidence and s.stop is None        # no stop during fear
    assert any(r.startswith("No stop during market fear") for r in sg.reasons(s))
    assert any(r.startswith("Stock IV") for r in sg.reasons(s))
    low_live = tape(px, vix=vx, atm_iv=s.iv_normal * 1.05)             # the chain prices little fear: no add
    assert sg.evaluate(low_live, exposure=0.7).verdict == "HOLD"


def test_fear_dip_without_elevated_stock_iv_is_hold():
    s = sg.evaluate(tape(selloff(), vix=vix(35.0)), exposure=0.7)     # one year only: no IV history → no gate pass
    assert s.verdict == "HOLD" and s.headline.startswith("Hold: fear dip, but the stock's own IV isn't elevated")
    assert "thin edge" in s.evidence


def test_iv_model_needs_history_and_matches_a_calm_stock():
    assert sg.iv_model([100.0] * 300, [15.0] * 300) == (None, None, None)
    px, _ = long_history(crash_days=0)
    now, base, ratio = sg.iv_model(px, [14.0 + 2 * ((i * 7919) % 10) / 10 for i in range(len(px))])
    assert 0.08 < now < 0.4 and 0.7 < ratio < 1.3                     # ~16% realised vol, nothing unusual


def test_leg_decay_grows_as_time_runs_out_and_triggers_roll():
    far = sg.leg_decay(100.0, {"otype": "call", "strike": 80.0, "dte": 400, "iv": 0.4, "quantity": 2}, None, 0.04)
    near = sg.leg_decay(100.0, {"otype": "call", "strike": 85.0, "dte": 90, "iv": 0.4, "quantity": 2}, None, 0.04)
    assert far["decay_20d"] < 0.03 and not far["roll"]
    assert near["decay_20d"] >= sg.ROLL_DECAY and near["roll"] and near["theta_day"] > far["theta_day"]
    assert sg.leg_decay(100.0, {"otype": "call", "strike": 80.0, "dte": 100}, None, 0.04) is None   # no IV at all
    m = sg.leg_decay(100.0, {"otype": "call", "strike": 80.0, "dte": 400}, None, 0.04, (0.6, 0.4))  # no quote: model
    assert m["iv_source"] == "model" and 0.4 < m["iv"] < 0.6                 # long-dated IV sits between IV30 and normal


def test_a_short_dated_leg_turns_the_verdict_into_roll():
    legs = [{"otype": "call", "strike": 120.0, "expiry": "2027-02-19", "dte": 95, "iv": 0.45, "quantity": 1}]
    s = sg.evaluate(tape(ramp(100, 0.1), vix=vix(20.0), legs=legs), exposure=0.8)
    assert s.verdict == "ROLL" and s.headline.startswith("Roll the 120C 2027-02-19") and s.legs[0]["roll"]
    assert any("→ roll." in r for r in sg.reasons(s))
    puts = [{"otype": "put", "strike": 150.0, "dte": 95, "iv": 0.5, "quantity": 1}]
    assert sg.evaluate(tape(selloff(), vix=vix(35.0), legs=puts), exposure=-0.5).verdict == "TRIM"   # take profit first


def test_same_dip_in_a_calm_market_is_dont_add_not_a_sell():
    s = sg.evaluate(tape(selloff(), vix=vix(12.5)), exposure=0.7)
    assert s.verdict == "CAUTION" and s.headline.startswith("Don't add: stock-specific weakness")


def test_stretched_in_a_calm_market_is_dont_add():
    closes = ramp(100, 0.05, 230) + [111.5 + 0.6 * i for i in range(30)]
    s = sg.evaluate(tape(closes, vix=vix(12.5)), exposure=1.0)
    assert s.verdict == "CAUTION" and "stretched" in s.headline


def test_quiet_uptrend_with_normal_vix_is_hold():
    s = sg.evaluate(tape(ramp(100, 0.05), vix=vix(20.0)), exposure=1.0)
    assert s.verdict == "HOLD" and s.headline.startswith("Hold: no edge")


def test_oversold_without_enough_fear_is_hold_with_the_vix_trigger():  # noqa: D103
    px, vx = long_history()
    vx = vx[:-10] + [15.0] * 10                                      # VIX back to ~65th percentile
    s = sg.evaluate(tape(px, vix=vx), exposure=1.0)
    assert s.iv_ratio >= sg.IV_GATE and s.verdict == "HOLD"
    assert s.headline.startswith("Hold: oversold, but the market isn't scared") and "ADD if VIX closes ≥" in s.headline
    assert "no edge" in s.evidence
    short = sg.evaluate(tape(selloff(), vix=vix(25.0)), exposure=1.0)   # no IV history: no VIX trigger offered
    assert "ADD if VIX" not in short.headline


def test_long_puts_take_profit_on_the_fear_dip():
    s = sg.evaluate(tape(selloff(), vix=vix(35.0)), exposure=-0.8)
    assert s.side == "short" and s.verdict == "TRIM"


def test_score_and_verdict_use_only_tested_reads():
    t = tape(selloff(), vix=vix(35.0), atm_iv=0.5, hv20=0.4, zero_gamma=150.0, flow=(3e6, 1e6, 0.5e6, 1.5e6))
    s = sg.evaluate(t, exposure=1.0)
    tested = {r["key"] for r in s.reads if r["tested"]}
    assert tested == {"fear", "momentum", "dip"}
    assert {"flow", "dealers", "trend", "volume", "volatility"} <= {r["key"] for r in s.reads if not r["tested"]}
    assert s.score > 50 and s.bias == "bullish"
    lines = sg.reasons(s)
    assert any(l.endswith("(context, not in the verdict)") for l in lines)


def test_without_vix_the_verdict_says_it_is_untested():
    s = sg.evaluate(tape(ramp(100, 0.1)), exposure=1.0)
    assert s.verdict == "HOLD" and "not tested" in s.headline and s.score == 0


def test_levels_include_walls_averages_and_expected_move():
    t = tape(ramp(100, 0.1), atm_iv=0.40, put_wall=118.0, call_wall=125.0, max_pain=120.0, vix=vix(20.0))
    s = sg.evaluate(t, exposure=1.0)
    keys = {l["key"] for l in s.levels}
    assert {"put_wall", "call_wall", "max_pain", "ma20", "ma50", "ma200", "high20", "low20", "em_week_lo"} <= keys
    assert s.expected_move["week"] > s.expected_move["day"] > 0


def test_calm_market_above_the_200_day_has_a_risk_line():
    s = sg.evaluate(tape(ramp(100, 0.05), vix=vix(12.5)), exposure=1.0)
    assert s.stop is not None and s.stop < s.levels[0]["price"]


def test_desk_attaches_the_signal_to_long_option_holdings_only():
    ctx = Context("NVDA", 162.0, None, day_change=-2.0, atm_iv=0.45, hv20=0.40, put_wall=155.0, call_wall=175.0)
    legs = [Leg("option", 1, 40.0, "call", 130.0, "2028-01-21", 434, 0.45)]
    book = evaluate(ctx, legs, [], None, None, tape(ramp(120, 0.2), spot=162.0, vix=vix(20.0)))
    assert book.signal and book.signal["verdict"] in ("ADD", "HOLD", "CAUTION")
    assert book.suggestion.headline == book.signal["headline"]
    assert book.suggestion.reasons[0] == book.signal["evidence"]
    book = evaluate(ctx, [Leg("stock", 100, 150.0)], [], None)
    assert book.signal is None
