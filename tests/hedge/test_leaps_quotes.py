"""LEAPS / diagonal strategies: the desk fetches far expiries (beyond the board chain's 60 days) for them only."""
from datetime import date, timedelta

import pandas as pd
import pytest

from optionflow.modules.hedge import service
from optionflow.modules.hedge.suggest import Leg
from optionflow.modules.strategy.catalog import rules_for
from optionflow.providers import market_data
from optionflow.providers.market_data import CONTRACT_COLUMNS, ContractChain


def exp(d):
    return (date.today() + timedelta(days=d)).isoformat()


NEAR, MID, FAR, TOO_FAR = exp(30), exp(120), exp(430), exp(1500)


class FakeMD:
    name = "fake"

    def __init__(self):
        self.calls = []

    def option_expiries(self, symbol):
        return [NEAR, MID, FAR, TOO_FAR]

    def option_contracts(self, symbol, expiries=None, max_dte=60, max_expiries=4):
        self.calls.append(tuple(expiries or ()))
        rows = [{"strike": k, "expiry": e, "otype": "call", "oi": 10, "volume": 1,
                 "bid": b, "ask": a, "last": None, "iv": iv}
                for e in expiries or [] for k, b, a, iv in ((30.0, 13.8, 14.2, 0.55), (35.0, 10.4, 10.8, 0.52),
                                                            (45.0, 5.0, 5.4, 0.50), (20.0, None, None, None))]
        return ContractChain(40.0, pd.DataFrame(rows, columns=CONTRACT_COLUMNS), "public")


@pytest.fixture
def md(monkeypatch):
    fake = FakeMD()
    market_data.use_market_data(fake)
    monkeypatch.setattr(service, "CACHE", service._Cache())
    monkeypatch.setattr(service, "_spot", lambda s: 40.0)
    monkeypatch.setattr(service, "_prev_close", lambda s: 39.0)
    monkeypatch.setattr(service, "_hv", lambda s: {"hv10": None, "hv20": 0.6, "hv60": None})
    monkeypatch.setattr(service, "_gex", lambda s: {})
    monkeypatch.setattr(service, "_beta", lambda s: 1.5)
    monkeypatch.setattr(service, "_chain", lambda s: {
        "rows": {(NEAR, 44.0, "call"): (0.5, 0.95, 30.0)}, "weekly": NEAR, "atm_iv": 0.5, "source": "public"})
    yield fake
    market_data.use_market_data(None)


def test_leaps_strategy_buys_from_the_far_expiry_in_its_window(md):
    b = service.build_book("XYZ", [Leg("stock", 100, 38.0)], 38.0, ["Trading"], rules_for("leaps"))
    s = b["suggestion"]
    assert md.calls == [(FAR,)]                               # only the expiry inside 270–730 days; unquoted rows dropped
    assert s["action"] == "BUY_CALL" and s["expiry"] == FAR and s["strike"] in (30.0, 35.0)
    assert 0.70 <= s["option_delta"] <= 0.85 and s["credit"] < 0
    service.build_book("XYZ", [Leg("stock", 100, 38.0)], 38.0, ["Trading"], rules_for("leaps"))
    assert len(md.calls) == 1                                 # cached


def test_other_strategies_never_fetch_far_expiries(md):
    service.build_book("XYZ", [Leg("stock", 100, 38.0)], 38.0, [], rules_for("covered_call"))
    service.build_book("XYZ", [Leg("stock", 100, 38.0)], 38.0, [], None)
    assert md.calls == []


def test_leaps_waits_when_the_far_fetch_fails(md, monkeypatch):
    monkeypatch.setattr(md, "option_expiries", lambda s: (_ for _ in ()).throw(RuntimeError("down")))
    b = service.build_book("XYZ", [Leg("stock", 100, 38.0)], 38.0, [], rules_for("leaps"))
    assert b["suggestion"]["action"] == "WAIT" and b["error"] is None
