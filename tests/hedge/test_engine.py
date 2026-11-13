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


# ── engine: the owner's playbook (sell calls on spikes, puts on pullbacks, buy stock) ──
def short_put(k, dte=5, iv=0.30, n=1):
    return Leg("option", -n, 1.0, "put", k, EXP, dte, iv)


def test_spike_sells_itm_call_closest_to_average():
    # 100 sh @ $100, stock at $102 (+2%) → sell the call ITM, at the strike nearest the average from above.
    ctx = Context("XYZ", spot=102.0, avg_cost=100.0, day_change=0.02, day_high=102.0, atm_iv=0.45, hv20=0.40, net_gex=1e9)
    book = evaluate(ctx, [stock()], chain())
    s = book.suggestion
    assert book.net_delta == pytest.approx(1.0)
    assert book.target_delta == 1.0                                  # reference is the stock alone, not neutral
    assert s.action == "SELL_CALL" and s.contracts == 1 and s.strike == 100.0
    assert s.option_delta < -0.5                                     # in the money
    assert s.locked_gain == pytest.approx((100.0 - 100 + 1.1) * 100)


def test_call_never_below_average():
    ctx = Context("XYZ", 103.5, 100.5, 0.03, day_high=103.5, atm_iv=0.45, hv20=0.40, net_gex=1e9)
    s = evaluate(ctx, [stock(avg=100.5)], chain()).suggestion
    assert s.action == "SELL_CALL" and s.strike == 101.0


def test_no_call_at_or_below_average():
    ctx = Context("XYZ", 99.5, 100.0, 0.005, day_high=99.6, atm_iv=0.45, hv20=0.40, net_gex=1e9)
    s = evaluate(ctx, [stock()], chain()).suggestion
    assert s.action == "WAIT" and "loss" in " ".join(s.reasons)


def test_small_rise_without_spike_waits_spike_triggers():
    ctx = Context("XYZ", 101.0, 100.0, 0.01, day_high=101.0, atm_iv=0.45, hv20=0.40, net_gex=1e9)
    assert evaluate(ctx, [stock()], chain()).suggestion.action == "WAIT"
    ctx.iv_spike = True
    assert evaluate(ctx, [stock()], chain()).suggestion.action == "SELL_CALL"


def test_pullback_after_call_sells_put_below_average():
    ctx = Context("XYZ", 101.0, 100.0, -0.01, day_high=103.0, atm_iv=0.45, hv20=0.40, net_gex=1e9)
    book = evaluate(ctx, [stock(), short_call(100.0)], chain())
    s = book.suggestion
    assert s.action == "SELL_PUT" and s.strike == 99.0              # highest strike below the $100 average
    assert s.option_delta > 0                                        # short put = positive delta
    assert s.new_avg == pytest.approx(99.0 - 1.1)


def test_never_buys_options():
    for spot, chg, hi in [(99.0, -0.02, 102.0), (110.0, 0.05, 110.0), (106.0, 0.01, 111.0)]:
        for legs in ([stock()], [stock(), short_call(101.0)], [stock(), short_call(101.0), short_put(98.0)]):
            ctx = Context("XYZ", spot, 100.0, chg, day_high=hi, atm_iv=0.45, hv20=0.40, net_gex=1e9)
            assert evaluate(ctx, legs, chain()).suggestion.action in {"SELL_CALL", "SELL_PUT", "BUY_STOCK", "HOLD", "WAIT"}


def test_never_sell_puts_into_an_iv_spike():
    legs = [stock(), short_call(101.0)]
    ctx = Context("XYZ", 108.0, 100.0, 0.05, day_high=110.0, atm_iv=0.45, hv20=0.40, net_gex=1e9, iv_spike=True)
    s = evaluate(ctx, legs, chain(0.45)).suggestion
    assert s.action == "WAIT" and "spik" in s.headline


