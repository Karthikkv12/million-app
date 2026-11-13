"""Full revaluation of options for Vol target: prices, LEAPS vega, sold options' gamma and theta, loss caps,
max loss, and the service switching method only when options are held."""
import math
import random

import numpy as np
import pytest

from optionflow.modules.risk import book
from optionflow.modules.risk import repricing as rp
from optionflow.modules.risk import voltarget as vt


def call(q, K, dte=365, iv=0.35, mark=None, delta=0.6):
    return {"kind": "option", "quantity": q, "otype": "call", "strike": K, "dte": dte, "iv": iv, "mark": mark, "delta": delta}


def put(q, K, dte=365, iv=0.35, mark=None, delta=-0.4):
    return {"kind": "option", "quantity": q, "otype": "put", "strike": K, "dte": dte, "iv": iv, "mark": mark, "delta": delta}


def shares(q):
    return {"kind": "stock", "quantity": q}


def test_black_scholes_textbook_value_and_put_call_parity():
    c = rp.bs_price(np.array([100.0]), 100, np.array([1.0]), np.array([0.2]), True, r=0.05)[0]
    p = rp.bs_price(np.array([100.0]), 100, np.array([1.0]), np.array([0.2]), False, r=0.05)[0]
    assert c == pytest.approx(10.4506, abs=1e-3)
    assert c - p == pytest.approx(100 - 100 * math.exp(-0.05), abs=1e-6)
    assert rp.bs_price(np.array([120.0]), 100, np.array([0.0]), np.array([0.2]), True)[0] == 20.0      # expired: intrinsic


def test_shares_are_linear_and_unchanged():
    r = [0.01, -0.02, 0.0]
    assert rp.leg_pnl(shares(100), 50.0, r, None) == pytest.approx([100 * 50 * (math.exp(x) - 1) for x in r])


def test_leaps_small_moves_match_delta_but_a_crash_is_capped():
    leg = call(1, 100, dte=365, iv=0.35)
    S = 100.0
    v0 = rp.bs_price(np.array([S]), 100, np.array([1.0]), np.array([0.35]), True)[0]
    small = rp.leg_pnl(leg, S, [0.01], None)[0]
    d = 0.5 * (1 + math.erf(((math.log(1) + (rp.R + 0.5 * 0.35 ** 2)) / 0.35) / math.sqrt(2)))
    assert small == pytest.approx(100 * d * S * (math.exp(0.01) - 1), rel=0.15)        # ≈ delta, minus a day of theta
    crash = rp.leg_pnl(leg, S, [math.log(0.2)], None)[0]                                 # stock −80% in a day
    assert -100 * v0 <= crash < -0.9 * 100 * v0                                           # loses nearly all, never more


def test_vega_moves_with_vix_long_gains_short_loses():
    flat = rp.leg_pnl(call(1, 100), 100.0, [0.0], [0.0])[0]
    fear = rp.leg_pnl(call(1, 100), 100.0, [0.0], [math.log(1.3)])[0]                  # VIX +30%, stock flat
    assert fear - flat > 100 * 0.35 * 0.3 * 0.3                                          # ≥ ~vega × ΔIV, a LEAPS has lots
    assert rp.leg_pnl(put(-1, 100), 100.0, [0.0], [math.log(1.3)])[0] < rp.leg_pnl(put(-1, 100), 100.0, [0.0], [0.0])[0]


def test_sold_options_earn_theta_and_lose_on_big_moves():
    straddle = [call(-1, 100, dte=30, iv=0.3), put(-1, 100, dte=30, iv=0.3)]
    quiet = rp.holding_pnl(straddle, 100.0, [0.0], None)[0]
    assert quiet > 0                                                                      # time decay pays the seller
    up, down = rp.holding_pnl(straddle, 100.0, [0.08, -0.08], None)
    assert up < 0 and down < 0                                                            # short gamma both ways
    longs = rp.holding_pnl([call(1, 100, dte=30, iv=0.3), put(1, 100, dte=30, iv=0.3)], 100.0, [0.0, 0.08], None)
    assert longs[0] == pytest.approx(-quiet) and longs[1] == pytest.approx(-up)


def test_no_iv_falls_back_to_delta():
    leg = call(2, 100, iv=None, delta=0.7)
    assert rp.leg_pnl(leg, 100.0, [0.01], None)[0] == pytest.approx(2 * 100 * 0.7 * 100 * (math.exp(0.01) - 1))


def test_max_loss():
    assert rp.max_loss([call(2, 100, mark=12.0)], 100.0) == pytest.approx(2400)           # long LEAPS: what you paid / it's worth
    assert rp.max_loss([call(-1, 110, mark=3.0)], 100.0) is None                           # naked call: unlimited
    covered = rp.max_loss([shares(100), call(-1, 110, mark=3.0)], 100.0)
    assert covered == pytest.approx(100 * 100 - 300)                                       # stock to 0, keep the call's value
    assert rp.max_loss([put(-1, 90, mark=2.0)], 100.0) == pytest.approx((90 - 2) * 100)   # assigned at 90, stock to 0
    spread = rp.max_loss([put(-1, 100, mark=5.0), put(1, 90, mark=2.0)], 100.0)
    assert spread == pytest.approx((10 - 3) * 100)                                         # width − credit
    assert rp.max_loss([call(-2, 110, mark=3.0), call(1, 120, mark=1.0), shares(100)], 100.0) is not None


