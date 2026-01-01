from __future__ import annotations

from datetime import datetime, timedelta

import pandas as pd
import streamlit as st
import yfinance as yf

from frontend_client import APIError
from frontend_client import create_order as api_create_order
from ui.utils import canonical_action, canonical_instrument


@st.cache_data(ttl=60)
def _fetch_history(symbol: str, period: str = "6mo", interval: str = "1d") -> pd.DataFrame:
    sym = str(symbol or "").strip().upper()
    if not sym:
        return pd.DataFrame()
    df = yf.download(sym, period=period, interval=interval, progress=False)
    if df is None or getattr(df, "empty", True):
        return pd.DataFrame()
    df = df.reset_index()
    return df


def render_search_page(*, tickers: list[str], ticker_map: dict[str, str]) -> None:
    st.subheader("Search")

    q = st.text_input("Search", value="", placeholder="Search by ticker or name")
    qn = str(q or "").strip().lower()

    def _matches(sym: str) -> bool:
        if not qn:
            return True
        name = str(ticker_map.get(sym) or "")
        hay = f"{sym} {name}".lower()
        return qn in hay

    matches = [s for s in tickers if _matches(s)]
    matches = matches[:200]

    if not matches:
        st.caption("No matches.")
        return

    chosen = st.selectbox(
        "Results",
        options=matches,
        format_func=lambda s: f"{s} - {ticker_map.get(s, '')}",
    )

    if st.button("View", type="primary"):
        try:
            st.query_params["page"] = "stock"  # type: ignore[attr-defined]
            st.query_params["symbol"] = str(chosen)
        except Exception:
            st.experimental_set_query_params(page="stock", symbol=str(chosen))


def render_stock_page(*, symbol: str, ticker_map: dict[str, str]) -> None:
    sym = str(symbol or "").strip().upper()
    if not sym:
        st.error("Missing symbol")
        return

    st.subheader(f"{sym}")
    name = str(ticker_map.get(sym) or "").strip()
    if name:
        st.caption(name)

    tab_overview, tab_order = st.tabs(["Overview", "Order"])

    with tab_overview:
        hist = _fetch_history(sym, period="6mo", interval="1d")
        if hist.empty:
            st.warning("No market data available for this symbol.")
        else:
            close = hist.get("Close")
            if close is None:
                st.warning("No close prices available for this symbol.")
            else:
                if isinstance(close, pd.DataFrame):
                    close = close.iloc[:, 0]

                if "Date" in hist.columns:
                    x = hist["Date"]
                elif "Datetime" in hist.columns:
                    x = hist["Datetime"]
                else:
                    x = hist.iloc[:, 0]

                x = pd.to_datetime(x, errors="coerce")
                close = pd.to_numeric(close, errors="coerce")

                chart_df = pd.DataFrame({"Close": close.to_numpy().ravel()}, index=x).dropna()

                # Current market price (best-effort): last close
                if chart_df.empty:
                    st.warning("No valid price history available for this symbol.")
                else:
                    last_close = float(chart_df["Close"].iloc[-1])
                    st.metric("Current price", f"${last_close:,.2f}")

                    # Historical chart
                    st.line_chart(chart_df, height=280)

    with tab_order:
        token = st.session_state.get("token")
        if not token:
            st.info("Sign in to trade.")
            return

        with st.form("stock_trade_form"):
            act = st.selectbox("Side", ["Buy", "Sell"], index=0)
            qty = st.number_input("Shares", min_value=1, max_value=100000, value=1)
            limit_px = st.number_input("Limit Price (optional)", min_value=0.0, value=0.0, step=0.01)
            strat = st.selectbox("Strategy", ["Day Trade", "Swing Trade", "Buy & Hold"], index=1)
            submitted = st.form_submit_button("Submit", type="primary")

        if submitted:
            try:
                api_create_order(
                    str(token),
                    symbol=sym,
                    instrument=canonical_instrument("Stock"),
                    strategy=str(strat),
                    action=canonical_action(act),
                    qty=int(qty),
                    limit_price=(float(limit_px) if float(limit_px) > 0 else None),
                    client_order_id=None,
                )
            except APIError as e:
                st.error(str(e.detail or e))
            else:
                st.toast("Order submitted", icon="✅")
                if hasattr(st, "rerun"):
                    st.rerun()
                elif hasattr(st, "experimental_rerun"):
                    st.experimental_rerun()