def test_fully_worked_holds():
    ctx = Context("XYZ", 101.0, 100.0, -0.01, day_high=103.0, atm_iv=0.45, hv20=0.40, net_gex=1e9)
    s = evaluate(ctx, [stock(), short_call(100.0), short_put(99.0)], chain()).suggestion
    assert s.action == "HOLD"


def test_odd_lot_below_average_buys_stock_to_round_up():
    ctx = Context("XYZ", 95.0, 100.0, -0.01, atm_iv=0.45, hv20=0.40)
    s = evaluate(ctx, [stock(qty=60)], chain()).suggestion
    assert s.action == "BUY_STOCK" and s.shares == 40
    assert s.new_avg == pytest.approx((100 * 60 + 95 * 40) / 100)


def test_short_dated_short_warns():
    ctx = Context("XYZ", 101.0, 100.0, 0.0, atm_iv=0.45, hv20=0.40, net_gex=1e9)
    book = evaluate(ctx, [stock(), Leg("option", -1, 1.0, "call", 101.0, EXP, 1, 0.45)], chain())
    assert any("gamma trap" in w for w in book.suggestion.warnings)


def test_options_only_position_is_tracked_not_advised():
    ctx = Context("BMNR", 40.0, None, atm_iv=0.9, hv20=0.8)
    book = evaluate(ctx, [Leg("option", -1, 2.6, "put", 35.0, "2027-01-15", 68, 0.9)], [])
    assert book.suggestion.action == "TRACK"
    assert book.net_delta > 0                                        # short put = long delta


def test_leaps_only_holding_is_long_stock_under_any_strategy():
    from optionflow.modules.strategy.catalog import get
    ctx = Context("NVDA", 162.0, None, atm_iv=0.45, hv20=0.40)
    leaps = [Leg("option", 1, 40.0, "call", 130.0, "2028-01-21", 434, 0.45)]
    for rules in (None, get("diagonal").rules, get("leaps").rules, get("wheel").rules):
        book = evaluate(ctx, [Leg(**vars(l)) for l in leaps], [], rules, chain())
        assert book.suggestion.action == "TRACK" and book.strategy == "long_stock"
        assert book.closes == [] and book.signal["side"] == "long"
        assert any("tracked as long stock" in r for r in book.suggestion.reasons)
    sold = leaps + [short_call(170.0, dte=30)]                       # a short call on it: back to the strategy
    book = evaluate(ctx, sold, [], get("diagonal").rules, chain())
    assert book.strategy == "diagonal"


def test_long_put_only_holding_is_short_stock():
    from optionflow.modules.strategy.catalog import get
    ctx = Context("NBIS", 115.0, None, atm_iv=0.7, hv20=0.6)
    puts = [Leg("option", 2, 9.0, "put", 110.0, "2027-06-17", 216, 0.7)]
    book = evaluate(ctx, puts, [], get("wheel").rules, chain())
    assert book.suggestion.action == "TRACK" and book.strategy == "long_stock" and book.net_delta < 0
    assert book.signal["side"] == "short" and any("tracked as short stock" in r for r in book.suggestion.reasons)
    mixed = [Leg(**vars(puts[0])), Leg("option", 1, 40.0, "call", 90.0, "2028-01-21", 434, 0.7)]
    assert evaluate(ctx, mixed, [], None, chain()).strategy == "long_stock"
    short_put = [Leg("option", -1, 3.0, "put", 100.0, EXP, 5, 0.7)]
    assert evaluate(ctx, short_put, [], None, chain()).strategy != "long_stock"


def test_pick_weekly_skips_0_1_dte():
    assert pick_weekly([("a", 0), ("b", 1), ("c", 4), ("d", 11)]) == "c"
    assert pick_weekly([("a", 1), ("d", 11)]) == "d"


