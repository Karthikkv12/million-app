import streamlit as st
from typing import Any, Optional
from datetime import datetime, timedelta, timezone
from streamlit.components.v1 import html as _html
from urllib.parse import urlencode
import uuid


# `streamlit-cookies-manager` still uses the deprecated `st.cache` decorator.
# Shim it to `st.cache_data` to avoid noisy deprecation warnings on startup.
try:
    if hasattr(st, "cache_data") and not getattr(st, "_million_cache_shim", False):
        setattr(st, "cache", st.cache_data)
        setattr(st, "_million_cache_shim", True)
except Exception:
    pass

try:
    from streamlit_cookies_manager import CookieManager
except Exception:  # optional dependency; app should still run without it
    CookieManager = None  # type: ignore

from frontend_client import APIError
from frontend_client import api_base_url, api_health
from frontend_client import login as api_login
from frontend_client import logout as api_logout
from frontend_client import logout_with_refresh as api_logout_with_refresh
from frontend_client import logout_all as api_logout_all
from frontend_client import refresh as api_refresh
from frontend_client import change_password as api_change_password
from frontend_client import signup as api_signup
from frontend_client import auth_events as api_auth_events
from frontend_client import auth_sessions as api_auth_sessions
from frontend_client import revoke_session as api_revoke_session

from browser_sessions import cleanup_expired, delete_session, load_session, save_session


_PENDING_COOKIE_SET_KEY = "_million_pending_cookie_set"
_PENDING_COOKIE_CLEAR_KEY = "_million_pending_cookie_clear"
_COOKIE_RESTORE_RERUNS_KEY = "_million_cookie_restore_reruns"
_SID_COOKIE_NAME = "million_sid"
_SID_SESSION_KEY = "_million_sid"


def ensure_canonical_host() -> None:
        """Ensure the app runs on a single hostname so cookies persist.

        If you sign in on `localhost` and later refresh on `127.0.0.1` (or vice-versa),
        browser cookies won't match and auth restore will fail (Safari is especially easy
        to hit here). This silently redirects to the canonical local hostname.
        """

        _html(
                """
<script>
(function () {
    try {
        var desired = "127.0.0.1";
        var h = window.location.hostname;
        if (h === "localhost" || h === "0.0.0.0" || h === "::1") {
            var url = new URL(window.location.href);
            url.hostname = desired;
            window.location.replace(url.toString());
        }
    } catch (e) {
        // no-op
    }
})();
</script>
""",
                height=0,
                width=0,
        )


def _cookie_manager() -> Any:
    # CookieManager is a Streamlit component (widget). It must NOT be created
    # inside any `st.cache_*` function.
    if CookieManager is None:
        raise RuntimeError("streamlit-cookies-manager is not installed")

    key = "_million_cookie_manager"
    existing = st.session_state.get(key)
    if existing is None:
        existing = CookieManager()
        st.session_state[key] = existing

    # Safari can be picky about parsing ISO datetimes without timezone and/or with
    # microseconds. The component code does `new Date(spec.expires_at)`, so ensure
    # we feed it a robust, timezone-aware UTC timestamp with no microseconds.
    try:
        existing._default_expiry = (datetime.now(timezone.utc) + timedelta(days=365)).replace(microsecond=0)
    except Exception:
        pass
    return existing


def _cookies() -> Optional[Any]:
    if CookieManager is None:
        raise RuntimeError("streamlit-cookies-manager is not installed")
    cookies = _cookie_manager()
    # IMPORTANT: don't `st.stop()` here.
    # On first load CookieManager may not be ready yet; stopping early can render a blank page.
    # Callers should treat "not ready" as "no cookies available yet" and continue rendering.
    if not cookies.ready():
        return None
    return cookies


