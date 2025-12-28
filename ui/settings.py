import streamlit as st

from ui.auth import render_security_section


def render_settings_page() -> None:
    st.header("Settings")
    st.caption("Security and account preferences live here.")
    render_security_section()
