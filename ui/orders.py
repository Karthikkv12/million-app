import uuid
from datetime import datetime
import os

import streamlit as st

from frontend_client import APIError
from frontend_client import cancel_order as api_cancel_order
from frontend_client import create_order as api_create_order
from frontend_client import fill_order as api_fill_order
from frontend_client import fill_order_external as api_fill_order_external
from frontend_client import list_orders as api_list_orders
from frontend_client import sync_pending_orders as api_sync_pending_orders
from frontend_client import sync_order as api_sync_order
from ui.utils import canonical_action, canonical_instrument


def render_orders_section(*, tickers, ticker_map) -> None:
    st.subheader("Orders")

    broker_enabled = str(os.getenv("BROKER_ENABLED", "0")).strip().lower() in {"1", "true", "yes"}
    broker_provider = str(os.getenv("BROKER_PROVIDER", "paper")).strip() or "paper"
    st.caption(f"Broker execution: {'enabled' if broker_enabled else 'disabled'} ({broker_provider})")

    token = st.session_state.get("token")
    if not token:
        st.info("Sign in to manage orders.")
        return

    # Create order
    with st.expander("New Order (pending)", expanded=False):
        with st.form("pending_order_form"):
            c1, c2 = st.columns(2)
            sym = c1.selectbox(
                "Ticker",
                options=tickers,
                format_func=lambda x: f"{x} - {ticker_map.get(x, '')}",
            )
            act = c2.selectbox("Type", ["Buy", "Sell"])
            strat = st.selectbox("Strategy", ["Day Trade", "Swing Trade", "Buy & Hold"], index=1)
            c3, c4 = st.columns(2)
            qty = c3.number_input("Shares", min_value=1, max_value=100000, value=1)
            limit_px = c4.number_input("Limit Price (optional)", min_value=0.0, value=0.0, step=0.01)
            submitted = st.form_submit_button("Place pending order", type="secondary")

        if submitted:
            coid_key = "_pending_order_client_order_id"
            if not st.session_state.get(coid_key):
                st.session_state[coid_key] = uuid.uuid4().hex
            try:
                api_create_order(
                    str(token),
                    symbol=str(sym),
                    instrument=canonical_instrument("Stock"),
                    strategy=str(strat),
                    action=canonical_action(act),
                    qty=int(qty),
                    limit_price=(float(limit_px) if float(limit_px) > 0 else None),
                    client_order_id=str(st.session_state.get(coid_key)),
                )
            except APIError as e:
                st.error(str(e.detail or e))
            else:
                st.session_state.pop(coid_key, None)
                st.toast(f"Order placed: {sym}", icon="✅")
                if hasattr(st, "rerun"):
                    st.rerun()
                elif hasattr(st, "experimental_rerun"):
                    st.experimental_rerun()

    # List orders
    try:
        orders = api_list_orders(str(token))
    except APIError as e:
        st.error(str(e.detail or e))
        orders = []

    if not orders:
        st.caption("No orders yet.")
        return

    if broker_enabled:
        if st.button("Sync all pending (broker)", type="secondary"):
            try:
                api_sync_pending_orders(str(token))
            except APIError as e:
                st.error(str(e.detail or e))
            else:
                st.toast("Synced pending orders", icon="✅")
                if hasattr(st, "rerun"):
                    st.rerun()
                elif hasattr(st, "experimental_rerun"):
                    st.experimental_rerun()

    import pandas as _pd

    df = _pd.DataFrame(orders)
    preferred = [
        "id",
        "created_at",
        "symbol",
        "instrument",
        "action",
        "quantity",
        "limit_price",
        "status",
        "trade_id",
        "external_status",
        "venue",
        "external_order_id",
        "last_synced_at",
        "client_order_id",
        "filled_at",
        "filled_price",
        "strategy",
    ]
    cols = [c for c in preferred if c in df.columns] + [c for c in df.columns if c not in preferred]
    st.dataframe(df[cols], width="stretch", hide_index=True)

    # Actions
    pending = [o for o in orders if str(o.get("status") or "").upper() == "PENDING"]
    if not pending:
        st.caption("No pending orders.")
        return

    opt = [(int(o["id"]), f"#{o['id']} {o.get('symbol')} {o.get('action')} x{o.get('quantity')}") for o in pending]
    chosen = st.selectbox("Pending order", options=opt, format_func=lambda x: x[1])
    order_id = int(chosen[0])

    c1, c2 = st.columns(2)
    with c1:
        fill_px = st.number_input("Fill Price ($)", min_value=0.01, value=100.0, step=0.01)
        if broker_enabled:
            if st.button("Fill via broker", type="primary"):
                try:
                    api_fill_order_external(
                        str(token),
                        order_id=order_id,
                        filled_price=float(fill_px),
                        filled_at=datetime.today(),
                    )
                except APIError as e:
                    st.error(str(e.detail or e))
                else:
                    st.toast("Order filled (broker)", icon="✅")
                    if hasattr(st, "rerun"):
                        st.rerun()
                    elif hasattr(st, "experimental_rerun"):
                        st.experimental_rerun()
        else:
            if st.button("Mark filled", type="primary"):
                try:
                    api_fill_order(str(token), order_id=order_id, filled_price=float(fill_px), filled_at=datetime.today())
                except APIError as e:
                    st.error(str(e.detail or e))
                else:
                    st.toast("Order filled", icon="✅")
                    if hasattr(st, "rerun"):
                        st.rerun()
                    elif hasattr(st, "experimental_rerun"):
                        st.experimental_rerun()

    with c2:
        if st.button("Cancel order", type="secondary"):
            try:
                api_cancel_order(str(token), order_id=order_id)
            except APIError as e:
                st.error(str(e.detail or e))
            else:
                st.toast("Order cancelled", icon="✅")
                if hasattr(st, "rerun"):
                    st.rerun()
                elif hasattr(st, "experimental_rerun"):
                    st.experimental_rerun()

    # Broker sync (best-effort)
    if broker_enabled:
        if st.button("Sync from broker", type="secondary"):
            try:
                api_sync_order(str(token), order_id=order_id)
            except APIError as e:
                st.error(str(e.detail or e))
            else:
                st.toast("Synced", icon="✅")
                if hasattr(st, "rerun"):
                    st.rerun()
                elif hasattr(st, "experimental_rerun"):
                    st.experimental_rerun()
