import streamlit as st
import pandas as pd
import plotly.express as px
from datetime import datetime
from database.models import init_db
from logic.services import save_trade, save_cash, save_budget, load_data, delete_trade, update_trade

st.set_page_config(page_title="Million", layout="wide", page_icon="💸", initial_sidebar_state="expanded")
init_db()

# --- CSS STYLING ---
st.markdown("""
    <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap');
    html, body, [class*="css"] { font-family: 'Inter', sans-serif; }
    
    /* Sidebar Styles */
    [data-testid="stSidebar"] { background-color: #f5f8fa; min-width: 350px !important; max-width: 350px !important; border-right: 1px solid #e0e0e0; }
    [data-testid="stSidebarCollapseButton"] { display: none; }
    div[data-testid="stSidebarUserContent"] { padding-top: 2rem; }
    [data-testid="stSidebar"] h1 { color: #00c805 !important; font-size: 3.5rem !important; margin-bottom: 20px; }
    
    /* INPUT FIELDS (Clean Look) */
    .stTextInput input, .stNumberInput input, .stDateInput input, .stSelectbox div[data-baseweb="select"] > div { 
        background-color: transparent !important; border: 1px solid #f0f2f6; 
    }
    .stTextInput input:focus, .stNumberInput input:focus { 
        border-color: #00c805 !important; box-shadow: none !important; 
    }

    /* --- BUTTON STYLES --- */
    
    /* Primary Button (Use for: Delete, Submit, Transfer) -> Green Background, White Text */
    button[kind="primary"] { 
        background-color: #00c805 !important; 
        color: white !important; 
        border: none !important; 
        border-radius: 8px !important; 
        font-weight: 700 !important; 
        transition: 0.2s;
    }
    button[kind="primary"]:hover { 
        background-color: #00a804 !important; 
    }

    /* Secondary Button (Use for: Sort Headers) -> Transparent, No Border, Green Text */
    button[kind="secondary"] { 
        background-color: transparent !important; 
        color: #00c805 !important; 
        border: none !important; 
        font-weight: 800 !important; 
        box-shadow: none !important;
        padding: 0px !important;
    }
    button[kind="secondary"]:hover { 
        color: #008f03 !important; 
        background-color: transparent !important;
    }
    button[kind="secondary"]:focus { 
        color: #00c805 !important; 
        border-color: transparent !important; 
        box-shadow: none !important;
    }

    /* Grid Alignment */
    div[data-testid="column"] { vertical-align: middle; }
    div[data-testid="stMetricValue"] { font-size: 28px; font-weight: 800; }
    </style>
""", unsafe_allow_html=True)

# --- SIDEBAR LOGIC ---
st.sidebar.title("Million")
mode = st.sidebar.selectbox("Menu", ["Trade", "Transactions"], label_visibility="collapsed")

if mode == "Trade":
    with st.sidebar.form("trade_form"):
        st.subheader("New Order")
        c1, c2 = st.columns(2)
        s_sym = c1.text_input("Ticker", "NVDA").upper()
        
        # CHANGED: "Side" -> "Type"
        s_act = c2.selectbox("Type", ["Buy", "Sell"])
        
        s_strat = st.selectbox("Strategy", ["Day Trade", "Swing Trade", "Buy & Hold"])
        s_qty = st.number_input("Shares", 1, 10000)
        s_price = st.number_input("Price ($)", 0.01)
        s_date = st.date_input("Date", datetime.today())
        
        if st.form_submit_button("Submit Order", type="primary"):
            save_trade(s_sym, "Stock", s_strat, s_act, s_qty, s_price, s_date)
            st.toast(f"Executed: {s_sym}", icon="✅")
            st.cache_data.clear()
            st.rerun()

elif mode == "Transactions":
    with st.sidebar.form("cash_form"):
        st.subheader("Transfer Funds")
        c_act = st.selectbox("Type", ["Deposit", "Withdraw"])
        c_amt = st.number_input("Amount ($)", 100.0)
        c_date = st.date_input("Date", datetime.today())
        c_note = st.text_input("Memo")
        
        if st.form_submit_button("Initiate Transfer", type="primary"):
            save_cash(c_act, c_amt, c_date, c_note)
            st.toast("Transfer Complete", icon="💸")
            st.cache_data.clear()
            st.rerun()

# --- MAIN DASHBOARD LOGIC ---
trades_df, cash_df, budget_df = load_data()

portfolio_val = 0.0; total_trades = 0
if not trades_df.empty:
    invested = (trades_df['entry_price'] * trades_df['quantity']).sum()
    portfolio_val = invested * 1.10
    total_trades = len(trades_df)

cash_balance = 0.0
if not cash_df.empty:
    deps = cash_df[cash_df['action'].astype(str).str.contains("DEPOSIT", case=False)]['amount'].sum()
    withs = cash_df[cash_df['action'].astype(str).str.contains("WITHDRAW", case=False)]['amount'].sum()
    cash_balance = deps - withs

