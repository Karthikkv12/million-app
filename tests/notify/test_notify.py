"""notify: Web Push crypto (RFC 8291 / 8292), alert rules, de-duplication, the /notify API."""
import base64
import json

import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from fastapi.testclient import TestClient

from optionflow.core.settings import Settings
from optionflow.main import create_app
from optionflow.modules.notify import service, webpush

PASSWORD = "Str0ng!Passw0rd#2026"


# ── crypto ────────────────────────────────────────────────────────────────────
def test_rfc8291_appendix_a_vector():
    as_priv = webpush.private_key_from_b64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw")
    ua_pub = webpush.unb64u("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4")
    out = webpush.encrypt(b"When I grow up, I want to be a watermelon", ua_pub, webpush.unb64u("BTBZMqHH6r4Tts7J_aSIgg"),
                          as_private=as_priv, salt=webpush.unb64u("DGv6ra1nlYgDCS1FRnbzlw"))
    assert webpush.b64u(out) == (
        "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_y"
        "l95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN")


def test_encrypt_round_trips_with_random_keys():
    ua = ec.generate_private_key(ec.SECP256R1())
    auth = b"0123456789abcdef"
    body = webpush.encrypt(b'{"title":"hi"}', webpush._public_bytes(ua.public_key()), auth)
    assert webpush.decrypt(body, ua, auth) == b'{"title":"hi"}'


def test_vapid_header_is_a_valid_es256_jwt():
    priv_b64, pub_b64 = webpush.generate_keys()
    priv = webpush.private_key_from_b64(priv_b64)
    h = webpush.vapid_header("https://web.push.apple.com/abc/def", priv, "mailto:x@y.z")
    assert h.startswith("vapid t=") and h.endswith(f", k={pub_b64}")
    token = h[len("vapid t="):h.index(",")]
    head, claims, sig = token.split(".")
    c = json.loads(base64.urlsafe_b64decode(claims + "=="))
    assert c["aud"] == "https://web.push.apple.com" and c["sub"] == "mailto:x@y.z"
    raw = webpush.unb64u(sig)
    der = encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big"))
    priv.public_key().verify(der, f"{head}.{claims}".encode(), ec.ECDSA(hashes.SHA256()))   # raises if bad


# ── alert rules ───────────────────────────────────────────────────────────────
BOOKS = {"books": [
    {"symbol": "UPST", "closes": [{"otype": "call", "strike": 22.5, "expiry": "2026-11-13", "contracts": 1, "dte": 4,
                                   "sold_at": 0.6, "mark": 0.09, "profit_pct": 0.85, "cost": 9, "kept": 51,
                                   "headline": "", "reasons": []}],
     "suggestion": {"action": "WAIT", "headline": "wait"}},
    {"symbol": "MP", "closes": [], "suggestion": {"action": "SELL_CALL", "strike": 33.5, "expiry": "2026-11-13", "contracts": 1,
                                                  "credit": 360, "reasons": ["Stock is +6.6% over your average."]}},
    {"symbol": "AAPL", "closes": [], "suggestion": {"action": "BUY_STOCK", "shares": 40, "headline": "Buy 40 shares"}},
    {"symbol": "BAD", "error": "no price"},
]}


def test_alerts_cover_buybacks_and_trades():
    a = service.alerts_for(BOOKS)
    assert [x["key"] for x in a] == ["bb:UPST:22.5C:2026-11-13", "sg:MP:SELL_CALL:33.5C:2026-11-13", "sg:AAPL:BUY_STOCK:40"]
    assert [x["kind"] for x in a] == ["buyback", "sell_call", "buy_stock"]
    assert a[0]["title"] == "Buy back UPST 22.5C 11-13" and "85%" in a[0]["body"] and "$51" in a[0]["body"]


@pytest.fixture
def keys(monkeypatch):
    priv, pub = webpush.generate_keys()
    monkeypatch.setenv("PUSH_VAPID_PRIVATE_KEY", priv)
    monkeypatch.setenv("PUSH_CONTACT", "mailto:owner@example.com")
    service.SENT.__init__()
    return pub


def _user(name="owner") -> int:
    from optionflow.modules.auth import service as auth
    auth.create_user(name, PASSWORD)
    return int(auth.get_user_by_username(name).id)


def test_each_alert_is_pushed_once_per_day(db_engine_and_session, keys):
    uid = _user()
    service.subscribe(uid, "https://push.example/1", "p", "a", "iPhone")
    sent = []
    sender = lambda *a, **k: (sent.append(a[3]), webpush.SendResult(201, False))[1]   # noqa: E731
    assert service.run_for_user(uid, books_fn=lambda _u: BOOKS, sender=sender) == 3
    assert service.run_for_user(uid, books_fn=lambda _u: BOOKS, sender=sender) == 0   # nothing new
    assert {p["tag"] for p in sent} == {"bb:UPST:22.5C:2026-11-13", "sg:MP:SELL_CALL:33.5C:2026-11-13", "sg:AAPL:BUY_STOCK:40"}


def test_dead_subscription_is_removed(db_engine_and_session, keys):
    uid = _user()
    service.subscribe(uid, "https://push.example/dead", "p", "a", None)
    r = service.push_user(uid, {"title": "x"}, sender=lambda *a, **k: webpush.SendResult(410, True))
    assert r == {"sent": 0, "failed": 0, "removed": 1} and not service.subscriptions(uid)


def test_no_keys_means_no_push(db_engine_and_session, monkeypatch):
    monkeypatch.delenv("PUSH_VAPID_PRIVATE_KEY", raising=False)
    uid = _user()
    service.subscribe(uid, "https://push.example/1", "p", "a", None)
    assert service.push_user(uid, {"title": "x"}, sender=lambda *a, **k: pytest.fail("should not send")) == {"sent": 0, "failed": 0, "removed": 0}


