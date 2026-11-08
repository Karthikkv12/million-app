"""Hedge engine: Greeks, HV, IV tracker and the delta-neutral suggestion rules (pure, no network)."""
import math

import pytest

from optionflow.modules.hedge import bs
from optionflow.modules.hedge.ivtrack import IvTracker
from optionflow.modules.hedge.suggest import Context, Leg, Quote, evaluate, pick_weekly

EXP = "2026-11-13"


def chain(spot_iv=0.45, dte=5, strikes=range(94, 109)):
    out = []
    for k in strikes:
        for t in ("call", "put"):
            out.append(Quote(float(k), t, spot_iv, 1.0, 1.2, 1.1, dte, EXP))
    return out


def stock(qty=100, avg=100.0):
    return Leg("stock", qty, avg)


def short_call(k, dte=5, iv=0.30, n=1):
    return Leg("option", -n, 1.0, "call", k, EXP, dte, iv)


# ── math ──────────────────────────────────────────────────────────────────────
def test_delta_matches_finite_difference_and_parity():
    S, K, T, iv = 100.0, 101.0, 5 / 365, 0.45
    c, p = bs.delta(S, K, T, iv, "call"), bs.delta(S, K, T, iv, "put")
    assert c - p == pytest.approx(1.0, abs=1e-12)             # put-call delta parity
    g = bs.gamma(S, K, T, iv)
    fd = (bs.delta(S + 0.01, K, T, iv, "call") - bs.delta(S - 0.01, K, T, iv, "call")) / 0.02
    assert g == pytest.approx(fd, rel=1e-4)


def test_expired_or_no_iv_falls_back_to_intrinsic():
    assert bs.delta(105, 100, 0, 0.3, "call") == 1.0
    assert bs.delta(95, 100, 0, 0.3, "call") == 0.0
    assert bs.delta(95, 100, 0.1, 0.0, "put") == -1.0
    assert bs.gamma(100, 100, 0, 0.3) == 0.0


def test_historical_vol_annualises():
    closes = [100 * math.exp(0.01 * (i % 2)) for i in range(30)]    # alternating ±1% log moves
    hv = bs.historical_vol(closes, 20)
    assert hv == pytest.approx(0.01 * 1.0258 * math.sqrt(252), rel=0.05)
    assert bs.historical_vol(closes[:10], 20) is None


# ── IV tracker ────────────────────────────────────────────────────────────────
def test_iv_spike_needs_iv_jump_and_price_up():
    t0 = 1_762_600_000.0                                             # one UTC day
    tr = IvTracker()
    tr.record("UPST", 0.50, t0)
    tr.record("UPST", 0.52, t0 + 1800)
    tr.record("UPST", 0.58, t0 + 3600)
    s = tr.state("UPST", day_change=0.03, now=t0 + 3600)
    assert s.atm_iv == 0.58 and s.iv_roc_day == pytest.approx(0.16)
    assert s.spike
    assert not tr.state("UPST", day_change=0.002, now=t0 + 3600).spike   # IV up, stock flat → no spike
    tr.record("UPST", 0.53, t0 + 5400)
    s2 = tr.state("UPST", day_change=0.01, now=t0 + 5400)
    assert s2.cooling and not s2.spike


# ── engine: the owner's example ───────────────────────────────────────────────
def test_owner_example_sell_itm_call_on_rise_takes_delta_to_about_plus_0_3():
    # 100 shares @ $100, stock at $102 → book delta +1.00; bull regime target +0.30.
    ctx = Context("XYZ", spot=102.0, avg_cost=100.0, day_change=0.02, atm_iv=0.45, hv20=0.40, net_gex=1e9)
    book = evaluate(ctx, [stock()], chain())
    s = book.suggestion
    assert book.net_delta == pytest.approx(1.0)
    assert s.action == "SELL_CALL" and s.contracts == 1
    assert 100.0 <= s.strike <= 102.0                                # never below the average
    assert s.option_delta == pytest.approx(-0.7, abs=0.08)
    assert s.net_delta_after == pytest.approx(0.3, abs=0.08)
    assert s.locked_gain == pytest.approx((s.strike - 100 + 1.1) * 100)


def test_king_node_preferred_when_close_enough():
    ctx = Context("XYZ", 102.0, 100.0, 0.02, atm_iv=0.45, hv20=0.40, net_gex=1e9, king=101.0)
    s = evaluate(ctx, [stock()], chain()).suggestion
    assert s.action == "SELL_CALL" and s.strike == 101.0


