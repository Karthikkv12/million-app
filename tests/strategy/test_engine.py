"""Strategy catalog + engine: contract picks for each strategy, rule cleaning, and the desk wiring (pure)."""
from datetime import date

import pytest

from optionflow.modules.hedge.suggest import Context, Leg, evaluate
from optionflow.modules.strategy import catalog, engine
from optionflow.modules.strategy.catalog import rules_for

from .helpers import chain, expiry


def ctx(spot=100.0, avg=95.0, red=False):
    return Context("XYZ", spot, avg, day_change=-0.01 if red else 0.005, day_high=spot * (1.02 if red else 1.001))


def decide(rules, legs, c=None, red=False, avg=95.0):
    shares = sum(l.quantity for l in legs if l.kind == "stock")
    return engine.decide(ctx(avg=avg, red=red), legs, c or chain(), shares / 100, shares, int(shares // 100), [], rules)


def test_catalog_lists_five_strategies_with_steps():
    keys = [s["key"] for s in catalog.describe()]
    assert keys == ["spike_wheel", "wheel", "covered_call", "cash_secured_put", "put_credit_spread"]
    assert all(len(s["steps"]) == 4 for s in catalog.describe())
    assert catalog.get("nope").key == "spike_wheel"


def test_overrides_are_bounded_typed_and_ordered():
    o = catalog.clean_overrides({"delta_min": 0.5, "delta_max": 0.2, "dte_min": 7.6, "min_yield": 99,
                                 "require_pullback": "yes", "bogus": 1, "key": "x"})
    assert o == {"delta_min": 0.2, "delta_max": 0.5, "dte_min": 8, "min_yield": 2.0}
    r = rules_for("wheel", {"delta_min": 0.5})              # above the default max: swapped
    assert (r.delta_min, r.delta_max) == (0.35, 0.5)


def test_covered_call_sells_otm_call_above_average_for_every_free_lot():
    s = decide(rules_for("covered_call"), [Leg("stock", 300, 95.0)])
    assert s.action == "SELL_CALL" and s.contracts == 3 and s.strike > 100
    assert 0.20 <= -s.option_delta <= 0.35 and s.yield_ann >= 0.12
    assert 21 <= (date.fromisoformat(s.expiry) - date.today()).days <= 45


def test_covered_call_never_below_average_and_holds_when_covered():
    s = decide(rules_for("covered_call"), [Leg("stock", 100, 140.0)], avg=140.0)
    assert s.action == "WAIT" and "average" in " ".join(s.reasons)
    short = Leg("option", -1, 2.0, "call", 110.0, expiry(30), 30.25, 0.4)
    assert decide(rules_for("covered_call"), [Leg("stock", 100, 95.0), short]).action == "HOLD"


def test_cash_secured_put_waits_for_pullback_then_sells_one_put():
    rules = rules_for("cash_secured_put")
    assert decide(rules, [Leg("stock", 100, 95.0)]).action == "WAIT"
    s = decide(rules, [Leg("stock", 100, 95.0)], red=True)
    assert s.action == "SELL_PUT" and s.contracts == 1 and s.strike < 100 and s.collateral == s.strike * 100


def test_min_yield_blocks_thin_premium():
    s = decide(rules_for("cash_secured_put", {"min_yield": 1.5}), [Leg("stock", 100, 95.0)], red=True)
    assert s.action == "WAIT" and "too little" in s.headline


def test_wheel_puts_without_shares_calls_with_them():
    w = rules_for("wheel")
    assert decide(w, [Leg("stock", 50, 95.0)]).action == "SELL_PUT"
    assert decide(w, [Leg("stock", 200, 95.0)]).action == "SELL_CALL"


def test_put_credit_spread_has_a_long_leg_about_five_percent_lower():
    s = decide(rules_for("put_credit_spread", {"min_yield": 0.05}), [Leg("stock", 100, 95.0)], red=True)
    assert s.action == "SELL_PUT" and s.long_strike is not None
    assert s.strike - s.long_strike >= 5 and s.max_loss == pytest.approx((s.strike - s.long_strike - s.premium) * 100, abs=0.02)
    assert s.premium >= 0.20 * (s.strike - s.long_strike)


def test_spread_credit_floor():
    sp, why = engine.build_spread(chain(), 100.0, rules_for("put_credit_spread", {"min_credit_ratio": 0.6}))
    assert sp is None and "width" in why


def test_evaluate_without_strategy_is_the_spike_wheel():
    legs = lambda: [Leg("stock", 100, 95.0)]                            # noqa: E731
    weekly = [q for q in chain() if q.dte == 5]
    a = evaluate(Context("XYZ", 100.0, 95.0, 0.03, 100.0), legs(), weekly)
    b = evaluate(Context("XYZ", 100.0, 95.0, 0.03, 100.0), legs(), weekly, None, chain())
    assert a.strategy == b.strategy == "spike_wheel" and a.suggestion == b.suggestion and a.suggestion.action == "SELL_CALL"
    assert a.suggestion.strike <= 100                                    # in the money near the average


def test_evaluate_with_a_strategy_uses_the_whole_chain_and_its_take_profit():
    sold = Leg("option", -1, 2.00, "put", 90.0, expiry(30), 30.25, 0.4, mark=0.90)   # 55% captured
    b = evaluate(Context("XYZ", 100.0, 95.0, -0.01, 102.0), [Leg("stock", 100, 95.0), sold],
                 [q for q in chain() if q.dte == 5], rules_for("covered_call"), chain())
    assert b.strategy == "covered_call" and b.suggestion.action == "SELL_CALL" and b.suggestion.expiry == expiry(30)
    assert [c.strike for c in b.closes] == [90.0]                         # 50% take-profit (the wheel's 80% wouldn't)
