import streamlit as st
import plotly.express as px
import pandas as pd
from datetime import datetime
import urllib.error
import urllib.request
import io
import uuid
from frontend_client import APIError, save_trade, delete_trade, close_trade
from ui.utils import canonical_action, canonical_instrument


@st.cache_data(ttl=60)
def _fetch_last_price(symbol: str) -> float | None:
    """Best-effort last price using Stooq CSV (no API key)."""
    sym = str(symbol or "").strip().lower()
    if not sym:
        return None
    # Stooq uses e.g. aapl.us
    stooq_symbol = f"{sym}.us"
    url = f"https://stooq.com/q/l/?s={stooq_symbol}&f=sd2t2ohlcv&h&e=csv"
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            raw = resp.read().decode("utf-8")
        df = pd.read_csv(io.StringIO(raw))
        if df.empty:
            return None
        close_val = df.iloc[0].get("Close")
        try:
            price = float(close_val)
            if price > 0:
                return price
        except Exception:
            return None
        return None
    except (urllib.error.URLError, TimeoutError, Exception):
        return None


def _is_open_trade_row(row: pd.Series) -> bool:
    if "is_closed" in row.index and bool(row.get("is_closed")):
        return False
    if "exit_price" in row.index and pd.notna(row.get("exit_price")):
        return False
    if "exit_date" in row.index and pd.notna(row.get("exit_date")):
        return False
    return True