def test_no_call_below_average_cost():
    ctx = Context("XYZ", 99.0, 100.0, -0.01, atm_iv=0.45, hv20=0.40, net_gex=1e9)
    s = evaluate(ctx, [stock()], chain()).suggestion
    assert s.action == "WAIT" and "loss" in " ".join(s.reasons)


def test_small_rise_without_spike_waits():
    ctx = Context("XYZ", 101.0, 100.0, 0.01, atm_iv=0.45, hv20=0.40, net_gex=1e9)
    assert evaluate(ctx, [stock()], chain()).suggestion.action == "WAIT"
    ctx.iv_spike = True                                              # an IV spike triggers it early
    assert evaluate(ctx, [stock()], chain()).suggestion.action == "SELL_CALL"


def test_pullback_after_call_is_too_long_and_lots_are_covered_so_buy_put():
    # Shares + short 101C, stock back to $99 → call delta falls → net ≈ +0.6 > +0.30 target.
    ctx = Context("XYZ", 99.0, 100.0, -0.02, day_high=102.0, atm_iv=0.45, hv20=0.40, net_gex=1e9)
    book = evaluate(ctx, [stock(), short_call(101.0)], chain())
    assert book.net_delta > 0.45
    assert book.suggestion.action == "BUY_PUT"                       # a SHORT put would add delta


def test_deep_itm_call_leaves_book_short_of_target_then_sell_put_on_pullback():
    # Stock ran to $110: short 101C delta → ~0.97 → net ≈ +0.03 < +0.30. On a pullback, a short put restores delta.
    legs = [stock(), short_call(101.0)]
    ctx = Context("XYZ", 106.0, 100.0, 0.01, day_high=111.0, atm_iv=0.30, hv20=0.40, net_gex=1e9, put_wall=104.0)
    book = evaluate(ctx, legs, chain())
    s = book.suggestion
    assert book.gap > 0.15
    assert s.action == "SELL_PUT" and s.strike <= 106.0
    assert s.option_delta > 0                                        # short put = positive delta
    assert s.net_delta_after == pytest.approx(0.3, abs=0.2)


def test_never_sell_puts_into_an_iv_spike():
    legs = [stock(), short_call(101.0)]
    ctx = Context("XYZ", 108.0, 100.0, 0.05, day_high=108.0, atm_iv=0.45, hv20=0.40, net_gex=1e9, iv_spike=True)
    s = evaluate(ctx, legs, chain(0.45)).suggestion
    assert s.action == "WAIT" and "spik" in s.headline


def test_high_vol_regime_targets_neutral():
    ctx = Context("XYZ", 102.0, 100.0, 0.02, atm_iv=0.60, hv20=0.40, net_gex=-1e9)
    book = evaluate(ctx, [stock()], chain(0.6))
    assert book.regime == "high-vol" and book.target_delta == 0.0
    s = book.suggestion
    assert s.action == "SELL_CALL" and s.strike == 100.0                # deepest strike allowed (never below average)
    assert any("Capped by your average" in r for r in s.reasons)


def test_on_target_holds_and_short_dated_short_warns():
    ctx = Context("XYZ", 101.0, 100.0, 0.0, atm_iv=0.45, hv20=0.40, net_gex=1e9)
    book = evaluate(ctx, [stock(), Leg("option", -1, 1.0, "call", 101.0, EXP, 1, 0.45)], chain())
    # 1-DTE ATM call delta ≈ 0.5 → net ≈ +0.5: not on target, but the 0–1 DTE warning is raised.
    assert any("gamma trap" in w for w in book.suggestion.warnings)


def test_options_only_position_is_tracked_not_advised():
    ctx = Context("BMNR", 40.0, None, atm_iv=0.9, hv20=0.8)
    book = evaluate(ctx, [Leg("option", -1, 2.6, "put", 35.0, "2027-01-15", 68, 0.9)], [])
    assert book.suggestion.action == "TRACK"
    assert book.net_delta > 0                                        # short put = long delta


def test_pick_weekly_skips_0_1_dte():
    assert pick_weekly([("a", 0), ("b", 1), ("c", 4), ("d", 11)]) == "c"
    assert pick_weekly([("a", 1), ("d", 11)]) == "d"
