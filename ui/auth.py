import streamlit as st
from logic.services import create_user, authenticate_user


def sidebar_auth():
    """Render sidebar auth controls (for signed-in state)."""
    if 'user' in st.session_state:
        st.sidebar.markdown(f"**Signed in:** {st.session_state['user']}")
        if st.sidebar.button('Logout'):
            del st.session_state['user']
            if 'user_id' in st.session_state:
                del st.session_state['user_id']
            st.experimental_rerun()


def login_page():
    """Render the main login / signup page centered in the app.

    On successful auth or signup this sets `st.session_state['user']` and `['user_id']` and reruns.
    """
    st.markdown("""
    <style>
    .login-box { max-width: 480px; margin: 40px auto; padding: 24px; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    </style>
    """, unsafe_allow_html=True)

    st.title("Million")
    st.caption("Sign in to continue")

    # Centered container
    col1, col2, col3 = st.columns([1, 2, 1])
    with col2:
        st.markdown('<div class="login-box">', unsafe_allow_html=True)
        mode = st.radio('', ['Sign in', 'Sign up'], index=0, horizontal=True)

        if mode == 'Sign in':
            with st.form('signin'):
                username = st.text_input('Username')
                password = st.text_input('Password', type='password')
                submitted = st.form_submit_button('Sign in', type='primary')
                if submitted:
                    uid = authenticate_user(username, password)
                    if uid:
                        st.session_state['user'] = username
                        st.session_state['user_id'] = int(uid)
                        st.toast(f'Welcome {username}', icon='🔐')
                        st.experimental_rerun()
                    else:
                        st.error('Invalid username or password')

        else:  # Sign up
            with st.form('signup'):
                username = st.text_input('Choose a username')
                password = st.text_input('Choose a password', type='password')
                submitted = st.form_submit_button('Create account', type='primary')
                if submitted:
                    try:
                        uid = create_user(username, password)
                        st.success('Account created — signing you in...')
                        st.session_state['user'] = username
                        st.session_state['user_id'] = int(uid)
                        st.experimental_rerun()
                    except Exception as e:
                        st.error(f'Registration error: {e}')

        st.markdown('</div>', unsafe_allow_html=True)