def _flush_pending_cookie_ops() -> None:
    """Apply any queued cookie operations once CookieManager becomes ready.

    CookieManager is sometimes not ready on the same run where a login/signup succeeds,
    which would otherwise drop the cookie write and make refresh log the user out.
    """

    if CookieManager is None:
        return

    cookies = _cookies()
    if cookies is None:
        return

    pending_set = st.session_state.get(_PENDING_COOKIE_SET_KEY)
    pending_clear = bool(st.session_state.get(_PENDING_COOKIE_CLEAR_KEY))

    if pending_clear:
        for k in ("million_token", "million_user", "million_user_id"):
            cookies.pop(k, None)
        cookies.save()
        st.session_state.pop(_PENDING_COOKIE_CLEAR_KEY, None)

    if isinstance(pending_set, dict):
        token = pending_set.get("token")
        username = pending_set.get("username")
        user_id = pending_set.get("user_id")
        if token and username and user_id is not None:
            cookies["million_token"] = str(token)
            cookies["million_user"] = str(username)
            cookies["million_user_id"] = str(user_id)
            cookies.save()
        st.session_state.pop(_PENDING_COOKIE_SET_KEY, None)


def _set_sid_cookie(sid: str, *, days: int = 30) -> None:
        # Set cookie on the *parent* document with a normal, unencoded path.
        # Avoid streamlit-cookies-manager here; its path encoding is not Safari-friendly.
        expires = (datetime.now(timezone.utc) + timedelta(days=int(days))).strftime("%a, %d %b %Y %H:%M:%S GMT")
        _html(
                f"""
<script>
(function() {{
    try {{
        var expires = "{expires}";
        window.parent.document.cookie = "{_SID_COOKIE_NAME}=" + encodeURIComponent("{sid}") + "; expires=" + expires + "; path=/";
    }} catch (e) {{}}
}})();
</script>
""",
                height=0,
                width=0,
        )


def _clear_sid_cookie() -> None:
        _html(
                f"""
<script>
(function() {{
    try {{
        window.parent.document.cookie = "{_SID_COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    }} catch (e) {{}}
}})();
</script>
""",
                height=0,
                width=0,
        )


def _ensure_sid_query_param_from_cookie() -> None:
        # JS reads the sid cookie and, if present, appends it as `sid=` query param.
        # We only move the sid (not JWT) into the URL. Streamlit can read it and load
        # the JWT from server-side storage.
        _html(
                f"""
<script>
(function() {{
    try {{
        var name = "{_SID_COOKIE_NAME}=";
        var cookies = window.parent.document.cookie.split(';');
        var sid = null;
        for (var i = 0; i < cookies.length; i++) {{
            var c = cookies[i].trim();
            if (c.indexOf(name) === 0) {{ sid = decodeURIComponent(c.substring(name.length)); break; }}
        }}
        if (!sid) return;
        var url = new URL(window.parent.location.href);
        if (!url.searchParams.get('sid')) {{
            url.searchParams.set('sid', sid);
            window.parent.location.replace(url.toString());
        }}
    }} catch (e) {{}}
}})();
</script>
""",
                height=0,
                width=0,
        )


def _get_query_param(name: str) -> Optional[str]:
    # Streamlit has two APIs depending on version.
    try:
        qp = st.query_params  # type: ignore[attr-defined]
        val = qp.get(name)
        if isinstance(val, list):
            return val[0] if val else None
        return str(val) if val is not None else None
    except Exception:
        try:
            qp = st.experimental_get_query_params()
            vals = qp.get(name)
            return vals[0] if vals else None
        except Exception:
            return None


def _clear_query_params() -> None:
    try:
        qp = st.query_params  # type: ignore[attr-defined]
        qp.clear()
    except Exception:
        try:
            st.experimental_set_query_params()
        except Exception:
            pass


def _set_sid_query_param(sid: str) -> None:
    try:
        qp = st.query_params  # type: ignore[attr-defined]
        qp["sid"] = sid
    except Exception:
        try:
            st.experimental_set_query_params(sid=sid)
        except Exception:
            pass


def _clear_sid_query_param() -> None:
    try:
        qp = st.query_params  # type: ignore[attr-defined]
        qp.pop("sid", None)
    except Exception:
        try:
            # Clear all params (older API can't pop one key).
            st.experimental_set_query_params()
        except Exception:
            pass


