"""flow.chain_stats: max pain, open interest by strike, ATM IV; and how they reach the GEX payload, the snapshots and
/flow/{symbol}/open-interest."""
from __future__ import annotations

import math

import pandas as pd
import pytest

from optionflow.modules.flow import chain_stats as cs
from optionflow.modules.flow import gamma, service
from optionflow.providers.market_data import CHAIN_COLUMNS, OptionChain


def _row(k, e, o, oi, iv=0.3, T=7 / 365):
    return {"strike": float(k), "expiry": e, "otype": o, "oi": oi, "volume": 0, "iv": iv, "mid": 1.0,
            "gamma": float("nan"), "T": T, "bid": 0.9, "ask": 1.1, "last": 1.0}


def test_max_pain_is_the_cheapest_settlement_for_holders():
    # calls pile up at 110, puts at 90: holders lose most at 100
    rows = [_row(k, "2026-11-20", o, oi) for k, o, oi in
            [(90, "put", 1000), (95, "put", 200), (100, "call", 50), (100, "put", 50), (105, "call", 200), (110, "call", 1000)]]
    df = pd.DataFrame(rows, columns=CHAIN_COLUMNS)
    assert cs.max_pain(df, "2026-11-20") == 100.0

    def pain(p):
        return sum(r["oi"] * max(0, p - r["strike"]) if r["otype"] == "call" else r["oi"] * max(0, r["strike"] - p)
                   for r in rows)
    assert pain(100) == min(pain(k) for k in (90, 95, 100, 105, 110))


def test_max_pain_none_without_open_interest():
    df = pd.DataFrame([_row(100, "2026-11-20", "call", 0)], columns=CHAIN_COLUMNS)
    assert cs.max_pain(df, "2026-11-20") is None
    assert cs.max_pain(df, "2027-01-15") is None


def test_open_interest_by_strike_per_expiry():
    df = pd.DataFrame([_row(100, "A", "call", 10), _row(100, "A", "put", 4), _row(105, "A", "call", 7),
                       _row(100, "B", "call", 99), _row(95, "A", "put", 0)], columns=CHAIN_COLUMNS)
    assert cs.open_interest(df, "A") == [{"strike": 100.0, "call_oi": 10, "put_oi": 4},
                                         {"strike": 105.0, "call_oi": 7, "put_oi": 0}]
    assert cs.open_interest(df)[0] == {"strike": 100.0, "call_oi": 109, "put_oi": 4}


def test_atm_iv_interpolates_in_strike_and_averages_sides():
    df = pd.DataFrame([_row(95, "A", "call", 1, iv=0.40), _row(105, "A", "call", 1, iv=0.20),
                       _row(95, "A", "put", 1, iv=0.50), _row(105, "A", "put", 1, iv=0.30)], columns=CHAIN_COLUMNS)
    # spot 100: calls 0.30, puts 0.40 → 0.35
    assert cs.atm_iv_at(df, 100.0, "A") == pytest.approx(0.35)
    # a placeholder IV (< 0.5%) is ignored
    df2 = pd.concat([df, pd.DataFrame([_row(100, "A", "call", 1, iv=0.00001)], columns=CHAIN_COLUMNS)])
    assert cs.atm_iv_at(df2, 100.0, "A") == pytest.approx(0.35)


def test_atm_iv_near_skips_0dte_and_30d_interpolates_variance():
    rows = []
    for e, T, iv in (("0dte", 0.2 / 365, 0.90), ("w1", 7 / 365, 0.30), ("m1", 21 / 365, 0.25), ("m2", 49 / 365, 0.35)):
        for o in ("call", "put"):
            rows += [_row(95, e, o, 1, iv=iv, T=T), _row(105, e, o, 1, iv=iv, T=T)]
    out = cs.atm_iv(pd.DataFrame(rows, columns=CHAIN_COLUMNS), 100.0)
    assert out["near"] == pytest.approx(0.30) and out["near_expiry"] == "w1"
    var = 0.25 ** 2 * 21 + (0.35 ** 2 * 49 - 0.25 ** 2 * 21) * (30 - 21) / (49 - 21)
    assert out["d30"] == pytest.approx(math.sqrt(var / 30), abs=1e-4)


