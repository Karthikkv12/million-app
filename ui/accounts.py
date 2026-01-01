import streamlit as st

from frontend_client import APIError
from frontend_client import create_account as api_create_account
from frontend_client import delete_holding as api_delete_holding
from frontend_client import list_accounts as api_list_accounts
from frontend_client import list_holdings as api_list_holdings
from frontend_client import upsert_holding as api_upsert_holding


def render_accounts_and_holdings_section(*, title: str = "Accounts & holdings") -> None:
    st.subheader(title)

    token = st.session_state.get("token")
    if not token:
        st.info("Sign in to manage accounts and holdings.")
        return

    # Accounts
    try:
        accounts = api_list_accounts(str(token))
    except APIError as e:
        st.error(str(e.detail or e))
        accounts = []

    if accounts:
        import pandas as _pd

        st.markdown("**Accounts**")
        st.dataframe(_pd.DataFrame(accounts), width="stretch", hide_index=True)
    else:
        st.caption("No accounts yet.")

    with st.form(f"create_account_form__{title}"):
        st.markdown("**Add account**")
        name = st.text_input("Account name")
        broker = st.text_input("Broker (optional)")
        currency = st.text_input("Currency", value="USD")
        submitted = st.form_submit_button("Create account", type="primary")
    if submitted:
        try:
            api_create_account(str(token), name=name, broker=(broker or None), currency=(currency or "USD"))
            st.toast("Account created", icon="✅")
            if hasattr(st, "rerun"):
                st.rerun()
            elif hasattr(st, "experimental_rerun"):
                st.experimental_rerun()
        except APIError as e:
            st.error(str(e.detail or e))

    # Holdings
    if not accounts:
        return

    options = [(int(a.get("id")), str(a.get("name") or a.get("id"))) for a in accounts]
    selected = st.selectbox("Account", options=options, format_func=lambda x: x[1])
    account_id = int(selected[0])

    try:
        holdings = api_list_holdings(str(token), account_id=account_id)
    except APIError as e:
        st.error(str(e.detail or e))
        holdings = []

    st.markdown("**Holdings**")
    if holdings:
        import pandas as _pd

        st.dataframe(_pd.DataFrame(holdings), width="stretch", hide_index=True)

        # Convert holding -> prefilled trade (best-effort UX shortcut).
        try:
            hold_options = []
            for h in holdings:
                sym = str(h.get("symbol") or "").strip().upper()
                qty = float(h.get("quantity") or 0.0)
                hold_options.append((sym, qty, h))
            if hold_options:
                st.markdown("**Convert holding to trade**")
                chosen = st.selectbox(
                    "Holding",
                    options=hold_options,
                    format_func=lambda x: f"{x[0]} ({x[1]:g})",
                    key=f"holding_to_trade__{title}",
                )
                if st.button("Prefill trade form", type="secondary", key=f"prefill_trade_btn__{title}"):
                    sym, qty, h = chosen
                    # If long, default to SELL (close). If short, default to BUY (cover).
                    default_action = "Sell" if float(qty) > 0 else "Buy"
                    st.session_state["_trade_prefill"] = {
                        "symbol": sym,
                        "qty": abs(float(qty)) if float(qty) != 0 else 1.0,
                        "action": default_action,
                        "price": (h.get("avg_cost") if h.get("avg_cost") is not None else None),
                        "strategy": "Swing Trade",
                    }
                    if hasattr(st, "rerun"):
                        st.rerun()
                    elif hasattr(st, "experimental_rerun"):
                        st.experimental_rerun()
        except Exception:
            pass
    else:
        st.caption("No holdings in this account.")

    with st.form(f"upsert_holding_form__{title}"):
        st.markdown("**Add / update holding**")
        symbol = st.text_input("Symbol")
        quantity = st.number_input("Quantity", value=0.0)
        avg_cost = st.number_input("Avg cost (optional)", value=0.0)
        set_avg = st.checkbox("Set avg cost", value=False)
        upserted = st.form_submit_button("Save holding", type="secondary")
    if upserted:
        try:
            api_upsert_holding(
                str(token),
                account_id=account_id,
                symbol=symbol,
                quantity=float(quantity),
                avg_cost=(float(avg_cost) if set_avg else None),
            )
            st.toast("Holding saved", icon="✅")
            if hasattr(st, "rerun"):
                st.rerun()
            elif hasattr(st, "experimental_rerun"):
                st.experimental_rerun()
        except APIError as e:
            st.error(str(e.detail or e))

    if holdings:
        del_options = [(int(h.get("id")), f"{h.get('symbol')} (id {h.get('id')})") for h in holdings]
        to_del = st.selectbox("Delete holding", options=del_options, format_func=lambda x: x[1])
        if st.button("Delete selected holding", type="secondary"):
            try:
                api_delete_holding(str(token), holding_id=int(to_del[0]))
                st.toast("Holding deleted", icon="✅")
                if hasattr(st, "rerun"):
                    st.rerun()
                elif hasattr(st, "experimental_rerun"):
                    st.experimental_rerun()
            except APIError as e:
                st.error(str(e.detail or e))
