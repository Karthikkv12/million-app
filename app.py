import ssl
try:
    ssl._create_default_https_context = ssl._create_unverified_context
except AttributeError:
    pass

import streamlit as st
import pandas as pd
import plotly.express as px
from datetime import datetime
from ui.auth import sidebar_auth, login_page
from ui.trades import trade_sidebar_form, render_trades_tab
from ui.budget import budget_entry_form
from ui.utils import canonical_action, canonical_instrument, canonical_budget_type
from frontend_client import load_data as api_load_data, update_trade as api_update_trade

# --- CONSTANTS ---
@st.cache_data(ttl=24*3600)
def get_ticker_details():
    try:
        # Fetch the "Full" JSONs (contains Symbol AND Name)
        url_nasdaq = "https://raw.githubusercontent.com/rreichel3/US-Stock-Symbols/main/nasdaq/nasdaq_full_tickers.json"
        url_nyse = "https://raw.githubusercontent.com/rreichel3/US-Stock-Symbols/main/nyse/nyse_full_tickers.json"
        
        # Load as DataFrames
        df_nasdaq = pd.read_json(url_nasdaq)
        df_nyse = pd.read_json(url_nyse)
        
        # Combine
        df_all = pd.concat([df_nasdaq, df_nyse])
        
        # Create a dictionary: {"AAPL": "Apple Inc.", "MSFT": "Microsoft Corp..."}
        # We zip them together to create a fast lookup map
        ticker_map = dict(zip(df_all['symbol'], df_all['name']))
        
        # Create the list of keys (symbols) sorted
        ticker_list = sorted(ticker_map.keys())
        
        # Move popular stocks to the top for convenience
        priority = ['NVDA', 'AAPL', 'TSLA', 'AMD', 'MSFT', 'AMZN', 'GOOGL', 'SPY', 'QQQ']
        for p in reversed(priority):
            if p in ticker_list:
                ticker_list.insert(0, ticker_list.pop(ticker_list.index(p)))
                
        return ticker_list, ticker_map

    except Exception as e:
        print(f"Error: {e}")
        # Fallback if download fails
        defaults = ["NVDA", "AAPL", "TSLA", "AMD", "MSFT"]
        default_map = {k: k for k in defaults} # No names in fallback
        return defaults, default_map

# Load Data (Returns two values: the List and the Dictionary)
TICKERS, TICKER_MAP = get_ticker_details()



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
# If not signed in, show the login page (blocking). After login the page will rerun.
if 'user' not in st.session_state:
    login_page()
    st.stop()

# Render sidebar title and authentication controls (shows signed-in state + logout)
st.sidebar.title("Million")
sidebar_auth()

# Menu selection for UI
mode = st.sidebar.selectbox("Menu", ["Trade", "Transactions"], label_visibility="collapsed")

if mode == "Trade":
    # trade form moved to ui.trades
    trade_sidebar_form(TICKERS, TICKER_MAP)

# --- MAIN DASHBOARD LOGIC ---
token = st.session_state.get('token')
if not token:
    # If user is somehow set without a token, force login page.
    if 'user' in st.session_state:
        del st.session_state['user']
    if 'user_id' in st.session_state:
        del st.session_state['user_id']
    login_page()
    st.stop()

trades_df, cash_df, budget_df = api_load_data(token)

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
    if 'user' not in st.session_state:
        st.error('Sign in to edit trades')
        return
    new_val = st.session_state[key]
    trades, _, _ = api_load_data(token)
    row = trades[trades['id'] == trade_id].iloc[0]
    data = {'symbol': row['symbol'], 'strategy': row['strategy'], 'action': row['action'], 'qty': row['quantity'], 'price': row['entry_price'], 'date': row['entry_date']}
    if field == 'symbol': data['symbol'] = new_val
    elif field == 'action': data['action'] = new_val
    elif field == 'strategy': data['strategy'] = new_val
    elif field == 'qty': data['qty'] = new_val
    elif field == 'price': data['price'] = new_val
    elif field == 'date': data['date'] = new_val
    # canonicalize action and symbol before calling update_trade
    data['symbol'] = str(data['symbol']).upper()
    data['action'] = canonical_action(data['action'])
    api_update_trade(token, trade_id, data['symbol'], data['strategy'], data['action'], data['qty'], data['price'], data['date'])
    st.toast(f"Updated {field}!", icon="💾")


# (canonical helpers moved to `ui.utils`)

tab1, tab2 = st.tabs(["Investing", "Budget & Cash Flow"])

with tab1:
    # Render trading tab from ui.trades
    render_trades_tab(trades_df)

with tab2:
    # Render budget entry & analysis from ui.budget
    budget_entry_form(budget_df)