def restore_auth_from_cookie() -> None:
    """Restore auth state after a browser refresh.

    Streamlit session state is reset on refresh; we persist auth in browser cookies.
    """

    if st.session_state.get("token") and st.session_state.get("user") and st.session_state.get("user_id"):
        return

    # Primary persistence path (Safari-safe): sid cookie -> query param -> server-side lookup.
    cleanup_expired()
    _ensure_sid_query_param_from_cookie()
    sid = _get_query_param("sid")
    if not sid:
        return
    bs = load_session(str(sid))
    if not bs:
        # Invalid/expired; clear param and cookie to avoid redirect loops.
        _clear_query_params()
        _clear_sid_cookie()
        return
    st.session_state["token"] = bs.token
    if getattr(bs, "refresh_token", None):
        st.session_state["refresh_token"] = str(bs.refresh_token)
    st.session_state["user"] = bs.username
    st.session_state["user_id"] = int(bs.user_id)
    st.session_state[_SID_SESSION_KEY] = bs.sid
    # Keep `sid` in the URL so hard refresh continues to work even if the browser
    # doesn't persist cookies reliably.


def _persist_auth_to_cookie(*, token: str, refresh_token: str = "", username: str, user_id: int) -> None:
    # Keep function name for compatibility, but persist via sid store.
    sid = st.session_state.get(_SID_SESSION_KEY)
    if not sid:
        sid = uuid.uuid4().hex
        st.session_state[_SID_SESSION_KEY] = sid
    save_session(sid=str(sid), token=token, refresh_token=str(refresh_token or ""), username=username, user_id=int(user_id))
    _set_sid_cookie(str(sid))
    _set_sid_query_param(str(sid))


def _clear_auth_cookie() -> None:
    sid = st.session_state.get(_SID_SESSION_KEY)
    if sid:
        try:
            delete_session(str(sid))
        except Exception:
            pass
    st.session_state.pop(_SID_SESSION_KEY, None)
    _clear_sid_cookie()
    _clear_sid_query_param()


def _api_error_message(e: APIError, *, prefix: str) -> str:
    # FastAPI/Pydantic validation errors (422) often come back as a structured list.
    # We keep it simple and show a friendly message for the common "empty fields" case.
    detail_str = str(e.detail)
    if e.status_code == 422 and "string_too_short" in detail_str and "username" in detail_str and "password" in detail_str:
        return f"{prefix}: Username and password are required"
    if e.status_code == 0:
        return f"{prefix}: {e.detail}"
    return f"{prefix}: {e.detail}"


def sidebar_auth():
    """Render sidebar auth controls (for signed-in state)."""
    return sidebar_auth_with_options(show_logout=True)


def sidebar_auth_with_options(*, show_logout: bool = True) -> None:
    """Render sidebar auth controls (for signed-in state).

    Args:
        show_logout: Whether to show the Logout button in the sidebar.
    """
    _flush_pending_cookie_ops()
    if 'user' in st.session_state:
        st.sidebar.markdown(f"**Signed in:** {st.session_state['user']}")
        if show_logout and st.sidebar.button('Logout'):
            logout_and_rerun()


def logout_and_rerun() -> None:
    """Clear auth (sid cookie + server session + Streamlit state) and rerun."""
    _flush_pending_cookie_ops()
    # Best-effort backend logout (token revocation). Ignore if backend is older or down.
    try:
        tok = st.session_state.get("token")
        rt = st.session_state.get("refresh_token")
        if tok:
            # Prefer revoking refresh token too.
            try:
                api_logout_with_refresh(str(tok), str(rt) if rt else None)
            except Exception:
                api_logout(str(tok))
    except Exception:
        pass
    _clear_auth_cookie()
    st.session_state.pop('user', None)
    st.session_state.pop('user_id', None)
    st.session_state.pop('token', None)
    st.session_state.pop('refresh_token', None)
    # Also clear any other query params (e.g. `action=logout`) to avoid loops.
    _clear_query_params()

    # Attempt to rerun; different Streamlit versions expose different APIs.
    if hasattr(st, 'experimental_rerun'):
        try:
            st.experimental_rerun()
        except Exception:
            st.stop()
    elif hasattr(st, 'rerun'):
        try:
            st.rerun()
        except Exception:
            st.stop()
    else:
        st.stop()


