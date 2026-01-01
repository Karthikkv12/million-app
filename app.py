import ssl
try:
    ssl._create_default_https_context = ssl._create_unverified_context
except AttributeError:
    pass

import streamlit as st
import pandas as pd
import plotly.express as px
from datetime import datetime
from urllib.parse import quote
from ui.auth import (
    ensure_canonical_host,
    restore_auth_from_cookie,
    ensure_fresh_token,
    logout_and_rerun,
    login_page,
)
from ui.settings import render_settings_page
from ui.accounts import render_accounts_and_holdings_section
from ui.orders import render_orders_section
from ui.trades import trade_sidebar_form, render_live_positions, render_profit_and_loss_page
from ui.budget import budget_entry_form
from ui.search import render_stock_page
from ui.utils import canonical_action, canonical_instrument, canonical_budget_type
from frontend_client import load_data as api_load_data, update_trade as api_update_trade, get_cash_balance as api_get_cash_balance


def _get_query_param(name: str) -> str | None:
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


def _set_query_param(name: str, value: str) -> None:
    try:
        qp = st.query_params  # type: ignore[attr-defined]
        qp[name] = value
    except Exception:
        # Older API: must set all query params at once.
        try:
            qp = st.experimental_get_query_params()
            qp[name] = [value]
            flat = {k: (v[0] if isinstance(v, list) and v else v) for k, v in qp.items()}
            st.experimental_set_query_params(**flat)
        except Exception:
            pass

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

    /* Top bar (shared) */
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
        justify-content: space-between;
        padding: 0 16px;
        box-sizing: border-box;
    }
    .top-band .brand {
        font-size: 22px;
        font-weight: 800;
        color: #00c805;
        line-height: 1;
    }
    .top-band a.brand { text-decoration: none; }
    .top-band .nav a {
        color: #fff;
        font-weight: 800;
        text-decoration: none;
        margin-left: 16px;
    }
    .top-band .nav a:hover { color: #00c805; }
    .stApp { padding-top: 50px; }
    
    /* Hide Streamlit sidebar (all navigation happens in the top band + pages) */
    [data-testid="stSidebar"],
    [data-testid="stSidebarCollapseButton"] {
        display: none !important;
    }

    /* Dark mode: make everything black and keep sidebar text readable */
    @media (prefers-color-scheme: dark) {
        .stApp { background: #000 !important; }
        [data-testid="stAppViewContainer"],
        [data-testid="stMain"],
        [data-testid="stHeader"],
        [data-testid="stToolbar"] {
            background: #000 !important;
        }

        [data-testid="stSidebar"],
        [data-testid="stSidebarContent"],
        div[data-testid="stSidebarUserContent"] {
            background: #000 !important;
            border-right: none !important;
        }

        /* Ensure sidebar text is visible */
        [data-testid="stSidebar"] * { color: #fff !important; }

        /* Inputs/Selects: keep readable on black */
        .stTextInput input, .stNumberInput input, .stDateInput input,
        .stSelectbox div[data-baseweb="select"] > div {
            color: #fff !important;
            border-color: rgba(255,255,255,0.18) !important;
        }
    }
    
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
# Normalize hostname (localhost vs 127.0.0.1) so auth cookies match across refresh.
ensure_canonical_host()

# Restore auth state after browser refresh (Streamlit resets session_state on refresh)
restore_auth_from_cookie()

# Query-param logout action (used by the top-band Logout link)
if (_get_query_param("action") or "").lower() == "logout":
    logout_and_rerun()
    st.stop()

# If not signed in, show the login page (blocking). After login the page will rerun.
if 'user' not in st.session_state:
    login_page()
    st.stop()

# Fixed top bar (brand routes to Main, nav on the right)
_sid = _get_query_param("sid")
_sid_q = f"sid={quote(_sid)}&" if _sid else ""
_home_href = f"?{_sid_q}page=main"
_investment_href = f"?{_sid_q}page=investment"
_budget_href = f"?{_sid_q}page=budget"
_settings_href = f"?{_sid_q}page=settings"
_logout_href = f"?{_sid_q}action=logout"
st.markdown(
    (
        '<div class="top-band">'
        f'<a class="brand" href="{_home_href}" target="_self">Million</a>'
        '<div class="nav">'
        f'<a href="{_investment_href}" target="_self">Investment</a>'
        f'<a href="{_budget_href}" target="_self">Budget &amp; Cash Flow</a>'
        f'<a href="{_settings_href}" target="_self">Settings</a>'
        f'<a href="{_logout_href}" target="_self">Logout</a>'
        '</div>'
        '</div>'
    ),
    unsafe_allow_html=True,
)

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

# Best-effort: refresh access token if nearing expiry.
ensure_fresh_token(min_ttl_seconds=60)
token = st.session_state.get('token')

if not token:
    login_page()
    st.stop()

trades_df, cash_df, budget_df = api_load_data(token)

portfolio_val = 0.0; total_trades = 0
if not trades_df.empty:
    invested = (trades_df['entry_price'] * trades_df['quantity']).sum()
    portfolio_val = invested * 1.10
    total_trades = len(trades_df)

cash_balance = api_get_cash_balance(token, currency="USD")

other_assets = 0.0
if not budget_df.empty:
    budget_df['safe_type'] = budget_df['type'].astype(str).str.upper()
    assets = budget_df[budget_df['safe_type'].str.contains("ASSET")]['amount'].sum()
    income = budget_df[budget_df['safe_type'].str.contains("INCOME")]['amount'].sum()
    expense = budget_df[budget_df['safe_type'].str.contains("EXPENSE")]['amount'].sum()
    other_assets = assets + (income - expense)

total_nw = portfolio_val + cash_balance + other_assets

page = (_get_query_param("page") or "main").lower()
if page not in {"main", "investment", "stock", "budget", "settings", "pnl"}:
    page = "main"

if page == "main":
    st.markdown(
        f"<h1 style='font-size: 80px; font-weight: 800; margin-top: -20px;'>${total_nw:,.2f}</h1>",
        unsafe_allow_html=True,
    )
    st.caption(f"Total Net Worth • Updated {datetime.now().strftime('%H:%M')}")
    c1, c2, c3 = st.columns(3)
    c1.metric("Investing", f"${portfolio_val:,.2f}", f"{total_trades} Positions")
    c2.metric("Buying Power", f"${cash_balance:,.2f}", "Cash Available")
    c3.metric("Other Assets", f"${other_assets:,.2f}", "Real Estate / Savings")

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

if page == "investment":
    trade_sidebar_form(TICKERS, TICKER_MAP)
    st.divider()
    render_live_positions(trades_df)
    st.divider()
    render_accounts_and_holdings_section(title="Holdings")
    st.divider()
    render_orders_section(tickers=TICKERS, ticker_map=TICKER_MAP)
    st.divider()
    _pnl_href = f"?{_sid_q}page=pnl"
    st.markdown(
        f"""<h3 style="margin: 0;">Profit &amp; Loss <a href="{_pnl_href}" target="_self" style="text-decoration:none;">&gt;</a></h3>""",
        unsafe_allow_html=True,
    )
elif page == "stock":
    sym = _get_query_param("symbol") or ""
    render_stock_page(symbol=str(sym), ticker_map=TICKER_MAP)
elif page == "pnl":
    render_profit_and_loss_page(trades_df)
elif page == "budget":
    budget_entry_form(budget_df)
elif page == "settings":
    render_settings_page()