def _split_open_closed(trades_df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    if trades_df is None or trades_df.empty:
        return trades_df, trades_df
    open_mask = trades_df.apply(_is_open_trade_row, axis=1)
    return trades_df[open_mask].copy(), trades_df[~open_mask].copy()


def render_live_positions(trades_df: pd.DataFrame) -> None:
    st.subheader("Live Positions")

    if trades_df.empty:
        st.info("No trades executed yet.")
        return

    open_df, closed_df = _split_open_closed(trades_df)
    open_rows = [row for _, row in open_df.iterrows()]
    if not open_rows:
        st.caption("No open positions.")
    else:
        if st.button("Refresh Prices", type="secondary", key="refresh_prices"):
            st.cache_data.clear()
            st.rerun()

        cols = st.columns([1.2, 0.8, 1.0, 1.0, 1.2, 1.0])
        cols[0].markdown("**Ticker**")
        cols[1].markdown("**Qty**")
        cols[2].markdown("**Entry**")
        cols[3].markdown("**Last**")
        cols[4].markdown("**Unrealized P/L**")
        cols[5].markdown("**Action**")

        for row in open_rows:
            trade_id = int(row.get("id"))
            symbol = str(row.get("symbol") or "").upper()
            qty = int(row.get("quantity") or 0)
            entry = float(row.get("entry_price") or 0.0)
            action = str(row.get("action") or "BUY").upper()
            last = _fetch_last_price(symbol)

            if last is None:
                pnl = None
            else:
                if action == "SELL":
                    pnl = (entry - float(last)) * qty
                else:
                    pnl = (float(last) - entry) * qty

            c1, c2, c3, c4, c5, c6 = st.columns([1.2, 0.8, 1.0, 1.0, 1.2, 1.0])
            c1.write(symbol)
            c2.write(qty)
            c3.write(f"${entry:,.2f}")
            c4.write("—" if last is None else f"${float(last):,.2f}")
            if pnl is None:
                c5.write("—")
            else:
                c5.write(f"${pnl:,.2f}")

            if c6.button("Close", key=f"close_btn_{trade_id}", type="primary", width="stretch"):
                st.session_state["_closing_trade_id"] = trade_id
                st.session_state["_closing_trade_symbol"] = symbol
                st.session_state["_closing_trade_last"] = float(last) if last is not None else None
                st.session_state["_closing_trade_entry"] = entry
                st.rerun()

    # Close position form (appears when user clicks Close)
    closing_id = st.session_state.get("_closing_trade_id")
    if closing_id is not None:
        with st.expander("Close Position", expanded=True):
            symbol = st.session_state.get("_closing_trade_symbol", "")
            last = st.session_state.get("_closing_trade_last")
            entry = float(st.session_state.get("_closing_trade_entry") or 0.0)

            st.caption(f"Closing {symbol} (Trade ID: {closing_id})")
            default_exit = float(last) if last is not None else entry
            with st.form("close_position_form"):
                exit_price = st.number_input("Exit Price ($)", min_value=0.01, value=float(default_exit), step=0.01)
                exit_date = st.date_input("Exit Date", datetime.today())
                col_a, col_b = st.columns(2)
                submitted = col_a.form_submit_button("Confirm Close", type="primary")
                cancelled = col_b.form_submit_button("Cancel", type="secondary")

            if cancelled:
                for k in ("_closing_trade_id", "_closing_trade_symbol", "_closing_trade_last", "_closing_trade_entry"):
                    st.session_state.pop(k, None)
                st.rerun()

            if submitted:
                token = st.session_state.get("token")
                if not token:
                    st.error("Missing session token. Please sign in again.")
                else:
                    try:
                        ok = close_trade(token, int(closing_id), float(exit_price), exit_date)
                    except APIError as e:
                        st.error(str(e.detail or e))
                    else:
                        if not ok:
                            st.error("Could not close trade (already closed or not found).")
                        else:
                            st.toast(f"Closed {symbol}", icon="✅")
                            st.cache_data.clear()
                            for k in ("_closing_trade_id", "_closing_trade_symbol", "_closing_trade_last", "_closing_trade_entry"):
                                st.session_state.pop(k, None)
                            st.rerun()



def render_profit_and_loss_page(trades_df: pd.DataFrame) -> None:
    st.subheader("Profit & Loss")

    if trades_df is None or trades_df.empty:
        st.info("No trades executed yet.")
        return

    # Portfolio/Journal should reflect closed trades only.
    _, closed_df = _split_open_closed(trades_df)
    if closed_df is None or closed_df.empty:
        st.info("No closed trades yet. Close a position to add it to the journal.")
        return

    trades_df = closed_df.copy()

    if "realized_pnl" not in trades_df.columns and "exit_price" in trades_df.columns:
        def _calc(row: pd.Series) -> float:
            qty = float(row.get("quantity") or 0)
            entry = float(row.get("entry_price") or 0.0)
            exitp = float(row.get("exit_price") or 0.0)
            act = str(row.get("action") or "BUY").upper()
            return (entry - exitp) * qty if act == "SELL" else (exitp - entry) * qty

        trades_df["realized_pnl"] = trades_df.apply(_calc, axis=1)

    if "realized_pnl" in trades_df.columns:
        st.metric("Realized P/L", f"${float(trades_df['realized_pnl'].fillna(0).sum()):,.2f}")

    trades_df["market_value"] = trades_df["entry_price"] * trades_df["quantity"]
    df_chart = trades_df.sort_values("entry_date")
    df_chart["cumulative_value"] = df_chart["market_value"].cumsum()

    c_title, c_toggle = st.columns([2, 1])
    c_title.write("")
    range_opt = c_toggle.radio(
        "Time Range",
        ["1W", "1M", "6M", "1Y", "All"],
        index=4,
        horizontal=True,
        label_visibility="collapsed",
        key="pnl_time_range",
    )

    if range_opt != "All":
        cutoff = datetime.now()
        if range_opt == "1W":
            cutoff -= pd.Timedelta(weeks=1)
        elif range_opt == "1M":
            cutoff -= pd.Timedelta(days=30)
        elif range_opt == "6M":
            cutoff -= pd.Timedelta(days=180)
        elif range_opt == "1Y":
            cutoff -= pd.Timedelta(days=365)
        df_display = df_chart[df_chart["entry_date"] >= cutoff]
    else:
        df_display = df_chart

    if not df_display.empty:
        fig = px.area(df_display, x="entry_date", y="cumulative_value", template="plotly_white")
        fig.update_traces(line_color="#00c805", fillcolor="rgba(0, 200, 5, 0.1)")
        fig.update_layout(margin=dict(l=0, r=0, t=10, b=0), yaxis_title=None, xaxis_title=None)
        st.plotly_chart(fig, width="stretch")
    else:
        st.caption(f"No trade data available for the last {range_opt}.")

    st.divider()
    if "sort_col" not in st.session_state:
        st.session_state.sort_col = "entry_date"
    if "sort_asc" not in st.session_state:
        st.session_state.sort_asc = False

    header_map = {
        "Date": "entry_date",
        "Ticker": "symbol",
        "Type": "action",
        "Strategy": "strategy",
        "Qty": "quantity",
        "Price": "entry_price",
        "Exit": "exit_price",
        "P/L": "realized_pnl",
    }
    cols = st.columns([1.5, 1, 1, 1.5, 1, 1, 1, 1, 1])
    for col, (display, db_col) in zip(cols[:-1], header_map.items()):
        arrow = ""
        if st.session_state.sort_col == db_col:
            arrow = " ▲" if st.session_state.sort_asc else " ▼"
        if col.button(
            f"{display}{arrow}",
            key=f"btn_sort_{db_col}",
            width="stretch",
            type="secondary",
        ):
            if st.session_state.sort_col == db_col:
                st.session_state.sort_asc = not st.session_state.sort_asc
            else:
                st.session_state.sort_col = db_col
                st.session_state.sort_asc = True
            st.rerun()

    cols[-1].markdown(
        "<div style='text-align: center; font-weight: 800; color: #00c805; padding-top: 8px;'>Action</div>",
        unsafe_allow_html=True,
    )
    df_sorted = trades_df.sort_values(by=st.session_state.sort_col, ascending=st.session_state.sort_asc)

    for _, row in df_sorted.iterrows():
        c1, c2, c3, c4, c5, c6, c_exit, c_pnl, c7 = st.columns([1.5, 1, 1, 1.5, 1, 1, 1, 1, 1])
        c1.date_input("D", row["entry_date"], key=f"d_{row['id']}", label_visibility="collapsed")
        c2.text_input("T", row["symbol"], key=f"t_{row['id']}", label_visibility="collapsed")
        c3.selectbox(
            "S",
            ["BUY", "SELL"],
            index=0 if row["action"] == "BUY" else 1,
            key=f"a_{row['id']}",
            label_visibility="collapsed",
        )
        try:
            strat_idx = ["Day Trade", "Swing Trade", "Buy & Hold"].index(row["strategy"])
        except Exception:
            strat_idx = 0
        c4.selectbox(
            "St",
            ["Day Trade", "Swing Trade", "Buy & Hold"],
            index=strat_idx,
            key=f"st_{row['id']}",
            label_visibility="collapsed",
        )
        c5.number_input("Q", value=int(row["quantity"]), step=1, key=f"q_{row['id']}", label_visibility="collapsed")
        c6.number_input("P", value=float(row["entry_price"]), step=0.01, key=f"p_{row['id']}", label_visibility="collapsed")
        exit_v = row.get("exit_price", None)
        pnl_v = row.get("realized_pnl", None)
        c_exit.write("—" if pd.isna(exit_v) else f"${float(exit_v):,.2f}")
        c_pnl.write("—" if pd.isna(pnl_v) else f"${float(pnl_v):,.2f}")
        if c7.button("Delete", key=f"del_{row['id']}", type="primary", width="stretch"):
            if "user" not in st.session_state:
                st.error("Sign in to delete trades")
            else:
                token = st.session_state.get("token")
                if not token:
                    st.error("Missing session token. Please sign in again.")
                else:
                    delete_trade(token, row["id"])
            st.toast(f"Deleted {row['symbol']}", icon="🗑")
            st.cache_data.clear()
            st.rerun()


def trade_sidebar_form(TICKERS, TICKER_MAP):
    # Keep function name for compatibility, but render in the main page.
    prefill = st.session_state.get("_trade_prefill") if isinstance(st.session_state.get("_trade_prefill"), dict) else {}
    pre_sym = str(prefill.get("symbol") or "").strip().upper() if prefill else ""
    # Search-first navigation. Order entry happens inside the Stock page.
    tab = st.tabs(["Search"])[0]
    with tab:
        q = st.text_input("Search", value=(pre_sym if pre_sym else ""), placeholder="Type ticker or company name")
        qn = str(q or "").strip().lower()

        def _matches(sym: str) -> bool:
            if not qn:
                return False
            name = str(TICKER_MAP.get(sym) or "")
            hay = f"{sym} {name}".lower()
            return qn in hay

        matches = [s for s in (TICKERS or []) if _matches(str(s))]
        matches = matches[:25]

        chosen_sym = ""
        # Exact ticker shortcut
        if qn and str(q or "").strip().upper() in (TICKERS or []):
            chosen_sym = str(q or "").strip().upper()
        elif matches:
            chosen_sym = st.radio(
                "Matches",
                options=matches,
                format_func=lambda s: f"{s} — {TICKER_MAP.get(s, '')}",
                label_visibility="collapsed",
            )
        elif qn:
            st.caption("No matches.")

        if chosen_sym:
            name = str(TICKER_MAP.get(chosen_sym) or "").strip()
            if name:
                st.caption(name)

            c_view, _ = st.columns([1, 3])
            if c_view.button("View", type="secondary"):
                try:
                    qp = st.query_params  # type: ignore[attr-defined]
                    qp["page"] = "stock"
                    qp["symbol"] = str(chosen_sym)
                except Exception:
                    try:
                        qp = st.experimental_get_query_params()
                        qp["page"] = ["stock"]
                        qp["symbol"] = [str(chosen_sym)]
                        flat = {k: (v[0] if isinstance(v, list) and v else v) for k, v in qp.items()}
                        st.experimental_set_query_params(**flat)
                    except Exception:
                        pass

        # If the user opened the form due to a prefill action, clear it even if they don't submit.
        # (Avoid confusing repeated defaults on later visits.)
        if prefill:
            st.session_state.pop("_trade_prefill", None)


def render_trades_tab(trades_df):
    render_live_positions(trades_df)
    st.markdown("---")
    render_profit_and_loss_page(trades_df)
