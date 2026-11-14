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


def test_swing_for_uses_the_live_price_during_the_session(monkeypatch):
    from datetime import date
    from optionflow.modules.hedge import service
    px = ramp(100, 0.2, 260)
    bars = [{"date": f"2025-{1 + i // 28:02d}-{1 + i % 28:02d}", "close": c} for i, c in enumerate(px)]
    monkeypatch.setattr(service, "_daily_bars", lambda s: [{"date": b["date"], "close": c} for b, c in zip(bars, vix(15.0, n=260))]
                        if s == service.VIX else bars)
    monkeypatch.setattr(service, "_session_frac", lambda: (date(2026, 11, 16), 0.5))       # mid-session, no bar yet
    live_drop = px[-5] * 0.93                                                              # −7% vs 5 sessions ago
    r = service.swing_for("XYZ", live_drop)
    assert r["verdict"] == "BUY" and r["drop"] and r["stats"]["oos"]["trades"] == sw.STATS["oos"]["trades"]
    monkeypatch.setattr(service, "_session_frac", lambda: (date(2026, 11, 15), 1.0))       # weekend: last close stands
    assert service.swing_for("XYZ", live_drop)["verdict"] == "WAIT"


def test_seven_percent_drop_above_the_200_day_is_a_strong_buy():
    px = ramp(100, 0.2, 255) + [150.0, 148.0, 145.0, 142.0, 139.0]          # −7.9% vs 5 sessions ago
    r = sw.read(px, vix(15.0))
    assert r["verdict"] == "BUY" and r["strong"] and r["reason"].startswith("Strong swing buy")
    px5 = ramp(100, 0.2, 255) + [150.0, 149.0, 147.0, 145.0, 142.0]          # −5.4%: a buy, not strong
    r5 = sw.read(px5, vix(15.0))
    assert r5["verdict"] == "BUY" and not r5["strong"] and r5["reason"].startswith("Swing buy")
    assert not sw.read(ramp(100, 0.2, 260), vix(15.0))["strong"]
    assert sw.STATS["symbols"] == 200 and sw.STATS["strong_oos"]["avg"] > sw.STATS["oos"]["avg"]


def test_score_bands_rise_and_cover_every_score():
    from optionflow.modules.hedge import signal as sg
    edges = [b[3] for b in sg.SCORE_BANDS]
    assert edges == sorted(edges)                                    # the bigger the fear score, the bigger the edge
    assert sg.score_band(0.0)["label"] == "no fear dip" and sg.score_band(None) is None
    assert sg.score_band(sg.SCORE_CUT)["label"] == "near a Buy"       # the cut itself is ≤ its band's top
    assert sg.score_band(sg.SCORE_CUT + 0.001)["label"] == "Buy" and sg.score_band(0.9)["label"] == "strong Buy"
    assert sw.STATS["strong_net_unseen"]["avg"] > sw.STATS["net_unseen"]["avg"]
