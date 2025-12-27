"""initial tables

Revision ID: 0001_initial
Revises: 
Create Date: 2025-12-27

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("username", sa.String(), nullable=False),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("salt", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("username", name="uq_users_username"),
    )
    op.create_index("ix_users_username", "users", ["username"], unique=False)

    instrument_enum = sa.Enum("STOCK", "OPTION", name="instrumenttype")
    action_enum = sa.Enum("BUY", "SELL", name="action")
    option_enum = sa.Enum("CALL", "PUT", name="optiontype")
    cash_action_enum = sa.Enum("DEPOSIT", "WITHDRAW", name="cashaction")
    budget_type_enum = sa.Enum("EXPENSE", "INCOME", "ASSET", name="budgettype")

    op.create_table(
        "trades",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("symbol", sa.String(), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=True),
        sa.Column("instrument", instrument_enum, nullable=True),
        sa.Column("strategy", sa.String(), nullable=True),
        sa.Column("action", action_enum, nullable=True),
        sa.Column("entry_date", sa.DateTime(), nullable=True),
        sa.Column("entry_price", sa.Float(), nullable=True),
        sa.Column("option_type", option_enum, nullable=True),
        sa.Column("strike_price", sa.Float(), nullable=True),
        sa.Column("expiry_date", sa.DateTime(), nullable=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index("ix_trades_user_id", "trades", ["user_id"], unique=False)

    op.create_table(
        "cash_flow",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("action", cash_action_enum, nullable=True),
        sa.Column("amount", sa.Float(), nullable=True),
        sa.Column("date", sa.DateTime(), nullable=True),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index("ix_cash_flow_user_id", "cash_flow", ["user_id"], unique=False)

    op.create_table(
        "budget",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("category", sa.String(), nullable=True),
        sa.Column("type", budget_type_enum, nullable=True),
        sa.Column("amount", sa.Float(), nullable=True),
        sa.Column("date", sa.DateTime(), nullable=True),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index("ix_budget_user_id", "budget", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_budget_user_id", table_name="budget")
    op.drop_table("budget")

    op.drop_index("ix_cash_flow_user_id", table_name="cash_flow")
    op.drop_table("cash_flow")

    op.drop_index("ix_trades_user_id", table_name="trades")
    op.drop_table("trades")

    op.drop_index("ix_users_username", table_name="users")
    op.drop_table("users")

    # Best-effort enum cleanup (safe on Postgres; no-op-ish on SQLite)
    bind = op.get_bind()
    for enum_name in ["instrumenttype", "action", "optiontype", "cashaction", "budgettype"]:
        try:
            sa.Enum(name=enum_name).drop(bind, checkfirst=True)
        except Exception:
            pass
