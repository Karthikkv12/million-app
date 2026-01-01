"""orders

Revision ID: 0009_orders
Revises: 0008_accounts_and_holdings
Create Date: 2025-12-28

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0009_orders"
down_revision = "0008_accounts_and_holdings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Reuse existing enums created in 0001.
    instrument_enum = sa.Enum("STOCK", "OPTION", name="instrumenttype", create_type=False)
    action_enum = sa.Enum("BUY", "SELL", name="action", create_type=False)
    order_status_enum = sa.Enum("PENDING", "FILLED", "CANCELLED", name="orderstatus")

    op.create_table(
        "orders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("symbol", sa.String(), nullable=False),
        sa.Column("instrument", instrument_enum, nullable=False),
        sa.Column("action", action_enum, nullable=False),
        sa.Column("strategy", sa.String(), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("limit_price", sa.Float(), nullable=True),
        sa.Column("status", order_status_enum, nullable=False, server_default="PENDING"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("filled_at", sa.DateTime(), nullable=True),
        sa.Column("filled_price", sa.Float(), nullable=True),
        sa.Column("trade_id", sa.Integer(), sa.ForeignKey("trades.id"), nullable=True),
        sa.Column("client_order_id", sa.String(), nullable=True),
    )

    op.create_index("ix_orders_user_id", "orders", ["user_id"], unique=False)
    op.create_index("ix_orders_symbol", "orders", ["symbol"], unique=False)
    op.create_index("ix_orders_status", "orders", ["status"], unique=False)
    op.create_index("ix_orders_created_at", "orders", ["created_at"], unique=False)
    op.create_index("ix_orders_filled_at", "orders", ["filled_at"], unique=False)
    op.create_index("ix_orders_trade_id", "orders", ["trade_id"], unique=False)

    op.create_unique_constraint(
        "ux_orders_user_client_order_id",
        "orders",
        ["user_id", "client_order_id"],
    )

    # Drop server default now that the column exists.
    with op.batch_alter_table("orders") as batch:
        batch.alter_column("status", server_default=None)


def downgrade() -> None:
    op.drop_constraint("ux_orders_user_client_order_id", "orders", type_="unique")
    op.drop_index("ix_orders_trade_id", table_name="orders")
    op.drop_index("ix_orders_filled_at", table_name="orders")
    op.drop_index("ix_orders_created_at", table_name="orders")
    op.drop_index("ix_orders_status", table_name="orders")
    op.drop_index("ix_orders_symbol", table_name="orders")
    op.drop_index("ix_orders_user_id", table_name="orders")
    op.drop_table("orders")

    # Best-effort enum cleanup.
    bind = op.get_bind()
    try:
        sa.Enum(name="orderstatus").drop(bind, checkfirst=True)
    except Exception:
        pass