def render_security_section() -> None:
    """Render identity/security controls (meant to be embedded inside the Investment page)."""
    with st.expander("Security", expanded=False):
        user = st.session_state.get("user")
        if user:
            st.caption(f"Signed in as **{user}**")

        token = st.session_state.get("token")
        if not token:
            st.info("Sign in to manage security settings.")
            return

        # --- Token/session quick glance ---
        try:
            import jwt  # type: ignore

            payload = jwt.decode(str(token), options={"verify_signature": False, "verify_aud": False, "verify_iss": False})
            exp = int(payload.get("exp") or 0)
            now = int(datetime.now(timezone.utc).timestamp())
            ttl = max(0, exp - now)
            m, s = divmod(int(ttl), 60)
            h, m = divmod(int(m), 60)
            ttl_txt = f"{h}h {m}m" if h else f"{m}m {s}s"
            c1, c2 = st.columns(2)
            c1.metric("Access token expires in", ttl_txt)
            c2.caption("Auto-refreshes when near expiry.")
        except Exception:
            pass

        if st.button("Logout everywhere", type="secondary"):
            # Best-effort: invalidate all tokens for this user, then clear local session.
            try:
                api_logout_all(str(token))
            except Exception:
                pass
            logout_and_rerun()
            return

        def _parse_dt(s: Any) -> Optional[datetime]:
            if not s:
                return None
            if isinstance(s, datetime):
                return s
            try:
                txt = str(s).strip()
                if txt.endswith("Z"):
                    txt = txt[:-1] + "+00:00"
                return datetime.fromisoformat(txt)
            except Exception:
                return None

        # Load data once so status + tables stay consistent.
        sessions: list[dict] = []
        events: list[dict] = []
        try:
            sessions = api_auth_sessions(str(token))
        except APIError as e:
            if e.status_code not in {0, 404}:
                st.caption(f"Could not load sessions: {e.detail}")
        except Exception:
            sessions = []

        try:
            events = api_auth_events(str(token))
        except APIError as e:
            # Backwards-compatible with older backends.
            if e.status_code not in {0, 404}:
                st.caption(f"Could not load events: {e.detail}")
            events = []
        except Exception:
            events = []

        # --- Security status banner ---
        now_utc = datetime.now(timezone.utc)
        window = timedelta(hours=24)
        recent_failures = 0
        for ev in events:
            created = _parse_dt(ev.get("created_at"))
            if created is None:
                continue
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            if (now_utc - created) > window:
                continue
            if bool(ev.get("success")) is False:
                recent_failures += 1

        active_sessions = len(sessions)
        st.markdown("**Security status**")
        if recent_failures >= 3:
            st.error(f"High risk: {recent_failures} failed auth events in the last 24 hours. Active sessions: {active_sessions}.")
        elif recent_failures >= 1:
            st.warning(f"Caution: {recent_failures} failed auth event(s) in the last 24 hours. Active sessions: {active_sessions}.")
        else:
            st.success(f"OK: no failed auth events in the last 24 hours. Active sessions: {active_sessions}.")

        # Last successful login + recent new sessions signal.
        try:
            last_login = None
            for ev in events:
                if str(ev.get("event_type") or "") != "login":
                    continue
                if bool(ev.get("success")) is not True:
                    continue
                last_login = ev
                break
            if last_login is not None:
                ll_dt = _parse_dt(last_login.get("created_at"))
                ll_ip = str(last_login.get("ip") or "") or None
                ll_txt = ll_dt.isoformat() if isinstance(ll_dt, datetime) else str(last_login.get("created_at") or "")
                st.caption(f"Last login: {ll_txt}" + (f" from {ll_ip}" if ll_ip else ""))

            new_sessions_24h = 0
            for s in sessions:
                created = _parse_dt(s.get("created_at"))
                if created is None:
                    continue
                if created.tzinfo is None:
                    created = created.replace(tzinfo=timezone.utc)
                if (now_utc - created) <= window:
                    new_sessions_24h += 1
            if new_sessions_24h >= 2:
                st.warning(f"{new_sessions_24h} sessions created in the last 24 hours.")
        except Exception:
            pass

        st.markdown("**Devices / sessions**")
        if sessions:
            options: list[tuple[int, str]] = []
            for s in sessions:
                sid = int(s.get("id"))
                ip = str(s.get("ip") or "")
                ua = str(s.get("user_agent") or "")
                created = str(s.get("created_at") or "")
                label = f"{sid} — {ip} — {ua[:60]}{'…' if len(ua) > 60 else ''} — {created}"
                options.append((sid, label))

            selected = st.selectbox(
                "Active sessions",
                options=options,
                format_func=lambda x: x[1],
            )

            c1, _ = st.columns([1, 3])
            if c1.button("Revoke selected", type="secondary"):
                try:
                    api_revoke_session(str(token), int(selected[0]))
                    st.toast("Session revoked", icon="✅")
                    if hasattr(st, 'rerun'):
                        st.rerun()
                    elif hasattr(st, 'experimental_rerun'):
                        st.experimental_rerun()
                except APIError as e:
                    st.error(str(e.detail or e))
                except Exception:
                    st.error("Could not revoke session")
        else:
            st.caption("No active sessions.")

        st.markdown("**Recent security activity**")
        if events:
            import pandas as _pd

            df = _pd.DataFrame(events)
            # Keep it compact.
            cols = [c for c in ["created_at", "event_type", "success", "ip", "detail"] if c in df.columns]
            st.dataframe(df[cols], width="stretch", hide_index=True)
        else:
            st.caption("No recent events.")

        st.markdown("**Change password**")
        st.caption("Password policy: 12+ chars, upper + lower + number (special optional).")
        with st.form("change_password_form"):
            current = st.text_input("Current password", type="password")
            new = st.text_input("New password", type="password")
            confirm = st.text_input("Confirm new password", type="password")
            submitted = st.form_submit_button("Update password", type="primary")

        if submitted:
            if not current or not new:
                st.error("Current and new password are required.")
                return
            if new != confirm:
                st.error("New passwords do not match.")
                return
            # Client-side quick checks to avoid a round trip.
            if len(new) < 12:
                st.error("Password must be at least 12 characters.")
                return
            if not any(c.isupper() for c in new):
                st.error("Password must include an uppercase letter.")
                return
            if not any(c.islower() for c in new):
                st.error("Password must include a lowercase letter.")
                return
            if not any(c.isdigit() for c in new):
                st.error("Password must include a number.")
                return
            try:
                resp = api_change_password(str(token), current, new)
            except APIError as e:
                st.error(str(e.detail or e))
            else:
                # Backend returns a fresh token; keep the user signed in.
                new_token = str(resp.get("access_token") or "").strip()
                new_username = str(resp.get("username") or (st.session_state.get("user") or "")).strip()
                new_user_id = resp.get("user_id")
                if new_token and new_username and new_user_id is not None:
                    st.session_state["token"] = new_token
                    st.session_state["user"] = new_username
                    st.session_state["user_id"] = int(new_user_id)
                    new_refresh = str(resp.get("refresh_token") or "").strip()
                    if new_refresh:
                        st.session_state["refresh_token"] = new_refresh
                    _persist_auth_to_cookie(
                        token=new_token,
                        refresh_token=str(st.session_state.get("refresh_token") or ""),
                        username=new_username,
                        user_id=int(new_user_id),
                    )
                st.toast("Password updated", icon="✅")


