"""Cboe extended-hours list: parsing the reference file, caching, fallbacks."""
import pytest

from optionflow.modules.watchlists import cboe

HEAD = "Symbol,Company,DPM,Extended-Hours Eligible,Symbol Type,GTH Eligible,Curb Eligible\n"
CSV = HEAD + "\n".join([
    "AAPL,APPLE INC COM,Yes,Yes,Equity,Yes,Yes",
    "SPY,STATE STR SPDR S&P 500 ETF TR,Yes,Yes,ETF,Yes,No",
    "SPX,SPX,Yes,Yes,Index,Yes,No",                         # index: dropped
    "PTEST,Arca Tick Pilot Test Symbol Co,Yes,Yes,Equity,Yes,Yes",   # test symbol: dropped
    "KO,COCA COLA CO COM,Yes,Yes,Equity,No,No",             # not eligible
    "MSFT,MICROSOFT CORP COM,Yes,Yes,Equity,Yes,Yes",
    "NVDA,NVIDIA CORPORATION COM,Yes,Yes,Equity,Yes,Yes",
    "TSLA,TESLA INC COM,Yes,Yes,Equity,Yes,Yes",
    "QQQ,INVESCO QQQ TR UNIT SER 1,Yes,Yes,ETF,Yes,No",
]) + "\n"


@pytest.fixture(autouse=True)
def fresh():
    cboe._state.update(symbols=None, fetched_at=None, next_try=0.0)
    yield
    cboe._state.update(symbols=None, fetched_at=None, next_try=0.0)


def test_parse_keeps_eligible_stocks_and_etfs_only():
    assert cboe.parse(CSV) == ["AAPL", "MSFT", "NVDA", "QQQ", "SPY", "TSLA"]


def test_live_list_then_cached(monkeypatch):
    calls = []
    monkeypatch.setattr(cboe, "_fetch", lambda: calls.append(1) or cboe.parse(CSV))
    a = cboe.extended_hours(now=1000)
    assert a["live"] is True and a["symbols"] == ["AAPL", "MSFT", "NVDA", "QQQ", "SPY", "TSLA"]
    cboe.extended_hours(now=1000 + cboe.TTL - 1)
    assert len(calls) == 1                                  # served from cache inside 12 h
    cboe.extended_hours(now=1000 + cboe.TTL)
    assert len(calls) == 2                                  # refreshed after


def test_failure_serves_last_good_then_retries(monkeypatch):
    monkeypatch.setattr(cboe, "_fetch", lambda: cboe.parse(CSV))
    good = cboe.extended_hours(now=0)["symbols"]
    def boom():
        raise RuntimeError("down")
    monkeypatch.setattr(cboe, "_fetch", boom)
    out = cboe.extended_hours(now=cboe.TTL)
    assert out["symbols"] == good and out["live"] is True
    assert cboe._state["next_try"] == cboe.TTL + cboe.RETRY


def test_never_fetched_falls_back_to_launch_list(monkeypatch):
    def boom():
        raise RuntimeError("down")
    monkeypatch.setattr(cboe, "_fetch", boom)
    out = cboe.extended_hours(now=0)
    assert out["live"] is False and len(out["symbols"]) == 29 and "HOOD" in out["symbols"]


def test_layout_change_is_rejected(monkeypatch):
    class R:
        text = "Symbol,Company\nAAPL,APPLE\n"
        def raise_for_status(self):
            pass
    monkeypatch.setattr(cboe.httpx, "get", lambda *a, **k: R())
    with pytest.raises(ValueError):
        cboe._fetch()