def test_market_hours():
    from datetime import datetime
    from optionflow.modules.notify.service import ET, market_open
    assert market_open(datetime(2026, 11, 9, 10, 0, tzinfo=ET))           # Monday 10:00 ET
    assert not market_open(datetime(2026, 11, 8, 10, 0, tzinfo=ET))       # Sunday
    assert not market_open(datetime(2026, 11, 9, 16, 30, tzinfo=ET))


# ── API ───────────────────────────────────────────────────────────────────────
@pytest.fixture
def client(db_engine_and_session, settings_override):
    from optionflow.modules.auth import service as auth
    auth.create_user("owner", PASSWORD)
    app = create_app(Settings(_env_file=None, jwt_secret="test-secret-do-not-use-in-prod",
                              jwt_audience="optionflow-app", jwt_issuer="optionflow-api"))
    return TestClient(app)


def _login(c):
    r = c.post("/api/v1/auth/login", json={"username": "owner", "password": PASSWORD})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


SUB = {"endpoint": "https://web.push.apple.com/QWERTY", "keys": {"p256dh": "BCVx", "auth": "BTBZ"}}


def test_api_needs_login_and_keys(client, monkeypatch):
    monkeypatch.delenv("PUSH_VAPID_PRIVATE_KEY", raising=False)
    assert client.get("/api/v1/notify/config").status_code == 401
    h = _login(client)
    assert client.get("/api/v1/notify/config", headers=h).json() == {"enabled": False, "public_key": None}
    assert client.post("/api/v1/notify/subscriptions", json=SUB, headers=h).status_code == 503


def test_api_subscribe_test_unsubscribe(client, keys, monkeypatch):
    h = _login(client)
    assert client.get("/api/v1/notify/config", headers=h).json() == {"enabled": True, "public_key": keys}
    assert client.post("/api/v1/notify/subscriptions", json={**SUB, "endpoint": "http://not-https"}, headers=h).status_code == 422
    devs = client.post("/api/v1/notify/subscriptions", json=SUB, headers=h).json()
    assert len(devs) == 1 and "endpoint" not in devs[0]                    # endpoints aren't echoed back
    calls = []
    monkeypatch.setattr(webpush, "send", lambda ep, *a, **k: (calls.append(ep), webpush.SendResult(201, False))[1])
    r = client.post("/api/v1/notify/test", headers=h).json()
    assert r["sent"] == 1 and calls == [SUB["endpoint"]]
    assert client.post("/api/v1/notify/unsubscribe", json={"endpoint": SUB["endpoint"]}, headers=h).json() == []


# ── controls (owner): which alerts, which symbols ─────────────────────────────
EXTRA = {"books": [{"symbol": "RIOT", "spot": 16.7, "iv": {"spike": True, "iv_roc_day": 0.18}, "suggestion": {"action": "WAIT"},
                    "legs": [{"kind": "option", "quantity": -1, "otype": "call", "strike": 14.5, "expiry": "2026-11-10", "dte": 1.0},
                             {"kind": "option", "quantity": -1, "otype": "put", "strike": 14.0, "expiry": "2026-11-10", "dte": 1.0}]}]}


def test_iv_spike_and_expiring_itm_alerts():
    a = service.alerts_for(EXTRA)
    assert [x["key"] for x in a] == ["iv:RIOT", "ex:RIOT:14.5C:2026-11-10"]           # the OTM put isn't flagged


def test_prefs_filter_kinds_and_symbols(db_engine_and_session, keys):
    uid = _user()
    service.subscribe(uid, "https://push.example/1", "p", "a", None)
    assert service.get_prefs(uid) == service.DEFAULT_PREFS
    service.set_prefs(uid, {"buyback": True, "sell_call": False, "sell_put": False, "buy_stock": False, "symbols": ["upst", " mp "]})
    sent = []
    sender = lambda *a, **k: (sent.append(a[3]["tag"]), webpush.SendResult(201, False))[1]   # noqa: E731
    assert service.run_for_user(uid, books_fn=lambda _u: BOOKS, sender=sender) == 1
    assert sent == ["bb:UPST:22.5C:2026-11-13"]
    service.set_prefs(uid, {"sell_call": True, "symbols": []})                      # trades now on: MP comes through
    assert service.run_for_user(uid, books_fn=lambda _u: BOOKS, sender=sender) == 2  # MP sell call + AAPL buy stock
    assert set(sent) == {"bb:UPST:22.5C:2026-11-13", "sg:MP:SELL_CALL:33.5C:2026-11-13", "sg:AAPL:BUY_STOCK:40"}


def test_new_device_copies_prefs(db_engine_and_session, keys):
    uid = _user()
    service.subscribe(uid, "https://push.example/1", "p", "a", None)
    service.set_prefs(uid, {"iv_spike": True, "symbols": ["RIOT"]})
    service.subscribe(uid, "https://push.example/2", "p", "a", None)
    assert all(s["prefs"]["iv_spike"] and s["prefs"]["symbols"] == ["RIOT"] for s in service.subscriptions(uid))


def test_api_prefs(client, keys):
    h = _login(client)
    assert client.put("/api/v1/notify/prefs", json={"buyback": False}, headers=h).status_code == 409   # no device yet
    client.post("/api/v1/notify/subscriptions", json=SUB, headers=h)
    r = client.put("/api/v1/notify/prefs", json={"buyback": True, "sell_call": False, "symbols": ["mp"]}, headers=h).json()
    assert r["sell_call"] is False and r["symbols"] == ["MP"] and r["iv_spike"] is False
    assert client.get("/api/v1/notify/prefs", headers=h).json() == r
