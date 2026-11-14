"""notify: the Notification Center — every alert is stored once a day, listed newest first, marked read, cleared."""
import pytest

from optionflow.modules.notify import service, webpush
from tests.notify.test_notify import BOOKS, _login, _user, client, keys  # noqa: F401  (fixtures)


def _item(key, kind="buyback", title="t"):
    return {"key": key, "kind": kind, "symbol": "AAPL", "title": title, "body": "b", "url": "/stocks/AAPL"}


def test_record_is_once_per_key_per_day(db_engine_and_session):
    uid = _user()
    assert service.record(uid, [_item("a"), _item("b"), _item("a")], day="2026-11-14") == 2
    assert service.record(uid, [_item("a")], day="2026-11-14") == 0        # same day: already there
    assert service.record(uid, [_item("a")], day="2026-11-15") == 1        # next day: a new entry
    box = service.inbox(uid)
    assert box["unread"] == 3 and len(box["items"]) == 3 and all(not i["read"] for i in box["items"])


def test_mark_read_and_clear(db_engine_and_session):
    uid = _user()
    service.record(uid, [_item("a"), _item("b"), _item("c")])
    ids = [i["id"] for i in service.inbox(uid)["items"]]
    assert service.mark_read(uid, ids[:1]) == 2
    assert service.mark_read(uid) == 0
    assert all(i["read"] for i in service.inbox(uid)["items"])
    service.clear(uid)
    assert service.inbox(uid) == {"items": [], "unread": 0}


def test_users_see_only_their_own(db_engine_and_session):
    a, b = _user("owner"), _user("other")
    service.record(a, [_item("x")])
    assert service.inbox(b)["unread"] == 0 and service.mark_read(b) == 0 and service.inbox(a)["unread"] == 1


def test_hedge_alerts_land_in_the_center_even_when_pushes_are_summarised(db_engine_and_session, keys, monkeypatch):
    uid = _user()
    service.subscribe(uid, "https://push.example/1", "p", "a", "iPhone")
    monkeypatch.setattr(service, "MAX_PER_CYCLE", 1)                      # 3 alerts → 1 summary push
    sent = []
    sender = lambda *a, **k: (sent.append(a[3]), webpush.SendResult(201, False))[1]   # noqa: E731
    service.run_for_user(uid, books_fn=lambda _u: BOOKS, sender=sender)
    assert [p["tag"] for p in sent] == ["summary"]
    kinds = sorted(i["kind"] for i in service.inbox(uid)["items"])
    assert kinds == ["buy_stock", "buyback", "sell_call"]
    service.SENT.__init__()                                              # a restart: pushes may repeat, the center doesn't
    service.run_for_user(uid, books_fn=lambda _u: BOOKS, sender=sender)
    assert len(service.inbox(uid)["items"]) == 3


def test_pulse_events_are_recorded(db_engine_and_session):
    from optionflow.modules.pulse import service as pulse
    uid = _user()
    pulse._send([{"user_id": uid, "kind": "price_alert", "id": 7, "symbol": "NVDA", "title": "NVDA crossed 180",
                  "body": "now 180.20", "url": "/stocks/NVDA"}], push=lambda *_a: None)
    (i,) = service.inbox(uid)["items"]
    assert i["kind"] == "price_alert" and i["symbol"] == "NVDA" and i["url"] == "/stocks/NVDA"


def test_inbox_api(client):  # noqa: F811
    assert client.get("/api/v1/notify/inbox").status_code == 401
    h = _login(client)
    from optionflow.modules.auth import service as auth
    uid = int(auth.get_user_by_username("owner").id)
    service.record(uid, [_item("a", title="Buy back UPST"), _item("b", kind="levels", title="SPY flip moved")])
    r = client.get("/api/v1/notify/inbox", headers=h).json()
    assert r["unread"] == 2 and {i["kind"] for i in r["items"]} == {"buyback", "levels"}
    first = r["items"][0]["id"]
    assert client.post("/api/v1/notify/inbox/read", json={"ids": [first]}, headers=h).json() == {"unread": 1}
    assert client.post("/api/v1/notify/inbox/read", json={}, headers=h).json() == {"unread": 0}
    assert client.delete("/api/v1/notify/inbox", headers=h).json() == {"unread": 0}
    assert client.get("/api/v1/notify/inbox", headers=h).json() == {"items": [], "unread": 0}