def ensure_fresh_token(*, min_ttl_seconds: int = 60) -> None:
    """Best-effort: refresh access token if it's near expiry.

    This is intentionally silent; if refresh fails (backend down), we keep the
    current token and let API calls surface errors.
    """
    token = str(st.session_state.get("token") or "").strip()
    refresh_token = str(st.session_state.get("refresh_token") or "").strip()
    if not token or not refresh_token:
        return

    # Decode exp without verifying signature (we only use it as a hint).
    exp = None
    try:
        import jwt  # type: ignore

        payload = jwt.decode(token, options={"verify_signature": False, "verify_aud": False, "verify_iss": False})
        exp = int(payload.get("exp") or 0)
    except Exception:
        exp = None

    if exp is None:
        return

    now = int(datetime.now(timezone.utc).timestamp())
    if (exp - now) > int(min_ttl_seconds):
        return

    try:
        resp = api_refresh(refresh_token)
    except APIError as e:
        # If the refresh token is invalid/expired, force re-login.
        if int(e.status_code) == 401:
            logout_and_rerun()
        return
    except Exception:
        return

    new_access = str(resp.get("access_token") or "").strip()
    new_refresh = str(resp.get("refresh_token") or "").strip()
    if not new_access:
        return

    st.session_state["token"] = new_access
    if new_refresh:
        st.session_state["refresh_token"] = new_refresh
    # Keep persisted server-side session in sync.
    username = str(resp.get("username") or (st.session_state.get("user") or "")).strip()
    user_id = resp.get("user_id")
    if username and user_id is not None:
        st.session_state["user"] = username
        st.session_state["user_id"] = int(user_id)
        _persist_auth_to_cookie(
            token=new_access,
            refresh_token=str(st.session_state.get("refresh_token") or ""),
            username=username,
            user_id=int(user_id),
        )


