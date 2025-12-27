import streamlit as st

from frontend_client import APIError
from frontend_client import api_base_url, api_health
from frontend_client import login as api_login
from frontend_client import signup as api_signup


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
    if 'user' in st.session_state:
        st.sidebar.markdown(f"**Signed in:** {st.session_state['user']}")
        if st.sidebar.button('Logout'):
            del st.session_state['user']
            if 'user_id' in st.session_state:
                del st.session_state['user_id']
            if 'token' in st.session_state:
                del st.session_state['token']
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
