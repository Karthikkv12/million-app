"""notify: level-shift alerts (LevelWatch, level_symbols, level_alerts, prefs) and the worker tick."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from optionflow.modules.notify import service


def _r(spot=600.0, cw=610.0, pw=590.0, king=600.0, flip=595.0, as_of="t1", sym="SPY", **kw):
    return SimpleNamespace(symbol=sym, spot=spot, max_call_wall=cw, max_put_wall=pw, max_gex_strike=king,
                           zero_gamma=flip, as_of=as_of, error=kw.get("error"), stale=kw.get("stale", False))


def _seq(w, *results, now=0.0):
    out = []
    for i, r in enumerate(results):
        out.append(w.check(r, now=now + i * 60))
    return out


def test_first_refresh_is_only_the_baseline():
    w = service.LevelWatch()
    assert w.check(_r()) == []


def test_wall_move_needs_two_refreshes_then_alerts_once():
    w = service.LevelWatch()
    a = _seq(w, _r(as_of="1"), _r(cw=615, as_of="2"), _r(cw=615, as_of="3"), _r(cw=615, as_of="4"))
    assert a[1] == [] and a[3] == []
    assert len(a[2]) == 1
    x = a[2][0]
    assert x["kind"] == "levels" and x["symbol"] == "SPY" and x["url"] == "/stocks/SPY"
    assert x["title"] == "SPY call wall moved up: 610 → 615"


def test_a_flicker_for_one_refresh_stays_quiet():
    w = service.LevelWatch()
    a = _seq(w, _r(as_of="1"), _r(pw=585, as_of="2"), _r(as_of="3"), _r(pw=585, as_of="4"), _r(as_of="5"))
    assert all(x == [] for x in a)


def test_same_as_of_is_not_counted_twice():
    w = service.LevelWatch()
    a = _seq(w, _r(as_of="1"), _r(king=605, as_of="2"), _r(king=605, as_of="2"))
    assert a == [[], [], []]


def test_stale_or_error_results_are_ignored():
    w = service.LevelWatch()
    w.check(_r(as_of="1"))
    assert w.check(_r(cw=700, as_of="2", stale=True)) == []
    assert w.check(_r(cw=700, as_of="3", error="boom")) == []
    assert w.check(_r(cw=700, as_of="4")) == []          # first real sighting of 700


def test_flip_move_counts_only_beyond_the_threshold():
    w = service.LevelWatch()
    small = _seq(w, _r(as_of="1"), _r(flip=596.0, as_of="2"), _r(flip=596.0, as_of="3"))   # < 0.5% of 600
    assert small == [[], [], []]
    big = _seq(w, _r(flip=590.0, as_of="4"), _r(flip=590.1, as_of="5"))
    assert big[0] == [] and len(big[1]) == 1
    assert big[1][0]["title"].startswith("SPY flip moved down: 595 → 590.1")
    assert "above it" in big[1][0]["body"]


def test_spot_crossing_the_flip_alerts_with_cooldown():
    w = service.LevelWatch()
    a = _seq(w, _r(spot=600, as_of="1"), _r(spot=594, as_of="2"), _r(spot=593.5, as_of="3"))
    assert a[1] == [] and len(a[2]) == 1
    assert a[2][0]["title"] == "SPY crossed below the flip (595)" and "short gamma" in a[2][0]["body"]
    # back above within 30 min: side tracked, no second push
    b = _seq(w, _r(spot=600, as_of="4"), _r(spot=600, as_of="5"), now=300)
    assert b == [[], []]
    # and below again after the cooldown
    c = _seq(w, _r(spot=590, as_of="6"), _r(spot=590, as_of="7"), now=4000)
    assert len(c[1]) == 1


def test_inside_the_band_is_neither_side():
    w = service.LevelWatch()
    a = _seq(w, _r(spot=600, as_of="1"), _r(spot=595.3, as_of="2"), _r(spot=595.3, as_of="3"))   # within 0.1%
    assert a == [[], [], []]


def test_level_symbols_holdings_plus_extras_only_when_on():
    books = {"books": [{"symbol": "NVDA"}, {"symbol": "BAD", "error": "x"}, {"symbol": "aapl"}]}
    on = service.clean_prefs({"level_symbols": ["spy", " qqq "]})
    assert on["levels"] is True and on["level_symbols"] == ["QQQ", "SPY"]
    assert service.level_symbols(books, [on]) == ["AAPL", "NVDA", "QQQ", "SPY"]
    off = service.clean_prefs({"levels": False, "level_symbols": ["SPY"]})
    assert service.level_symbols(books, [off]) == []


def test_level_symbols_capped():
    p = service.clean_prefs({"level_symbols": [f"S{i}" for i in range(50)]})
    assert len(p["level_symbols"]) == service.MAX_LEVEL_SYMBOLS


def test_allows_level_symbols_past_the_symbols_filter():
    p = service.clean_prefs({"symbols": ["NVDA"], "level_symbols": ["SPY"]})
    lv = lambda s: {"kind": "levels", "symbol": s}
    assert service.allows(p, lv("SPY")) and service.allows(p, lv("NVDA")) and not service.allows(p, lv("AAPL"))
    assert not service.allows(service.clean_prefs({"levels": False}), lv("NVDA"))


def test_level_alerts_checks_each_symbol_once_and_skips_failures():
    w = service.LevelWatch()
    calls = []

    def gex(sym):
        calls.append(sym)
        if sym == "BAD":
            raise RuntimeError("no data")
        return _r(sym=sym, as_of=str(len(calls)))

    assert service.level_alerts(["SPY", "BAD"], gex_fn=gex, watch=w) == {"SPY": []}
    assert calls == ["SPY", "BAD"]


def test_run_for_user_pushes_level_alerts_for_their_symbols(db_engine_and_session, monkeypatch):
    from optionflow.modules.auth import service as auth
    from optionflow.modules.notify import webpush
    priv, _ = webpush.generate_keys()
    monkeypatch.setenv("PUSH_VAPID_PRIVATE_KEY", priv)
    service.SENT.__init__()
    auth.create_user("lv_owner", "Str0ng!Passw0rd#2026")
    uid = int(auth.get_user_by_username("lv_owner").id)
    service.subscribe(uid, "https://push.example/1", "p", "a", "ua")
    service.set_prefs(uid, {"level_symbols": ["SPY"]})
    sent = []
    sender = lambda *a, **k: (sent.append(a[3]), webpush.SendResult(201, False))[1]   # noqa: E731
    lv = {"SPY": [{"key": "lv:SPY:x", "kind": "levels", "symbol": "SPY", "title": "SPY call wall moved up",
                   "body": "b", "url": "/stocks/SPY"}],
          "TSLA": [{"key": "lv:TSLA:x", "kind": "levels", "symbol": "TSLA", "title": "TSLA", "body": "b", "url": "/"}]}
    books = lambda _u: {"books": []}   # noqa: E731
    assert service.run_for_user(uid, books_fn=books, sender=sender, levels=lv) == 1
    assert [p["title"] for p in sent] == ["SPY call wall moved up"]
    assert service.run_for_user(uid, books_fn=books, sender=sender, levels=lv) == 0   # once a day


def test_worker_tick_checks_levels_once_for_all_users(db_engine_and_session, monkeypatch):
    from optionflow.modules.auth import service as auth
    from optionflow.modules.hedge import service as hedge
    from optionflow.modules.notify import webpush, worker
    priv, _ = webpush.generate_keys()
    monkeypatch.setenv("PUSH_VAPID_PRIVATE_KEY", priv)
    monkeypatch.setattr(service, "market_open", lambda: True)
    for name in ("u_a", "u_b"):
        auth.create_user(name, "Str0ng!Passw0rd#2026")
        uid = int(auth.get_user_by_username(name).id)
        service.subscribe(uid, f"https://push.example/{name}", "p", "a", "ua")
    monkeypatch.setattr(hedge, "books_for", lambda uid: {"books": [{"symbol": "NVDA"}]})
    checked = []
    monkeypatch.setattr(service, "level_alerts", lambda syms: checked.append(list(syms)) or {})
    monkeypatch.setattr(service, "run_for_user", lambda uid, books_fn=None, levels=None: 0)
    worker.tick()
    assert checked == [["NVDA"]]
