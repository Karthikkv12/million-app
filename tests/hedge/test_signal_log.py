"""hedge.signal_log: the live track record of scanner buys, and its outcomes from daily bars."""
from datetime import datetime

import pytest

from optionflow.modules.hedge import scan as sc
from optionflow.modules.hedge import scan_live as sl
from optionflow.modules.hedge import signal_log as lg
from optionflow.modules.notify.service import ET


def _bars(closes, start="2026-01-01"):
    from datetime import date, timedelta
    d0 = date.fromisoformat(start)
    return [{"date": (d0 + timedelta(days=i)).isoformat(), "open": c, "high": c, "low": c, "close": c, "volume": 1}
            for i, c in enumerate(closes)]


def test_outcome_enters_at_next_open_and_exits_by_the_rules():
    closes = [100.0] * 20 + [90.0] + [91.0, 92.0, 101.0] + [101.0] * 70        # signal on bar 20 (90)
    b = _bars(closes)
    o = lg.outcome(b, b[20]["date"], "SWING")
    assert o["entry"] == 91.0 and o["entry_day"] == b[21]["date"]
    assert o["r5"] == pytest.approx(101 / 91 - 1 - lg.COST)
    assert o["swing_days"] == 3 and o["swing_ret"] == pytest.approx(101 / 91 - 1 - lg.COST)   # first close > 10-day avg
    assert lg.outcome(b, b[-1]["date"], "BUY") == {"entry": None}                            # enters tomorrow
    fresh = lg.outcome(b[:23], b[20]["date"], "BUY")
    assert fresh["r5"] is None and fresh["r60"] is None


def test_log_and_report(db_engine_and_session, monkeypatch):
    rows = [{"symbol": "XYZ", "price": 90.0, "verdict": "ADD", "swing": "BUY", "swing_strong": True, "fear_score": 0.4, "ret5": -0.08},
            {"symbol": "ABC", "price": 50.0, "verdict": "HOLD", "swing": "WAIT"}]
    from datetime import date
    day = date.today().isoformat()
    assert lg.log(rows, "close", day) == 2                  # XYZ: BUY + SWING_STRONG; ABC nothing
    assert lg.log(rows, "close", day) == 0                  # once per day
    assert lg.log(rows, "intraday", day) == 2
    rep = lg.report(days=30, bars_fn=lambda s: [])
    assert {(e["kind"], e["trigger"]) for e in rep["entries"]} == {("BUY", "close"), ("SWING_STRONG", "close"),
                                                                   ("BUY", "intraday"), ("SWING_STRONG", "intraday")}
    assert rep["summary"]["SWING_STRONG"]["signals"] == 1 and rep["summary"]["SWING_STRONG"]["closed"] == 0


def test_log_close_once_after_the_close(monkeypatch):
    import time
    got = []
    monkeypatch.setattr(lg, "log", lambda rows, trig, day, universe="popular": got.append((trig, day, universe)) or 1)
    monkeypatch.setitem(sc._states, "popular", dict(sc._blank(), rows=[{"symbol": "XYZ"}]))
    sl._closed.clear()
    at = datetime(2026, 11, 16, 15, 59, 59, tzinfo=ET).timestamp()
    monkeypatch.setitem(sl._live, "popular", {"tick_at": at, "ticks": 1})
    monkeypatch.setitem(sl._live, "sp500", {})
    assert sl.log_close(datetime(2026, 11, 16, 15, 59, tzinfo=ET)) == 0          # still open
    assert sl.log_close(datetime(2026, 11, 16, 16, 1, tzinfo=ET)) == 1
    assert sl.log_close(datetime(2026, 11, 16, 16, 20, tzinfo=ET)) == 0          # once a day
    assert got == [("close", "2026-11-16", "popular")]
    assert sl.log_close(datetime(2026, 11, 17, 16, 1, tzinfo=ET)) == 0           # not re-priced that day
    _ = time
