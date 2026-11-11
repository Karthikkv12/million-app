"""Login sessions: hard expiry, refresh-token reuse detection, and the HttpOnly refresh cookie."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from database.models import RefreshToken
from optionflow.core.settings import Settings
from optionflow.main import create_app
from optionflow.modules.auth import service as auth

PW = "Correct-Horse-9"
COOKIE = {"X-Token-Transport": "cookie"}


def _user(name="alice") -> int:
    auth.create_user(name, PW)
    return int(auth.authenticate_user(name, PW)["user_id"])


def _row(session_factory, token: str) -> RefreshToken:
    with session_factory() as s:
        return s.query(RefreshToken).filter(RefreshToken.token_hash == auth._hash_refresh_token(token)).one()


def _age_rotation(session_factory, token: str, seconds: int) -> None:
    """Pretend `token` was rotated `seconds` ago (past the reuse grace window)."""
    with session_factory() as s:
        rt = s.query(RefreshToken).filter(RefreshToken.token_hash == auth._hash_refresh_token(token)).one()
        rt.revoked_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=seconds)
        s.commit()


# ── Service ──────────────────────────────────────────────────────────────────

def test_rotation_never_extends_the_login(db_engine_and_session):
    _, sf = db_engine_and_session
    uid = _user()
    rt = auth.create_refresh_token(user_id=uid)
    first = _row(sf, rt)
    assert (first.expires_at - first.created_at) <= timedelta(days=7, seconds=5)

    _, rt2 = auth.rotate_refresh_token(refresh_token=rt)
    second = _row(sf, rt2)
    assert second.expires_at == first.expires_at          # same hard end date
    assert second.created_at == first.created_at          # still shows when you signed in


def test_old_30_day_tokens_are_capped_to_7_days_on_rotation(db_engine_and_session):
    _, sf = db_engine_and_session
    uid = _user()
    rt = auth.create_refresh_token(user_id=uid)
    with sf() as s:
        row = s.query(RefreshToken).one()
        row.expires_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=30)
        s.commit()
    _, rt2 = auth.rotate_refresh_token(refresh_token=rt)
    left = _row(sf, rt2).expires_at - datetime.now(timezone.utc).replace(tzinfo=None)
    assert left <= timedelta(days=7, seconds=5)


def test_expired_login_cannot_refresh(db_engine_and_session):
    _, sf = db_engine_and_session
    uid = _user()
    rt = auth.create_refresh_token(user_id=uid)
    with sf() as s:
        s.query(RefreshToken).one().expires_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=1)
        s.commit()
    assert auth.rotate_refresh_token(refresh_token=rt) is None


def test_reuse_within_grace_gets_no_new_refresh_token(db_engine_and_session):
    uid = _user()
    rt = auth.create_refresh_token(user_id=uid)
    _, rt2 = auth.rotate_refresh_token(refresh_token=rt)
    assert auth.rotate_refresh_token(refresh_token=rt) == (uid, None)   # second tab racing
    assert auth.validate_refresh_token(refresh_token=rt2) == uid        # login untouched


def test_reuse_after_grace_revokes_the_whole_login(db_engine_and_session):
    _, sf = db_engine_and_session
    uid = _user()
    rt = auth.create_refresh_token(user_id=uid)
    _, rt2 = auth.rotate_refresh_token(refresh_token=rt)
    _, rt3 = auth.rotate_refresh_token(refresh_token=rt2)
    _age_rotation(sf, rt, 120)

    with pytest.raises(auth.RefreshReuse):
        auth.rotate_refresh_token(refresh_token=rt)                     # stolen copy replayed
    assert auth.validate_refresh_token(refresh_token=rt3) is None       # thief and owner both out
    assert _row(sf, rt3).revoked_reason == "reuse_detected"


def test_reuse_only_revokes_that_login(db_engine_and_session):
    _, sf = db_engine_and_session
    uid = _user()
    phone = auth.create_refresh_token(user_id=uid)
    laptop = auth.create_refresh_token(user_id=uid)
    _, phone2 = auth.rotate_refresh_token(refresh_token=phone)
    _age_rotation(sf, phone, 120)
    with pytest.raises(auth.RefreshReuse):
        auth.rotate_refresh_token(refresh_token=phone)
    assert auth.validate_refresh_token(refresh_token=phone2) is None
    assert auth.validate_refresh_token(refresh_token=laptop) == uid


def test_grace_does_not_revive_a_signed_out_login(db_engine_and_session):
    uid = _user()
    rt = auth.create_refresh_token(user_id=uid)
    _, rt2 = auth.rotate_refresh_token(refresh_token=rt)
    auth.revoke_refresh_token(user_id=uid, refresh_token=rt2)
    assert auth.rotate_refresh_token(refresh_token=rt) is None


# ── HTTP: the HttpOnly cookie ────────────────────────────────────────────────

@pytest.fixture
def client(db_engine_and_session):
    _user()
    return TestClient(create_app(Settings(_env_file=None, enabled_modules="auth")))


def _cookie_header(res) -> str:
    return "; ".join(v for k, v in res.headers.multi_items() if k.lower() == "set-cookie")


def test_browser_login_sets_httponly_cookie_and_hides_token(client):
    res = client.post("/api/v1/auth/login", json={"username": "alice", "password": PW}, headers=COOKIE)
    assert res.status_code == 200
    body = res.json()
    assert body["access_token"] and body["refresh_token"] is None
    sc = _cookie_header(res).lower()
    assert "of_rt=" in sc and "httponly" in sc and "samesite=strict" in sc and "path=/api/v1/auth" in sc
    assert "max-age=604800" in sc


def test_cookie_secure_behind_https_proxy(client):
    res = client.post("/api/v1/auth/login", json={"username": "alice", "password": PW},
                      headers={**COOKIE, "X-Forwarded-Proto": "https"})
    assert "secure" in _cookie_header(res).lower()


def test_refresh_with_cookie_only(client):
    client.post("/api/v1/auth/login", json={"username": "alice", "password": PW}, headers=COOKIE)
    old = client.cookies.get("of_rt")
    res = client.post("/api/v1/auth/refresh", headers=COOKIE)
    assert res.status_code == 200 and res.json()["refresh_token"] is None
    assert client.cookies.get("of_rt") and client.cookies.get("of_rt") != old


def test_refresh_without_anything_is_401(client):
    assert client.post("/api/v1/auth/refresh", headers=COOKIE).status_code == 401


def test_legacy_body_token_still_works_and_moves_to_cookie(client):
    """Devices signed in before this change send their old token in the body once."""
    res = client.post("/api/v1/auth/login", json={"username": "alice", "password": PW})   # no header: old client
    legacy = res.json()["refresh_token"]
    assert legacy
    client.cookies.clear()
    res = client.post("/api/v1/auth/refresh", json={"refresh_token": legacy}, headers=COOKIE)
    assert res.status_code == 200 and res.json()["refresh_token"] is None
    assert client.cookies.get("of_rt")


def test_stolen_cookie_replay_signs_everyone_out(client, db_engine_and_session):
    _, sf = db_engine_and_session
    client.post("/api/v1/auth/login", json={"username": "alice", "password": PW}, headers=COOKIE)
    stolen = client.cookies.get("of_rt")
    client.post("/api/v1/auth/refresh", headers=COOKIE)               # owner keeps using the site
    _age_rotation(sf, stolen, 120)

    thief = TestClient(client.app)
    res = thief.post("/api/v1/auth/refresh", json={"refresh_token": stolen}, headers=COOKIE)
    assert res.status_code == 401
    assert client.post("/api/v1/auth/refresh", headers=COOKIE).status_code == 401   # owner must sign in again
    events = [e["event_type"] for e in auth.list_auth_events(user_id=1, limit=10)]
    assert "refresh_reuse" in events


def test_logout_revokes_cookie_token_and_clears_cookie(client):
    res = client.post("/api/v1/auth/login", json={"username": "alice", "password": PW}, headers=COOKIE)
    access, rt = res.json()["access_token"], client.cookies.get("of_rt")
    res = client.post("/api/v1/auth/logout", headers={**COOKIE, "Authorization": f"Bearer {access}"})
    assert res.status_code == 200
    assert 'of_rt=""' in _cookie_header(res) or "max-age=0" in _cookie_header(res).lower()
    assert auth.validate_refresh_token(refresh_token=rt) is None