# ── units (owner): covered shares + their calls are one unit, the rest another ─────────────
def test_units_split_covered_and_uncovered():
    ctx = Context("XYZ", 100.0, 95.0, 0.0, atm_iv=0.45, hv20=0.40, net_gex=1e9)
    book = evaluate(ctx, [stock(qty=500, avg=95.0), short_call(98.0, n=3)], chain())
    kinds = {u.kind: u for u in book.units}
    assert kinds["covered"].shares == 300 and kinds["covered"].contracts == -3
    assert kinds["uncovered"].shares == 200 and kinds["uncovered"].delta == pytest.approx(2.0)
    cov = kinds["covered"].delta
    assert cov == pytest.approx(3.0 + 3 * book.legs[1].position_delta / 3, abs=1e-3)
    assert cov + kinds["uncovered"].delta == pytest.approx(book.net_delta, abs=1e-3)
    assert kinds["covered"].per_lot == pytest.approx(cov / 3, abs=1e-3)


def test_fully_covered_is_one_unit_and_call_covers_whole_uncovered_unit():
    ctx = Context("XYZ", 100.0, 95.0, 0.0, atm_iv=0.45, hv20=0.40, net_gex=1e9)
    book = evaluate(ctx, [stock(qty=300, avg=95.0), short_call(98.0, n=3)], chain())
    assert [u.kind for u in book.units] == ["covered"]
    ctx = Context("XYZ", 103.0, 100.0, 0.03, day_high=103.0, atm_iv=0.45, hv20=0.40, net_gex=1e9)
    s = evaluate(ctx, [stock(qty=500), short_call(104.0, n=3)], chain()).suggestion
    assert s.action == "SELL_CALL" and s.contracts == 2                 # the 200-share unit, in one go


def test_put_that_pays_too_little_waits():
    cheap = [Quote(float(k), t, 0.45, 0.01, 0.02, 0.015, 5, EXP) for k in range(94, 109) for t in ("call", "put")]
    ctx = Context("XYZ", 101.0, 100.0, -0.01, day_high=103.0, atm_iv=0.45, hv20=0.40, net_gex=1e9)
    s = evaluate(ctx, [stock(), short_call(100.0)], cheap).suggestion
    assert s.action == "WAIT" and "too little" in s.headline


# ── buy-backs (owner): close a short option once most of the premium is captured ──────────
def sold(otype, k, sold_at, mark, dte=5, n=1):
    l = Leg("option", -n, sold_at, otype, k, EXP, dte, 0.4)
    l.mark = mark
    return l


def test_buyback_at_80pct_any_time():
    ctx = Context("XYZ", 100.0, 95.0, 0.0, atm_iv=0.45, hv20=0.40, net_gex=1e9)
    book = evaluate(ctx, [stock(avg=95.0), sold("call", 110.0, 1.00, 0.15, dte=2)], chain())
    assert len(book.closes) == 1
    c = book.closes[0]
    assert c.profit_pct == pytest.approx(0.85) and c.cost == pytest.approx(15.0) and c.kept == pytest.approx(85.0)
    assert "Buy back 1 110C" in c.headline


def test_buyback_at_50pct_only_with_time_left():
    ctx = Context("XYZ", 100.0, 95.0, 0.0, atm_iv=0.45, hv20=0.40, net_gex=1e9)
    early = evaluate(ctx, [stock(avg=95.0), sold("put", 90.0, 1.00, 0.45, dte=6)], chain())
    late = evaluate(ctx, [stock(avg=95.0), sold("put", 90.0, 1.00, 0.45, dte=2)], chain())
    assert len(early.closes) == 1 and not late.closes


def test_no_buyback_when_not_enough_profit_or_worthless_at_expiry():
    ctx = Context("XYZ", 100.0, 95.0, 0.0, atm_iv=0.45, hv20=0.40, net_gex=1e9)
    assert not evaluate(ctx, [stock(avg=95.0), sold("call", 101.0, 1.00, 0.70)], chain()).closes
    assert not evaluate(ctx, [stock(avg=95.0), sold("call", 110.0, 1.00, 0.03, dte=1)], chain()).closes   # let it expire
    no_mark = sold("call", 110.0, 1.00, None)
    assert not evaluate(ctx, [stock(avg=95.0), no_mark], chain()).closes
