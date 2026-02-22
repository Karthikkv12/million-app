import ssl
try:
    ssl._create_default_https_context = ssl._create_unverified_context
except AttributeError:
    pass

import streamlit as st

st.set_page_config(
    page_title="OptionFlow",
    page_icon="📈",
    layout="wide",
    initial_sidebar_state="collapsed",
)

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from datetime import datetime, timedelta
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
from ui.gamma_exposure import render_gamma_exposure_page
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
        url_nasdaq = "https://raw.githubusercontent.com/rreichel3/US-Stock-Symbols/main/nasdaq/nasdaq_full_tickers.json"
        url_nyse = "https://raw.githubusercontent.com/rreichel3/US-Stock-Symbols/main/nyse/nyse_full_tickers.json"
        df_nasdaq = pd.read_json(url_nasdaq)
        df_nyse = pd.read_json(url_nyse)
        df_all = pd.concat([df_nasdaq, df_nyse])
        ticker_map = dict(zip(df_all['symbol'], df_all['name']))
        ticker_list = sorted(ticker_map.keys())
        priority = ['NVDA', 'AAPL', 'TSLA', 'AMD', 'MSFT', 'AMZN', 'GOOGL', 'SPY', 'QQQ']
        for p in reversed(priority):
            if p in ticker_list:
                ticker_list.insert(0, ticker_list.pop(ticker_list.index(p)))
        return ticker_list, ticker_map
    except Exception as e:
        defaults = ["NVDA", "AAPL", "TSLA", "AMD", "MSFT"]
        return defaults, {k: k for k in defaults}

TICKERS, TICKER_MAP = get_ticker_details()

# ── GLOBAL STYLES ─────────────────────────────────────────────────────────────
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

/* ── CSS variables — light mode defaults ────────────────────────────────── */
:root {
    --bg:          #f5f5f5;
    --bg2:         #ffffff;
    --card-bg:     #ffffff;
    --card-border: #e8e8e8;
    --text:        #111111;
    --text-muted:  #666666;
    --text-sub:    #999999;
    --nav-bg:      #ffffff;
    --nav-border:  #e8e8e8;
    --nav-link:    #555555;
    --nav-active:  #111111;
    --nav-active-bg: #f0f0f0;
    --input-bg:    #ffffff;
    --input-border:#d0d0d0;
    --input-text:  #111111;
    --divider:     #ececec;
    --tile-hover:  #f0fff0;
    --metric-val:  #111111;
    --metric-lbl:  #888888;
}

/* ── Dark mode overrides ────────────────────────────────────────────────── */
@media (prefers-color-scheme: dark) {
    :root {
        --bg:          #0d0d0d;
        --bg2:         #111111;
        --card-bg:     #161616;
        --card-border: #2a2a2a;
        --text:        #e0e0e0;
        --text-muted:  #888888;
        --text-sub:    #555555;
        --nav-bg:      #111111;
        --nav-border:  #222222;
        --nav-link:    #888888;
        --nav-active:  #ffffff;
        --nav-active-bg: #1e1e1e;
        --input-bg:    #1e1e1e;
        --input-border:#3a3a3a;
        --input-text:  #e0e0e0;
        --divider:     #1e1e1e;
        --tile-hover:  #0f1f0f;
        --metric-val:  #ffffff;
        --metric-lbl:  #aaaaaa;
    }
}

html, body, [class*="css"] {
    font-family: 'Inter', sans-serif;
}

/* ── Page background ────────────────────────────────────────────────────── */
.stApp,
[data-testid="stAppViewContainer"],
[data-testid="stMain"],
section[data-testid="stMain"] > div:first-child {
    background: var(--bg) !important;
}
[data-testid="stMainBlockContainer"] {
    background: transparent !important;
    padding-top: 70px !important;
    max-width: 1400px !important;
}

/* ── All text inherits theme color ──────────────────────────────────────── */
p, span, div, label, h1, h2, h3, h4, h5, h6, li,
[data-testid="stMarkdownContainer"] *,
[data-testid="stText"] *,
[data-testid="stHeading"] *,
.stMarkdown p, .stMarkdown span, .stMarkdown li,
.stMarkdown h1, .stMarkdown h2, .stMarkdown h3,
[class*="stSelectbox"] label,
[class*="stTextInput"] label,
[class*="stNumberInput"] label,
[class*="stDateInput"] label,
[class*="stCheckbox"] label,
[class*="stRadio"] label,
[data-testid="stWidgetLabel"] * {
    color: var(--text) !important;
}
[data-testid="stCaption"] p,
[data-testid="stCaption"] span {
    color: var(--text-muted) !important;
}