def test_atm_iv_drops_todays_expiry_even_with_floored_T():
    # providers floor T for 0DTE at about 1/365, i.e. "1 day": the calendar date has to rule it out (T-88)
    import datetime as dt
    rows = []
    for e, T, iv in (("2026-11-13", 1 / 365, 3.89), ("2026-11-20", 7 / 365, 0.60), ("2026-12-18", 35 / 365, 0.55)):
        for o in ("call", "put"):
            rows += [_row(95, e, o, 1, iv=iv, T=T), _row(105, e, o, 1, iv=iv, T=T)]
    out = cs.atm_iv(pd.DataFrame(rows, columns=CHAIN_COLUMNS), 100.0, today=dt.date(2026, 11, 13))
    assert out["near_expiry"] == "2026-11-20" and out["near"] == pytest.approx(0.60)
    assert 0.55 <= out["d30"] <= 0.60                       # the 389% 0DTE point is not in the 30-day blend either
    late = cs.atm_iv(pd.DataFrame(rows, columns=CHAIN_COLUMNS), 100.0, today=dt.date(2026, 11, 12))
    assert late["near_expiry"] == "2026-11-13"              # a day earlier it is a 1-DTE expiry, kept


def test_atm_iv_empty_chain():
    assert cs.atm_iv(pd.DataFrame(columns=CHAIN_COLUMNS), 100.0) == {"near": None, "near_expiry": None, "d30": None}


# ── through the GEX result, snapshots and the API ─────────────────────────────
def _chain():
    rows = []
    for e, T in (("2026-11-20", 7 / 365), ("2026-12-18", 35 / 365)):
        for k in range(80, 121, 5):
            rows.append(_row(k, e, "call", 100 + 50 * max(0, k - 100), iv=0.3, T=T))
            rows.append(_row(k, e, "put", 100 + 50 * max(0, 100 - k), iv=0.34, T=T))
    return pd.DataFrame(rows, columns=CHAIN_COLUMNS)


class _Provider:
    name = "public"

    def option_chain(self, sym):
        return OptionChain(100.0, _chain(), "public")


@pytest.fixture
def provider(monkeypatch):
    import datetime as dt
    service.clear_cache()
    real = cs.atm_iv
    monkeypatch.setattr(cs, "atm_iv", lambda df, spot, today=None: real(df, spot, today or dt.date(2026, 11, 13)))
    monkeypatch.setattr(gamma, "get_market_data", lambda: _Provider())
    yield
    service.clear_cache()


def test_gex_payload_carries_max_pain_and_atm_iv(provider):
    r = service.compute_and_cache("TEST")
    p = service.gex_payload(r)
    assert p["max_pain"] == 100.0 and p["max_pain_expiry"] == "2026-11-20"
    assert p["atm_iv_near"] == pytest.approx(0.32) and p["atm_iv_near_expiry"] == "2026-11-20"
    assert p["atm_iv_30d"] == pytest.approx(0.32)
    # a respot keeps them
    again = gamma.respot_gex("TEST", 101.0)
    assert again.max_pain == 100.0 and again.atm_iv_near is not None


def test_snapshot_stores_atm_iv_and_history_returns_it(db_engine_and_session, provider):
    service.refresh_gex("TEST")
    pts = service.net_flow_history("TEST", days=1)
    assert pts and pts[-1]["atm_iv_near"] == pytest.approx(0.32) and pts[-1]["atm_iv_30d"] == pytest.approx(0.32)
    b = service.net_flow_history("TEST", days=1, bucket_minutes=5)
    assert b[-1]["atm_iv_near"] == pytest.approx(0.32)


def test_open_interest_service(db_engine_and_session, provider):
    out = service.open_interest("test")
    assert out["symbol"] == "TEST" and out["expiry"] == "2026-11-20" and out["max_pain"] == 100.0
    assert out["expiries"] == ["2026-11-20", "2026-12-18"]
    assert {r["strike"] for r in out["rows"]} == {float(k) for k in range(80, 121, 5)}
    assert out["call_oi"] == out["put_oi"] and out["put_call_ratio"] == 1.0
    assert [m["expiry"] for m in out["max_pain_by_expiry"]] == out["expiries"]
    later = service.open_interest("TEST", "2026-12-18")
    assert later["expiry"] == "2026-12-18"
    assert service.open_interest("TEST", "2030-01-01")["expiry"] == "2026-11-20"   # unknown → nearest
