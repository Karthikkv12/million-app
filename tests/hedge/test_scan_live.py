"""hedge.scan_live: the Signal scanner re-priced every second, Buy alerts after CONFIRM straight ticks, once a day."""
from datetime import date, datetime

from optionflow.modules.hedge import scan as sc
from optionflow.modules.hedge import scan_live as sl
from optionflow.modules.hedge import service
from optionflow.modules.notify.service import ET
from tests.hedge.test_signal import ramp, vix


def _bars(px, start=0):
    return [{"date": f"2025-{1 + (i + start) // 28:02d}-{1 + (i + start) % 28:02d}", "open": c, "high": c * 1.01,
             "low": c * 0.99, "close": c, "volume": 1e6} for i, c in enumerate(px)]


def test_patch_sets_or_appends_todays_bar():
    b = _bars([10.0, 11.0])
    p = sl.patch(b, 12.5, b[-1]["date"])
    assert len(p) == 2 and p[-1]["close"] == 12.5 and p[-1]["high"] == 12.5 and b[-1]["close"] == 11.0
    q = sl.patch(b, 9.0, "2026-11-16")
    assert len(q) == 3 and q[-1] == {"date": "2026-11-16", "open": 9.0, "high": 9.0, "low": 9.0, "close": 9.0, "volume": None}


def test_market_hours():
    assert sl.market_open(datetime(2026, 11, 16, 9, 30, tzinfo=ET))
    assert not sl.market_open(datetime(2026, 11, 16, 9, 29, tzinfo=ET))
    assert not sl.market_open(datetime(2026, 11, 16, 16, 0, tzinfo=ET))
    assert not sl.market_open(datetime(2026, 11, 14, 12, 0, tzinfo=ET))     # Saturday


def test_live_tick_reprices_rows_and_alerts_after_confirm(monkeypatch):
    px = ramp(100, 0.2, 260)
    bars = _bars(px)
    monkeypatch.setattr(sc, "_bars", lambda s: bars)
    monkeypatch.setattr(service, "_daily_bars", lambda s: [{"date": b["date"], "close": c} for b, c in zip(bars, vix(15.0, n=260))])
    monkeypatch.setattr(service, "_session_frac", lambda: (date(2026, 11, 16), 0.5))
    monkeypatch.setitem(sc._states, "popular", dict(sc._blank(), rows=[{"symbol": "XYZ", "fear_score": 0.0, "rsi": 60.0,
                                                                       "vs_50d": 0.0, "swing": "WAIT"}]))
    sl._streak.clear()
    calm = lambda syms: {"XYZ": {"price": px[-1]}}
    assert sl.tick("popular", ["XYZ"], quotes_fn=calm) == []
    assert sc._states["popular"]["rows"][0]["swing"] == "WAIT"
    drop = lambda syms: {"XYZ": {"price": px[-5] * 0.92}}                    # −8% vs 5 sessions ago, live
    got = [sl.tick("popular", ["XYZ"], quotes_fn=drop) for _ in range(sl.CONFIRM + 2)]
    assert [len(g) for g in got] == [0] * (sl.CONFIRM - 1) + [1, 0, 0]      # alerts once, on the CONFIRM-th tick
    a = got[sl.CONFIRM - 1][0]
    assert a["key"] == "scan:XYZ:SWING_STRONG" and a["kind"] == "scanner" and "next open" in a["body"]
    row = sc._states["popular"]["rows"][0]
    assert row["swing"] == "BUY" and row["swing_strong"] and row["price"] == round(px[-5] * 0.92, 2)
    sl.tick("popular", ["XYZ"], quotes_fn=calm)                              # back above: the streak resets
    assert not any(k.startswith("popular|XYZ") for k in sl._streak)


def test_deliver_records_for_users_with_the_pref_on(monkeypatch):
    from optionflow.modules.notify import service as ns
    got = {}
    monkeypatch.setattr(ns, "get_prefs", lambda uid: dict(ns.DEFAULT_PREFS, scanner=uid != 2))
    monkeypatch.setattr(ns, "record", lambda uid, items: got.setdefault(uid, items) and len(items))
    monkeypatch.setattr(ns, "subscriptions", lambda uid=None: [])
    a = {"key": "scan:XYZ:BUY", "kind": "scanner", "symbol": "XYZ", "title": "t", "body": "b", "url": "/stocks/XYZ"}
    assert sl.deliver([a], users_fn=lambda: [1, 2]) == 0
    assert list(got) == [1]
    assert ns.allows(dict(ns.DEFAULT_PREFS, symbols=["AAPL"]), a)             # not limited to holdings
    assert not ns.allows(dict(ns.DEFAULT_PREFS, scanner=False), a)


def test_scan_reports_live_status(monkeypatch):
    monkeypatch.setattr(sl, "market_open", lambda now=None: True)
    import time
    sl._live["popular"] = {"tick_at": time.time(), "ticks": 1, "priced": 100}
    s = sl.status("popular")
    assert s["live"] and s["tick_seconds"] == 1.0 and s["tick_at"].endswith("Z")
    sl._live["popular"]["tick_at"] = time.time() - 60
    assert not sl.status("popular")["live"]