/* ── Hide Streamlit chrome ──────────────────────────────────────────────── */
[data-testid="stSidebar"],
[data-testid="stSidebarCollapseButton"],
[data-testid="stHeader"],
[data-testid="stToolbar"],
footer { display: none !important; }

/* ── Top nav bar ────────────────────────────────────────────────────────── */
.topbar {
    position: fixed;
    top: 0; left: 0; right: 0;
    height: 56px;
    background: var(--nav-bg);
    border-bottom: 1px solid var(--nav-border);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 28px;
    box-sizing: border-box;
}
.topbar-brand {
    font-size: 20px;
    font-weight: 800;
    color: #00c805;
    text-decoration: none;
    letter-spacing: -0.5px;
}
.topbar-nav { display: flex; align-items: center; gap: 4px; }
.topbar-nav a {
    color: var(--nav-link);
    font-size: 13px;
    font-weight: 500;
    text-decoration: none;
    padding: 6px 12px;
    border-radius: 8px;
    transition: all 0.15s;
}
.topbar-nav a:hover { color: var(--nav-active); background: var(--nav-active-bg); }
.topbar-nav a.active { color: var(--nav-active); background: var(--nav-active-bg); font-weight: 600; }
.topbar-nav .nav-logout {
    color: var(--text-sub);
    margin-left: 8px;
    border: 1px solid var(--card-border);
}
.topbar-nav .nav-logout:hover { color: #ff4444; border-color: #ff4444; background: transparent; }
.topbar-user { font-size: 12px; color: var(--text-sub); font-weight: 500; }

/* ── Metric cards ───────────────────────────────────────────────────────── */
.metric-card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 14px;
    padding: 20px 24px;
}
.metric-card .label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-sub);
    text-transform: uppercase;
    letter-spacing: 0.8px;
    margin-bottom: 8px;
}
.metric-card .value {
    font-size: 28px;
    font-weight: 700;
    color: var(--metric-val);
    letter-spacing: -0.5px;
}
.metric-card .change { font-size: 13px; font-weight: 500; margin-top: 6px; }
.metric-card .change.pos { color: #00c805; }
.metric-card .change.neg { color: #ff4444; }
.metric-card .change.neu { color: var(--text-sub); }

/* ── Section headers ────────────────────────────────────────────────────── */
.section-header {
    font-size: 18px;
    font-weight: 700;
    color: var(--text);
    margin: 32px 0 16px;
    display: flex;
    align-items: center;
    gap: 10px;
}
.section-header a {
    font-size: 12px;
    font-weight: 500;
    color: #00c805;
    text-decoration: none;
    margin-left: auto;
}

/* ── Quick action tiles ─────────────────────────────────────────────────── */
.quick-tile {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 14px;
    padding: 20px;
    text-align: center;
    cursor: pointer;
    transition: all 0.15s;
    text-decoration: none;
    display: block;
}
.quick-tile:hover { border-color: #00c805; background: var(--tile-hover); }
.quick-tile .tile-icon { font-size: 28px; margin-bottom: 8px; }
.quick-tile .tile-label { font-size: 13px; font-weight: 600; color: var(--text); }
.quick-tile .tile-sub { font-size: 11px; color: var(--text-sub); margin-top: 3px; }

/* ── Table overrides ────────────────────────────────────────────────────── */
[data-testid="stDataFrame"] { border-radius: 12px; overflow: hidden; }

/* ── Buttons ────────────────────────────────────────────────────────────── */
button[kind="primary"] {
    background: #00c805 !important;
    color: #fff !important;
    border: none !important;
    border-radius: 8px !important;
    font-weight: 700 !important;
}
button[kind="primary"]:hover { background: #00a804 !important; }
button[kind="secondary"] {
    background: transparent !important;
    color: #00c805 !important;
    border: none !important;
    font-weight: 700 !important;
    box-shadow: none !important;
    padding: 0 !important;
}

/* ── Inputs ─────────────────────────────────────────────────────────────── */
.stTextInput input, .stNumberInput input, .stDateInput input,
.stSelectbox div[data-baseweb="select"] > div,
[data-baseweb="input"] input,
[data-baseweb="textarea"] textarea {
    background: var(--input-bg) !important;
    border: 1.5px solid var(--input-border) !important;
    border-radius: 8px !important;
    color: var(--input-text) !important;
    font-weight: 500 !important;
}
.stTextInput input::placeholder, .stNumberInput input::placeholder {
    color: var(--text-sub) !important;
}
.stTextInput input:focus, .stNumberInput input:focus,
[data-baseweb="input"] input:focus {
    border-color: #00c805 !important;
    box-shadow: 0 0 0 2px rgba(0,200,5,0.15) !important;
}
.stSelectbox div[data-baseweb="select"] span,
.stSelectbox div[data-baseweb="select"] div {
    color: var(--input-text) !important;
}

/* ── Metrics ────────────────────────────────────────────────────────────── */
div[data-testid="stMetricValue"] { font-size: 26px; font-weight: 700; color: var(--metric-val) !important; }
div[data-testid="stMetricLabel"] { font-size: 12px; color: var(--metric-lbl) !important; }
div[data-testid="stMetricLabel"] * { color: var(--metric-lbl) !important; }
div[data-testid="stMetricDelta"] { font-size: 13px; }

/* ── Divider ────────────────────────────────────────────────────────────── */
hr { border-color: var(--divider) !important; margin: 24px 0 !important; }
</style>
""", unsafe_allow_html=True)

# ── AUTH GATE ─────────────────────────────────────────────────────────────────
ensure_canonical_host()
restore_auth_from_cookie()

if (_get_query_param("action") or "").lower() == "logout":
    logout_and_rerun()
    st.stop()

if 'user' not in st.session_state:
    login_page()
    st.stop()

# ── NAV BAR ───────────────────────────────────────────────────────────────────
_sid = _get_query_param("sid")
_q = f"sid={quote(_sid)}&" if _sid else ""
page = (_get_query_param("page") or "home").lower()

def _href(p):
    return f"?{_q}page={p}"

def _nav_link(label, p):
    active = " active" if page == p else ""
    return f'<a href="{_href(p)}" target="_self" class="{active}">{label}</a>'

username = st.session_state.get("user", "")
st.markdown(
    f"""
    <div class="topbar">
        <a class="topbar-brand" href="{_href('home')}" target="_self">OptionFlow</a>
        <div class="topbar-nav">
            {_nav_link("Dashboard", "home")}
            {_nav_link("Portfolio", "investment")}
            {_nav_link("Options Flow", "gamma")}
            {_nav_link("P&amp;L", "pnl")}
            {_nav_link("Settings", "settings")}
            <a href="?{_q}action=logout" target="_self" class="nav-logout">Sign out</a>
        </div>
        <div class="topbar-user">👤 {username}</div>
    </div>
    """,
    unsafe_allow_html=True,
)

# ── TOKEN REFRESH ─────────────────────────────────────────────────────────────
token = st.session_state.get('token')
if not token:
    for k in ('user', 'user_id'):
        st.session_state.pop(k, None)
    login_page()
    st.stop()

ensure_fresh_token(min_ttl_seconds=60)
token = st.session_state.get('token')
if not token:
    login_page()
    st.stop()

# ── DATA LOAD ─────────────────────────────────────────────────────────────────
trades_df, cash_df, budget_df = api_load_data(token)
cash_balance = api_get_cash_balance(token, currency="USD")

# Portfolio calculations
portfolio_val = 0.0
total_trades = 0
open_positions = 0
if not trades_df.empty:
    invested = (trades_df['entry_price'] * trades_df['quantity']).sum()
    portfolio_val = invested * 1.10
    total_trades = len(trades_df)
    if 'is_closed' in trades_df.columns:
        open_positions = int((trades_df['is_closed'] == 0).sum())
    else:
        open_positions = total_trades

other_assets = 0.0
if not budget_df.empty:
    budget_df['safe_type'] = budget_df['type'].astype(str).str.upper()
    assets = budget_df[budget_df['safe_type'].str.contains("ASSET")]['amount'].sum()
    income = budget_df[budget_df['safe_type'].str.contains("INCOME")]['amount'].sum()
    expense = budget_df[budget_df['safe_type'].str.contains("EXPENSE")]['amount'].sum()
    other_assets = assets + (income - expense)

total_nw = portfolio_val + cash_balance + other_assets

# ── ROUTING ───────────────────────────────────────────────────────────────────
if page not in {"home", "investment", "stock", "budget", "settings", "pnl", "gamma"}:
    page = "home"

# ── HOME / DASHBOARD ──────────────────────────────────────────────────────────
if page == "home":
    now = datetime.now()
    hour = now.hour
    if hour < 12:
        greeting = "Good morning"
    elif hour < 17:
        greeting = "Good afternoon"
    else:
        greeting = "Good evening"

    st.markdown(
        f"<div style='font-size:13px;color:#555;margin-bottom:4px;'>{now.strftime('%A, %B %d %Y · %H:%M')}</div>"
        f"<div style='font-size:32px;font-weight:800;color:#fff;margin-bottom:32px;'>{greeting}, {username.title()} 👋</div>",
        unsafe_allow_html=True,
    )

    # ── Top KPI row ──────────────────────────────────────────────────────────
    k1, k2, k3, k4 = st.columns(4)

    with k1:
        st.markdown(f"""
        <div class="metric-card">
            <div class="label">Total Net Worth</div>
            <div class="value">${total_nw:,.0f}</div>
            <div class="change neu">↕ All assets combined</div>
        </div>""", unsafe_allow_html=True)

    with k2:
        st.markdown(f"""
        <div class="metric-card">
            <div class="label">Portfolio Value</div>
            <div class="value">${portfolio_val:,.0f}</div>
            <div class="change {'pos' if open_positions > 0 else 'neu'}">{open_positions} open position{'s' if open_positions != 1 else ''}</div>
        </div>""", unsafe_allow_html=True)

    with k3:
        st.markdown(f"""
        <div class="metric-card">
            <div class="label">Buying Power</div>
            <div class="value">${cash_balance:,.0f}</div>
            <div class="change neu">Cash available</div>
        </div>""", unsafe_allow_html=True)

    with k4:
        st.markdown(f"""
        <div class="metric-card">
            <div class="label">Other Assets</div>
            <div class="value">${other_assets:,.0f}</div>
            <div class="change neu">Real estate · savings</div>
        </div>""", unsafe_allow_html=True)

    st.markdown("<div style='height:32px'></div>", unsafe_allow_html=True)

    # ── Quick actions ─────────────────────────────────────────────────────────
    st.markdown('<div class="section-header">Quick Actions</div>', unsafe_allow_html=True)
    qa1, qa2, qa3, qa4, qa5 = st.columns(5)

    tiles = [
        (qa1, "📊", "Portfolio", "Positions & trades", "investment"),
        (qa2, "🌊", "Options Flow", "GEX & gamma analysis", "gamma"),
        (qa3, "📈", "P&L", "Profit & loss report", "pnl"),
        (qa4, "💰", "Budget", "Income & expenses", "budget"),
        (qa5, "⚙️", "Settings", "Account settings", "settings"),
    ]
    for col, icon, label, sub, target in tiles:
        with col:
            st.markdown(f"""
            <a href="{_href(target)}" target="_self" class="quick-tile">
                <div class="tile-icon">{icon}</div>
                <div class="tile-label">{label}</div>
                <div class="tile-sub">{sub}</div>
            </a>""", unsafe_allow_html=True)

    st.markdown("<div style='height:16px'></div>", unsafe_allow_html=True)

    # ── Portfolio snapshot + recent trades ────────────────────────────────────
    left_col, right_col = st.columns([2, 1])

    with left_col:
        st.markdown(
            f'<div class="section-header">Portfolio Snapshot'
            f'<a href="{_href("investment")}" target="_self">View all →</a></div>',
            unsafe_allow_html=True,
        )
        if trades_df.empty:
            st.markdown(
                "<div style='background:#161616;border:1px solid #222;border-radius:14px;"
                "padding:40px;text-align:center;color:#444;font-size:14px;'>"
                "No positions yet. <a href='?page=investment' style='color:#00c805'>Add your first trade →</a>"
                "</div>",
                unsafe_allow_html=True,
            )
        else:
            display_cols = ['symbol', 'quantity', 'entry_price']
            available = [c for c in display_cols if c in trades_df.columns]
            preview = trades_df[available].head(6).copy()
            if 'entry_price' in preview.columns:
                preview['entry_price'] = preview['entry_price'].apply(lambda x: f"${x:,.2f}")
            if 'quantity' in preview.columns:
                preview['quantity'] = preview['quantity'].apply(lambda x: f"{x:,.0f}")
            preview.columns = [c.replace('_', ' ').title() for c in preview.columns]
            st.dataframe(preview, use_container_width=True, hide_index=True)

    with right_col:
        st.markdown(
            '<div class="section-header">Market Hours</div>',
            unsafe_allow_html=True,
        )
        now_et_hour = (now + timedelta(hours=0)).hour  # adjust if needed
        market_open = 9 <= now.hour < 16
        market_status = "🟢 Market Open" if market_open else "🔴 Market Closed"
        pre_market = now.hour < 9
        after_hours = now.hour >= 16

        st.markdown(f"""
        <div class="metric-card" style="margin-bottom:12px;">
            <div class="label">NYSE / NASDAQ</div>
            <div style="font-size:16px;font-weight:700;color:#fff;margin:6px 0">{market_status}</div>
            <div style="font-size:11px;color:#444;">
                {'Pre-market active (4:00–9:30 AM ET)' if pre_market else
                 'After-hours active (4:00–8:00 PM ET)' if after_hours else
                 'Regular session 9:30 AM–4:00 PM ET'}
            </div>
        </div>
        <div class="metric-card">
            <div class="label">Today</div>
            <div style="font-size:15px;font-weight:600;color:#ccc;margin-top:4px">{now.strftime('%A')}</div>
            <div style="font-size:12px;color:#444;margin-top:4px">{now.strftime('%B %d, %Y')}</div>
        </div>
        """, unsafe_allow_html=True)

# ── PORTFOLIO PAGE ────────────────────────────────────────────────────────────
elif page == "investment":
    st.markdown('<div class="section-header" style="margin-top:0">Portfolio</div>', unsafe_allow_html=True)
    trade_sidebar_form(TICKERS, TICKER_MAP)
    st.divider()
    render_live_positions(trades_df)
    st.divider()
    render_accounts_and_holdings_section(title="Holdings")
    st.divider()
    render_orders_section(tickers=TICKERS, ticker_map=TICKER_MAP)

# ── INDIVIDUAL STOCK ──────────────────────────────────────────────────────────
elif page == "stock":
    sym = _get_query_param("symbol") or ""
    render_stock_page(symbol=str(sym), ticker_map=TICKER_MAP)

# ── P&L PAGE ──────────────────────────────────────────────────────────────────
elif page == "pnl":
    st.markdown('<div class="section-header" style="margin-top:0">Profit &amp; Loss</div>', unsafe_allow_html=True)
    render_profit_and_loss_page(trades_df)

# ── GAMMA / OPTIONS FLOW ──────────────────────────────────────────────────────
elif page == "gamma":
    render_gamma_exposure_page()

# ── BUDGET ────────────────────────────────────────────────────────────────────
elif page == "budget":
    st.markdown('<div class="section-header" style="margin-top:0">Budget &amp; Assets</div>', unsafe_allow_html=True)
    budget_entry_form(budget_df)

# ── SETTINGS ─────────────────────────────────────────────────────────────────
elif page == "settings":
    render_settings_page()


def on_grid_change(key, trade_id, field):
    if 'user' not in st.session_state:
        st.error('Sign in to edit trades')
        return
    new_val = st.session_state[key]
    trades, _, _ = api_load_data(token)
    row = trades[trades['id'] == trade_id].iloc[0]
    data = {
        'symbol': row['symbol'], 'strategy': row['strategy'],
        'action': row['action'], 'qty': row['quantity'],
        'price': row['entry_price'], 'date': row['entry_date'],
    }
    if field == 'symbol': data['symbol'] = new_val
    elif field == 'action': data['action'] = new_val
    elif field == 'strategy': data['strategy'] = new_val
    elif field == 'qty': data['qty'] = new_val
    elif field == 'price': data['price'] = new_val
    elif field == 'date': data['date'] = new_val
    data['symbol'] = str(data['symbol']).upper()
    data['action'] = canonical_action(data['action'])
    api_update_trade(token, trade_id, data['symbol'], data['strategy'],
                     data['action'], data['qty'], data['price'], data['date'])
    st.toast(f"Updated {field}!", icon="💾")



