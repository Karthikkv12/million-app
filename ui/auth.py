import streamlit as st
from logic.services import create_user, authenticate_user

def sidebar_auth():
    """Render sidebar auth controls. Sets `st.session_state['user']` and `['user_id']` on success."""
    if 'user' not in st.session_state:
        with st.sidebar.form('login_form'):
            st.subheader('Sign in')
            _lu = st.text_input('Username')
            _lp = st.text_input('Password', type='password')
            _reg = st.checkbox('Register new account')
            if st.form_submit_button('Submit'):
                if _reg:
                    try:
                        create_user(_lu, _lp)
                        st.success('Account created — you can now sign in')
                    except Exception as e:
                        st.error(f'Registration error: {e}')
                else:
                    uid = authenticate_user(_lu, _lp)
                    if uid:
                        st.session_state['user'] = _lu
                        st.session_state['user_id'] = int(uid)
                        st.toast(f'Welcome {_lu}', icon='🔐')
                        st.experimental_rerun()
                    else:
                        st.error('Invalid credentials')
    else:
        st.sidebar.markdown(f"**Signed in:** {st.session_state['user']}")
        if st.sidebar.button('Logout'):
            del st.session_state['user']
            if 'user_id' in st.session_state:
                del st.session_state['user_id']
            st.experimental_rerun()
