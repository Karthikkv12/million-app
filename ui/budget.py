import streamlit as st
import plotly.express as px
import pandas as pd
from frontend_client import save_budget
from ui.utils import canonical_budget_type

def budget_entry_form(budget_df):
    col_entry, col_view = st.columns([1, 2], gap="large")
    with col_entry:
        st.subheader("New Entry")
        with st.form("budget_form"):
            b_type = st.selectbox("Type", ["Expense", "Income", "Asset"])
            b_cat = st.text_input("Category", "General"); b_amt = st.number_input("Amount ($)", 0.01)
            b_date = st.date_input("Date"); b_desc = st.text_input("Description")
            if st.form_submit_button("Save Record", type="primary"):
                if 'user' not in st.session_state:
                    st.error('Please sign in to save records')
                else:
                    btype = canonical_budget_type(b_type)
                    token = st.session_state.get('token')
                    if not token:
                        st.error('Missing session token. Please sign in again.')
                    else:
                        save_budget(token, b_cat, btype, b_amt, b_date, b_desc)
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
            else:
                st.info("No expenses recorded yet.")
        else:
            st.info("No budget data available.")
