import streamlit as st
from typing import Any, Optional
from datetime import datetime, timedelta, timezone
from streamlit.components.v1 import html as _html
from urllib.parse import urlencode
import uuid

try:
    from streamlit_cookies_manager import CookieManager
except Exception:  # optional dependency; app should still run without it
    CookieManager = None  # type: ignore

from frontend_client import APIError
from frontend_client import api_base_url, api_health
from frontend_client import login as api_login
from frontend_client import logout as api_logout
from frontend_client import change_password as api_change_password
from frontend_client import signup as api_signup

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


def _cookie_manager() -> CookieManager:
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


def _cookies() -> Optional[CookieManager]:
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
    st.session_state["user"] = bs.username
    st.session_state["user_id"] = int(bs.user_id)
    st.session_state[_SID_SESSION_KEY] = bs.sid
    # Keep `sid` in the URL so hard refresh continues to work even if the browser
    # doesn't persist cookies reliably.


def _persist_auth_to_cookie(*, token: str, username: str, user_id: int) -> None:
    # Keep function name for compatibility, but persist via sid store.
    sid = st.session_state.get(_SID_SESSION_KEY)
    if not sid:
        sid = uuid.uuid4().hex
        st.session_state[_SID_SESSION_KEY] = sid
    save_session(sid=str(sid), token=token, username=username, user_id=int(user_id))
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
        if tok:
            api_logout(str(tok))
    except Exception:
        pass
    _clear_auth_cookie()
    st.session_state.pop('user', None)
    st.session_state.pop('user_id', None)
    st.session_state.pop('token', None)
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

        st.markdown("**Change password**")
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
            try:
                api_change_password(str(token), current, new)
            except APIError as e:
                st.error(str(e.detail or e))
            else:
                st.toast("Password updated", icon="✅")


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
            "`PYTHONPATH=/Users/karthikkondajjividyaranya/Desktop/million-app/million-app `"
            "`/Users/karthikkondajjividyaranya/Desktop/million-app/.venv/bin/python -m uvicorn backend_api.main:app --host 127.0.0.1 --port 8000`\n\n"
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
                        _persist_auth_to_cookie(
                            token=st.session_state['token'],
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
                                _persist_auth_to_cookie(
                                    token=st.session_state['token'],
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
                        _persist_auth_to_cookie(
                            token=st.session_state['token'],
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