def login_page():
    """Render the main login / signup page centered in the app.

    On successful auth or signup this sets `st.session_state['user']` and `['user_id']` and reruns.
    """
    st.markdown("""
    <style>
    /* Keep the CTA clean: remove any focus outline/border on this page */
    button[kind="primary"],
    button[kind="primary"]:focus,
    button[kind="primary"]:focus-visible {
        outline: none !important;
        box-shadow: none !important;
        border: none !important;
    }

    /* Exactly center the landing CTA in the viewport area below the 50px top band.
       We position the *button element* itself (not the container), because the container
       can be full-width and look visually off-center. */
    #landing-cta + div[data-testid="stButton"] button {
        position: fixed;
        top: calc(50% + 25px);
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 2147483646;
        margin: 0 !important;
    }
    .top-band {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: 50px;
        background: #000;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        padding-left: 16px;
        box-sizing: border-box;
    }
    .top-band .brand {
        font-size: 28px;
        font-weight: 800;
        color: #00c805;
        line-height: 1;
    }
    .login-box {
        max-width: 480px;
        margin: 140px auto;
        padding: 24px;
        border-radius: 12px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.08);
        text-align: center;
    }
    </style>
    <div class="top-band"><div class="brand">Million</div></div>
    """, unsafe_allow_html=True)

    # Backend status hint (common setup issue when running split frontend/backend).
    if not api_health():
        st.warning(
            "Backend API is not reachable at "
            f"`{api_base_url()}`. Start the backend in a separate terminal:\n\n"
            "Option A (one-command dev runner):\n"
            "`./scripts/dev.sh`\n\n"
            "Option B (API only):\n"
            "`cd <repo_root> && PYTHONPATH=$PWD python -m uvicorn backend_api.main:app --host 127.0.0.1 --port 8000`\n\n"
            "Then refresh this page.",
        )

    # If the user refreshed and still has a valid persisted session, restore and continue.
    restore_auth_from_cookie()
    if st.session_state.get("user") and st.session_state.get("token"):
        return

    # track whether user clicked Sign up to navigate to the signup page
    if 'show_signup' not in st.session_state:
        st.session_state['show_signup'] = False

    if not st.session_state.get('show_signup'):
        # Landing: only a green Sign up CTA centered on screen (no box around it).
        # Note: Streamlit widgets can't be reliably wrapped/centered by custom HTML divs,
        # so we use Streamlit layout primitives.
        st.markdown('<div id="landing-cta"></div>', unsafe_allow_html=True)
        # Avoid `st.form` here because it renders a thin container outline in some themes.
        if st.button('Sign up', type='primary'):
            st.session_state['show_signup'] = True
            if hasattr(st, 'experimental_rerun'):
                try:
                    st.experimental_rerun()
                except Exception:
                    st.stop()
            elif hasattr(st, 'rerun'):
                try:
                    st.rerun()
                except Exception:
                    st.stop()
            else:
                st.stop()

    else:
        # Sign-up page
        col1, col2, col3 = st.columns([1, 2, 1])
        with col2:
            st.markdown('<div class="login-box">', unsafe_allow_html=True)
            st.header('Create an account')
            with st.form('signup'):
                username = st.text_input('Choose a username', key='signup_username')
                password = st.text_input('Choose a password', type='password', key='signup_password')
                b1, b2 = st.columns(2)
                with b1:
                    create_submitted = st.form_submit_button('Create account', type='primary')
                with b2:
                    signin_submitted = st.form_submit_button('Sign in')

                username_clean = (username or "").strip()
                password_clean = password or ""

                if create_submitted:
                    if not username_clean or not password_clean:
                        st.error('Username and password are required')
                        st.stop()
                    try:
                        resp = api_signup(username_clean, password_clean)
                        st.success('Account created — signing you in...')
                        st.session_state['user'] = resp.get('username', username_clean)
                        st.session_state['user_id'] = int(resp['user_id'])
                        st.session_state['token'] = resp['access_token']
                        st.session_state['refresh_token'] = str(resp.get('refresh_token') or '')
                        _persist_auth_to_cookie(
                            token=st.session_state['token'],
                            refresh_token=str(st.session_state.get('refresh_token') or ''),
                            username=st.session_state['user'],
                            user_id=st.session_state['user_id'],
                        )
                        st.session_state['show_signup'] = False
                        if hasattr(st, 'experimental_rerun'):
                            try:
                                st.experimental_rerun()
                            except Exception:
                                st.stop()
                        elif hasattr(st, 'rerun'):
                            try:
                                st.rerun()
                            except Exception:
                                st.stop()
                        else:
                            st.stop()
                    except APIError as e:
                        # If account exists, treat this page as a sign-in using the same inputs.
                        if e.status_code == 400 and 'exists' in str(e.detail).lower():
                            try:
                                resp = api_login(username_clean, password_clean)
                                st.success('Signed in')
                                st.session_state['user'] = resp.get('username', username_clean)
                                st.session_state['user_id'] = int(resp['user_id'])
                                st.session_state['token'] = resp['access_token']
                                st.session_state['refresh_token'] = str(resp.get('refresh_token') or '')
                                _persist_auth_to_cookie(
                                    token=st.session_state['token'],
                                    refresh_token=str(st.session_state.get('refresh_token') or ''),
                                    username=st.session_state['user'],
                                    user_id=st.session_state['user_id'],
                                )
                                st.session_state['show_signup'] = False
                                if hasattr(st, 'experimental_rerun'):
                                    try:
                                        st.experimental_rerun()
                                    except Exception:
                                        st.stop()
                                elif hasattr(st, 'rerun'):
                                    try:
                                        st.rerun()
                                    except Exception:
                                        st.stop()
                                else:
                                    st.stop()
                            except APIError:
                                st.error('Username already exists, and password did not match')
                        else:
                            st.error(_api_error_message(e, prefix='Registration error'))
                    except Exception as e:
                        st.error(f'Registration error: {e}')

                elif signin_submitted:
                    if not username_clean or not password_clean:
                        st.error('Username and password are required')
                        st.stop()
                    try:
                        resp = api_login(username_clean, password_clean)
                        st.success('Signed in')
                        st.session_state['user'] = resp.get('username', username_clean)
                        st.session_state['user_id'] = int(resp['user_id'])
                        st.session_state['token'] = resp['access_token']
                        st.session_state['refresh_token'] = str(resp.get('refresh_token') or '')
                        _persist_auth_to_cookie(
                            token=st.session_state['token'],
                            refresh_token=str(st.session_state.get('refresh_token') or ''),
                            username=st.session_state['user'],
                            user_id=st.session_state['user_id'],
                        )
                        st.session_state['show_signup'] = False
                        if hasattr(st, 'experimental_rerun'):
                            try:
                                st.experimental_rerun()
                            except Exception:
                                st.stop()
                        elif hasattr(st, 'rerun'):
                            try:
                                st.rerun()
                            except Exception:
                                st.stop()
                        else:
                            st.stop()
                    except APIError as e:
                        st.error(_api_error_message(e, prefix='Sign-in error'))
                    except Exception as e:
                        st.error(f'Sign-in error: {e}')

            if st.button('Back'):
                st.session_state['show_signup'] = False
                if hasattr(st, 'experimental_rerun'):
                    try:
                        st.experimental_rerun()
                    except Exception:
                        st.stop()
                elif hasattr(st, 'rerun'):
                    try:
                        st.rerun()
                    except Exception:
                        st.stop()
                else:
                    st.stop()

            st.markdown('</div>', unsafe_allow_html=True)