other_assets = 0.0
if not budget_df.empty:
    budget_df['safe_type'] = budget_df['type'].astype(str).str.upper()
    assets = budget_df[budget_df['safe_type'].str.contains("ASSET")]['amount'].sum()
    income = budget_df[budget_df['safe_type'].str.contains("INCOME")]['amount'].sum()
    expense = budget_df[budget_df['safe_type'].str.contains("EXPENSE")]['amount'].sum()
    other_assets = assets + (income - expense)

total_nw = portfolio_val + cash_balance + other_assets

st.markdown(f"<h1 style='font-size: 80px; font-weight: 800; margin-top: -20px;'>${total_nw:,.2f}</h1>", unsafe_allow_html=True)
st.caption(f"Total Net Worth • Updated {datetime.now().strftime('%H:%M')}")
c1, c2, c3 = st.columns(3)
c1.metric("Investing", f"${portfolio_val:,.2f}", f"{total_trades} Positions")
c2.metric("Buying Power", f"${cash_balance:,.2f}", "Cash Available")
c3.metric("Other Assets", f"${other_assets:,.2f}", "Real Estate / Savings")
st.markdown("---")

def on_grid_change(key, trade_id, field):
    new_val = st.session_state[key]
    trades, _, _ = load_data()
    row = trades[trades['id'] == trade_id].iloc[0]
    data = {'symbol': row['symbol'], 'strategy': row['strategy'], 'action': row['action'], 'qty': row['quantity'], 'price': row['entry_price'], 'date': row['entry_date']}
    if field == 'symbol': data['symbol'] = new_val
    elif field == 'action': data['action'] = new_val
    elif field == 'strategy': data['strategy'] = new_val
    elif field == 'qty': data['qty'] = new_val
    elif field == 'price': data['price'] = new_val
    elif field == 'date': data['date'] = new_val
    update_trade(trade_id, data['symbol'], data['strategy'], data['action'], data['qty'], data['price'], data['date'])
    st.toast(f"Updated {field}!", icon="💾")

tab1, tab2 = st.tabs(["Investing", "Budget & Cash Flow"])

