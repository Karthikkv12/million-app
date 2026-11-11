"""Held contracts beyond the board chain's 60-DTE window still get a live mark and IV (T-30)."""
from datetime import date, timedelta

import pandas as pd
import pytest

from optionflow.modules.hedge import service
from optionflow.modules.hedge.suggest import Leg
from optionflow.providers import market_data
from optionflow.providers.market_data import CONTRACT_COLUMNS, ContractChain

NEAR = (date.today() + timedelta(days=4)).isoformat()
FAR = (date.today() + timedelta(days=67)).isoformat()


class FakeMD:
    name = "fake"

    def __init__(self):
        self.contract_calls = []

    def option_contracts(self, symbol, expiries=None, max_dte=60, max_expiries=4):
        self.contract_calls.append((symbol, tuple(expiries or ())))
        return ContractChain(40.0, pd.DataFrame([
            {"strike": 35.0, "expiry": FAR, "otype": "put", "oi": 900, "volume": 12,
             "bid": 1.10, "ask": 1.30, "last": 1.25, "iv": 0.92},
        ], columns=CONTRACT_COLUMNS), "public")


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
        "rows": {(NEAR, 42.0, "call"): (0.8, 0.57, 4.0)}, "weekly": NEAR, "atm_iv": 0.8, "source": "public"})
    yield fake
    market_data.use_market_data(None)


def test_far_leg_gets_mark_and_iv_from_its_own_expiry(md):
    near = Leg("option", -1, 1.0, "call", 42.0, NEAR, 4, None)
    far = Leg("option", -1, 2.6, "put", 35.0, FAR, 67, None)
    service.build_book("BMNR", [near, far], 38.0, ["Trading"])
    assert near.mark == 0.57 and near.iv == 0.8                  # from the board chain, as before
    assert far.mark == pytest.approx(1.20) and far.iv == 0.92    # bid/ask mid from the far expiry
    assert md.contract_calls == [("BMNR", (FAR,))]               # only the missing expiry is fetched


def test_far_contracts_are_cached_with_the_chain(md):
    far = Leg("option", -1, 2.6, "put", 35.0, FAR, 67, None)
    service.build_book("BMNR", [far], None, [])
    service.build_book("BMNR", [far], None, [])
    assert len(md.contract_calls) == 1


def test_no_far_fetch_when_every_leg_is_in_the_chain(md):
    service.build_book("BMNR", [Leg("option", -1, 1.0, "call", 42.0, NEAR, 4, None)], None, [])
    assert md.contract_calls == []


def test_far_fetch_failure_leaves_leg_unmarked(md, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("both sources down")
    monkeypatch.setattr(md, "option_contracts", boom)
    far = Leg("option", -1, 2.6, "put", 35.0, FAR, 67, None)
    service.build_book("BMNR", [far], None, [])
    assert far.mark is None and far.iv == 0.8                    # falls back to ATM IV, like before