def test_tail():
    p = list(np.linspace(-1000, 1000, 201))
    t = rp.tail(p)
    assert t["worst_day"] == 1000 and t["loss_99"] == pytest.approx(980)
    assert rp.tail([1, 2]) == {"worst_day": None, "loss_99": None}


# ── Service ───────────────────────────────────────────────────────────────────
DATES = [f"2024-{1 + i // 28:02d}-{1 + i % 28:02d}" for i in range(400)]


def series(seed, sd, start=100.0):
    rnd = random.Random(seed)
    px, out = start, {}
    for d in DATES:
        px *= math.exp(rnd.gauss(0, sd))
        out[d] = px
    return out


@pytest.fixture
def market(monkeypatch):
    closes = {"AAA": series(1, 0.02), "BBB": series(2, 0.015), "^VIX": series(3, 0.06, 18.0)}
    monkeypatch.setattr(book, "capital", lambda uid: 100_000.0)
    monkeypatch.setattr(book, "safe_closes", lambda s: (closes.get(s, {}), None))
    return closes


def holding(sym, spot, legs, delta_lots):
    return {"symbol": sym, "spot": spot, "net_delta": delta_lots, "exposure": delta_lots * 100 * spot,
            "shares": sum(l["quantity"] for l in legs if l["kind"] == "stock"),
            "has_options": any(l["kind"] == "option" for l in legs), "legs": legs, "atm_iv": 0.4}


def test_shares_only_book_keeps_the_delta_method(market, monkeypatch):
    c = market
    spot = c["AAA"][DATES[-1]]
    monkeypatch.setattr(book, "holdings", lambda uid: [holding("AAA", spot, [shares(300)], 3.0)])
    out = vt.vol_target(1, 0.15, 1.0)
    assert out["method"] == "delta" and out["vix_note"] is None
    dates, rets = vt.align({"AAA": c["AAA"]})
    want = vt.garch_forecast([3.0 * 100 * spot / 100_000 * r for r in rets["AAA"]])["forecast"]
    assert out["forecast"] == pytest.approx(want)
    h = out["holdings"][0]
    assert h["max_loss"] == pytest.approx(300 * spot) and h["own_exposure"] is not None and h["contracts_after"] is None


def test_options_book_is_repriced_with_tails_and_max_loss(market, monkeypatch):
    c = market
    a, b = c["AAA"][DATES[-1]], c["BBB"][DATES[-1]]
    rows = [holding("AAA", a, [call(5, round(a), dte=400, mark=a * 0.18)], 3.0),            # LEAPS
            holding("BBB", b, [shares(100), call(-1, round(b * 1.1), dte=20, mark=1.0)], 0.8)]  # covered call
    monkeypatch.setattr(book, "holdings", lambda uid: [dict(r) for r in rows])
    out = vt.vol_target(1, 0.15, 1.0)
    assert out["method"] == "repriced" and out["vix_note"] is None and out["sessions"] > 300
    assert out["worst_day"] > out["loss_99"] > 0 and out["unlimited"] == []
    by = {h["symbol"]: h for h in out["holdings"]}
    assert by["AAA"]["max_loss"] == pytest.approx(5 * 100 * a * 0.18)
    assert by["AAA"]["worst_day"] <= by["AAA"]["max_loss"]                                   # a long option can't lose more
    assert by["AAA"]["own_exposure"] is None and by["AAA"]["contracts_after"]["long"] == pytest.approx(5 * out["scale"])
    assert by["BBB"]["short_contracts"] == 1 and by["BBB"]["contracts_after"]["short"] == pytest.approx(out["scale"])
    assert sum(h["risk_share"] for h in out["holdings"]) == pytest.approx(1.0)
    assert "legs" not in by["AAA"]


def test_naked_call_is_flagged_and_missing_vix_is_said(market, monkeypatch):
    c = market
    a = c["AAA"][DATES[-1]]
    monkeypatch.setattr(book, "holdings", lambda uid: [holding("AAA", a, [call(-2, round(a * 1.05), dte=30, mark=2.0)], -1.0)])
    monkeypatch.setattr(book, "safe_closes", lambda s: ({} if s == "^VIX" else c.get(s, {}), "rate limited" if s == "^VIX" else None))
    out = vt.vol_target(1, 0.15, 1.0)
    assert out["method"] == "repriced" and out["unlimited"] == ["AAA"] and out["max_loss"] is None
    assert out["vix_note"].startswith("No VIX history (rate limited)") and out["forecast"] > 0