# --- TAB 1: INVESTING (SORTABLE GRID) ---
# --- TAB 1: INVESTING (SORTABLE GRID + CHART TOGGLE) ---
with tab1:
    if not trades_df.empty:
        # --- 1. Portfolio Performance Chart ---
        # Calculate Cumulative Value on ALL data first (to keep history correct)
        trades_df['market_value'] = trades_df['entry_price'] * trades_df['quantity']
        df_chart = trades_df.sort_values('entry_date')
        df_chart['cumulative_value'] = df_chart['market_value'].cumsum()

        # Layout: Title on left, Toggle on right
        c_title, c_toggle = st.columns([2, 1])
        c_title.subheader("Portfolio Performance")
        
        # Time Range Toggle
        range_opt = c_toggle.radio(
            "Time Range", 
            ["1W", "1M", "6M", "1Y", "All"], 
            index=4, 
            horizontal=True, 
            label_visibility="collapsed"
        )

        # Filter Data for Display (Cutoff Logic)
        if range_opt != "All":
            cutoff = datetime.now()
            if range_opt == "1W": cutoff -= pd.Timedelta(weeks=1)
            elif range_opt == "1M": cutoff -= pd.Timedelta(days=30)
            elif range_opt == "6M": cutoff -= pd.Timedelta(days=180)
            elif range_opt == "1Y": cutoff -= pd.Timedelta(days=365)
            df_display = df_chart[df_chart['entry_date'] >= cutoff]
        else:
            df_display = df_chart

        # Render Chart
        if not df_display.empty:
            fig = px.area(df_display, x='entry_date', y='cumulative_value', template="plotly_white")
            fig.update_traces(line_color='#00c805', fillcolor='rgba(0, 200, 5, 0.1)')
            fig.update_layout(margin=dict(l=0, r=0, t=10, b=0), yaxis_title=None, xaxis_title=None)
            st.plotly_chart(fig, use_container_width=True)
        else:
            st.caption(f"No trade data available for the last {range_opt}.")

        # --- 2. Trade Journal Grid ---
        st.subheader("Trade Journal")

        # Initialize Sort State
        if 'sort_col' not in st.session_state: st.session_state.sort_col = 'entry_date'
        if 'sort_asc' not in st.session_state: st.session_state.sort_asc = False

        # Header Mapping (Display Name : DataFrame Column)
        header_map = {
            "Date": "entry_date", "Ticker": "symbol", "Type": "action", 
            "Strategy": "strategy", "Qty": "quantity", "Price": "entry_price"
        }
        
        # Render Sortable Headers (Secondary/Transparent Buttons)
        cols = st.columns([1.5, 1, 1, 1.5, 1, 1, 1])
        
        for col, (display, db_col) in zip(cols[:-1], header_map.items()):
            arrow = ""
            if st.session_state.sort_col == db_col:
                arrow = " ▲" if st.session_state.sort_asc else " ▼"
            
            # Type="secondary" -> Transparent, Text only
            if col.button(f"{display}{arrow}", key=f"btn_sort_{db_col}", use_container_width=True, type="secondary"):
                if st.session_state.sort_col == db_col:
                    st.session_state.sort_asc = not st.session_state.sort_asc
                else:
                    st.session_state.sort_col = db_col
                    st.session_state.sort_asc = True
                st.rerun()

        # Delete Label (Static)
        cols[-1].markdown("<div style='text-align: center; font-weight: 800; color: #00c805; padding-top: 8px;'>Action</div>", unsafe_allow_html=True)

        # Sort Data
        df_sorted = trades_df.sort_values(by=st.session_state.sort_col, ascending=st.session_state.sort_asc)

        # Render Rows
        for i, row in df_sorted.iterrows():
            c1, c2, c3, c4, c5, c6, c7 = st.columns([1.5, 1, 1, 1.5, 1, 1, 1])
            c1.date_input("D", row['entry_date'], key=f"d_{row['id']}", label_visibility="collapsed", on_change=on_grid_change, args=(f"d_{row['id']}", row['id'], 'date'))
            c2.text_input("T", row['symbol'], key=f"t_{row['id']}", label_visibility="collapsed", on_change=on_grid_change, args=(f"t_{row['id']}", row['id'], 'symbol'))
            c3.selectbox("S", ["BUY", "SELL"], index=0 if row['action']=="BUY" else 1, key=f"a_{row['id']}", label_visibility="collapsed", on_change=on_grid_change, args=(f"a_{row['id']}", row['id'], 'action'))
            
            strat_opts = ["Day Trade", "Swing Trade", "Buy & Hold"]
            try: strat_idx = strat_opts.index(row['strategy'])
            except: strat_idx = 0
            c4.selectbox("St", strat_opts, index=strat_idx, key=f"st_{row['id']}", label_visibility="collapsed", on_change=on_grid_change, args=(f"st_{row['id']}", row['id'], 'strategy'))
            
            c5.number_input("Q", value=int(row['quantity']), step=1, key=f"q_{row['id']}", label_visibility="collapsed", on_change=on_grid_change, args=(f"q_{row['id']}", row['id'], 'qty'))
            c6.number_input("P", value=float(row['entry_price']), step=0.01, key=f"p_{row['id']}", label_visibility="collapsed", on_change=on_grid_change, args=(f"p_{row['id']}", row['id'], 'price'))
            
            # Primary Green Button for Delete
            if c7.button("Delete", key=f"del_{row['id']}", type="primary", use_container_width=True):
                delete_trade(row['id'])
                st.toast(f"Deleted {row['symbol']}", icon="🗑")
                st.cache_data.clear()
                st.rerun()
    else:
        st.info("No trades executed yet.")

# --- TAB 2: BUDGET & CASH FLOW ---
with tab2:
    col_entry, col_view = st.columns([1, 2], gap="large")
    with col_entry:
        st.subheader("New Entry")
        with st.form("budget_form"):
            b_type = st.selectbox("Type", ["Expense", "Income", "Asset"])
            b_cat = st.text_input("Category", "General"); b_amt = st.number_input("Amount ($)", 0.01)
            b_date = st.date_input("Date", datetime.today()); b_desc = st.text_input("Description")
            
            if st.form_submit_button("Save Record", type="primary"):
                save_budget(b_cat, b_type, b_amt, b_date, b_desc)
                st.toast("Saved!", icon="💾")
                st.cache_data.clear()
                st.rerun()
    with col_view:
        st.subheader("Analysis")
        if not budget_df.empty:
            budget_df['safe_type'] = budget_df['type'].astype(str).str.upper()
            expenses = budget_df[budget_df['safe_type'].str.contains("EXPENSE")]
            if not expenses.empty:
                pie_data = expenses.groupby('category')['amount'].sum().reset_index()
                c_chart, c_stats = st.columns([1, 1])
                with c_chart:
                    fig_pie = px.pie(pie_data, values='amount', names='category', title="Expense Breakdown", hole=0.4, color_discrete_sequence=px.colors.qualitative.Pastel)
                    fig_pie.update_layout(showlegend=False, margin=dict(l=0, r=0, t=30, b=0))
                    st.plotly_chart(fig_pie, use_container_width=True)
                with c_stats:
                    st.metric("Total Expenses", f"${expenses['amount'].sum():,.2f}")
                    st.dataframe(expenses[['date', 'category', 'amount']].sort_values('date', ascending=False), use_container_width=True, height=200)
            else: st.info("No expenses recorded yet.")
        else: st.info("No budget data available.")