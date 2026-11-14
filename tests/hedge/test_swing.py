"""hedge.swing: the backtested swing read (fear dip, or a 5% 5-day drop above the 200-day; sell above the 10-day)."""
from optionflow.modules.hedge import swing as sw
from tests.hedge.test_signal import ramp, selloff, vix


def test_needs_200_days():
    assert sw.read(ramp(100, 0.1, 150), vix(20.0)) is None


def test_quiet_uptrend_waits_and_names_the_drop_trigger():
    px = ramp(100, 0.2, 260)
    r = sw.read(px, vix(15.0))
    assert r["verdict"] == "WAIT" and r["buy_below"] == round(px[-6] * 0.95, 2)
    assert "Swing buy if it closes ≤" in r["reason"]
    nxt = sw.read(px, vix(15.0), live=False)                     # decided on the next session's close
    assert nxt["buy_below"] == round(px[-5] * 0.95, 2)


def test_five_percent_drop_above_the_200_day_is_a_buy():
    px = ramp(100, 0.2, 255) + [150.0, 149.0, 147.0, 145.0, 142.0]
    r = sw.read(px, vix(15.0))
    assert px[-1] / px[-6] - 1 <= -0.05 and r["verdict"] == "BUY" and r["drop"] and not r["fear"]
    assert r["exit_above"] == round(sum(px[-10:]) / 10, 2) and r["max_days"] == 20
    assert "first close above the 10-day average" in r["reason"]


def test_same_drop_under_the_200_day_is_not_a_buy_without_fear():
    px = ramp(200, -0.2, 255) + [148.0, 146.0, 144.0, 141.0, 138.0]
    r = sw.read(px, vix(15.0))
    assert r["verdict"] == "WAIT" and r["vs_200d"] < 0 and "only a fear dip qualifies" in r["reason"]


def test_fear_dip_is_a_buy_even_under_the_200_day():
    r = sw.read(selloff(), vix(35.0))
    assert r["verdict"] == "BUY" and r["fear"]


def test_matches_the_backtest_setup_on_random_days():
    """Parity with scripts/backtest_signal/swing2.py's definition: Add | (ret5 ≤ −5% & close > 200-day)."""
    import random
    rnd = random.Random(3)
    from optionflow.modules.hedge import signal as sg
    for _ in range(300):
        p, px = 100.0, []
        for _ in range(260):
            p *= 1 + rnd.gauss(0.0005, 0.02); px.append(p)
        vx = vix(rnd.uniform(10, 40))
        r = sw.read(px, vx)
        fs = sg.fear_score(sg.vix_percentile(vx), sg.rsi(px))
        want = (fs is not None and fs >= sg.SCORE_CUT) or (px[-1] / px[-6] - 1 <= -0.05 and px[-1] > sum(px[-200:]) / 200)
        assert (r["verdict"] == "BUY") == want
