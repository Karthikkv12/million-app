import streamlit as st
import plotly.express as px
import pandas as pd
from datetime import datetime
from frontend_client import save_trade, delete_trade
from ui.utils import canonical_action, canonical_instrument


def trade_sidebar_form(TICKERS, TICKER_MAP):
    with st.sidebar.form("trade_form"):
        st.subheader("New Order")
        c1, c2 = st.columns(2)
        s_sym = c1.selectbox(
            "Ticker",
            options=TICKERS,
            format_func=lambda x: f"{x} - {TICKER_MAP.get(x, '')}"
        )
        s_act = c2.selectbox("Type", ["Buy", "Sell"])
        s_strat = st.selectbox("Strategy", ["Day Trade", "Swing Trade", "Buy & Hold"])
        c3, c4 = st.columns(2)
        s_qty = c3.number_input("Shares", min_value=1, max_value=100000, value=1)
        s_price = c4.number_input("Price ($)", min_value=0.01, value=100.0, step=0.01)
        s_date = st.date_input("Date", datetime.today())

        if st.form_submit_button("Submit Order", type="primary"):
            if 'user' not in st.session_state:
                st.error('Please sign in to submit orders')
            else:
                inst = canonical_instrument('Stock')
                act = canonical_action(s_act)
                token = st.session_state.get('token')
                if not token:
                    st.error('Missing session token. Please sign in again.')
                else:
                    save_trade(token, s_sym, inst, s_strat, act, s_qty, s_price, s_date)
                st.toast(f"Executed: {s_sym}", icon="✅")
                st.cache_data.clear()
                st.rerun()


def render_trades_tab(trades_df):
    if trades_df.empty:
        st.info("No trades executed yet.")
        return

    trades_df['market_value'] = trades_df['entry_price'] * trades_df['quantity']
    df_chart = trades_df.sort_values('entry_date')
    df_chart['cumulative_value'] = df_chart['market_value'].cumsum()

    c_title, c_toggle = st.columns([2, 1])
    c_title.subheader("Portfolio Performance")
    range_opt = c_toggle.radio("Time Range", ["1W", "1M", "6M", "1Y", "All"], index=4, horizontal=True, label_visibility="collapsed")

    if range_opt != "All":
        cutoff = datetime.now()
        if range_opt == "1W": cutoff -= pd.Timedelta(weeks=1)
        elif range_opt == "1M": cutoff -= pd.Timedelta(days=30)
        elif range_opt == "6M": cutoff -= pd.Timedelta(days=180)
        elif range_opt == "1Y": cutoff -= pd.Timedelta(days=365)
        df_display = df_chart[df_chart['entry_date'] >= cutoff]
    else:
        df_display = df_chart

    if not df_display.empty:
        fig = px.area(df_display, x='entry_date', y='cumulative_value', template="plotly_white")
        fig.update_traces(line_color='#00c805', fillcolor='rgba(0, 200, 5, 0.1)')
        fig.update_layout(margin=dict(l=0, r=0, t=10, b=0), yaxis_title=None, xaxis_title=None)
        st.plotly_chart(fig, use_container_width=True)
    else:
        st.caption(f"No trade data available for the last {range_opt}.")

    st.subheader("Trade Journal")
    if 'sort_col' not in st.session_state: st.session_state.sort_col = 'entry_date'
    if 'sort_asc' not in st.session_state: st.session_state.sort_asc = False

    header_map = {"Date": "entry_date", "Ticker": "symbol", "Type": "action", "Strategy": "strategy", "Qty": "quantity", "Price": "entry_price"}
    cols = st.columns([1.5, 1, 1, 1.5, 1, 1, 1])
    for col, (display, db_col) in zip(cols[:-1], header_map.items()):
        arrow = ""
        if st.session_state.sort_col == db_col:
            arrow = " ▲" if st.session_state.sort_asc else " ▼"
        if col.button(f"{display}{arrow}", key=f"btn_sort_{db_col}", use_container_width=True, type="secondary"):
            if st.session_state.sort_col == db_col:
                st.session_state.sort_asc = not st.session_state.sort_asc
            else:
                st.session_state.sort_col = db_col
                st.session_state.sort_asc = True
            st.rerun()

    cols[-1].markdown("<div style='text-align: center; font-weight: 800; color: #00c805; padding-top: 8px;'>Action</div>", unsafe_allow_html=True)
    df_sorted = trades_df.sort_values(by=st.session_state.sort_col, ascending=st.session_state.sort_asc)

    for i, row in df_sorted.iterrows():
        c1, c2, c3, c4, c5, c6, c7 = st.columns([1.5, 1, 1, 1.5, 1, 1, 1])
        c1.date_input("D", row['entry_date'], key=f"d_{row['id']}", label_visibility="collapsed")
        c2.text_input("T", row['symbol'], key=f"t_{row['id']}", label_visibility="collapsed")
        c3.selectbox("S", ["BUY", "SELL"], index=0 if row['action']=="BUY" else 1, key=f"a_{row['id']}", label_visibility="collapsed")
        try: strat_idx = ["Day Trade", "Swing Trade", "Buy & Hold"].index(row['strategy'])
        except: strat_idx = 0
        c4.selectbox("St", ["Day Trade", "Swing Trade", "Buy & Hold"], index=strat_idx, key=f"st_{row['id']}", label_visibility="collapsed")
        c5.number_input("Q", value=int(row['quantity']), step=1, key=f"q_{row['id']}", label_visibility="collapsed")
        c6.number_input("P", value=float(row['entry_price']), step=0.01, key=f"p_{row['id']}", label_visibility="collapsed")
        if c7.button("Delete", key=f"del_{row['id']}", type="primary", use_container_width=True):
            if 'user' not in st.session_state:
                st.error('Sign in to delete trades')
            else:
                token = st.session_state.get('token')
                if not token:
                    st.error('Missing session token. Please sign in again.')
                else:
                    delete_trade(token, row['id'])
            st.toast(f"Deleted {row['symbol']}", icon="🗑")
            st.cache_data.clear()
            st.rerun()
