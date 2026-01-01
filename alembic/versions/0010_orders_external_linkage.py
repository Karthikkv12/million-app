"""Orders: external OMS linkage fields

Revision ID: 0010_orders_external_linkage
Revises: 0009_orders
Create Date: 2025-12-28

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0010_orders_external_linkage"
down_revision = "0009_orders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("external_order_id", sa.String(), nullable=True))
    op.add_column("orders", sa.Column("venue", sa.String(), nullable=True))
    op.add_column("orders", sa.Column("external_status", sa.String(), nullable=True))
    op.add_column("orders", sa.Column("last_synced_at", sa.DateTime(), nullable=True))

    op.create_index("ix_orders_external_order_id", "orders", ["external_order_id"], unique=False)
    op.create_index("ix_orders_venue", "orders", ["venue"], unique=False)
    op.create_index("ix_orders_external_status", "orders", ["external_status"], unique=False)
    op.create_index("ix_orders_last_synced_at", "orders", ["last_synced_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_orders_last_synced_at", table_name="orders")
    op.drop_index("ix_orders_external_status", table_name="orders")
    op.drop_index("ix_orders_venue", table_name="orders")
    op.drop_index("ix_orders_external_order_id", table_name="orders")

    op.drop_column("orders", "last_synced_at")
    op.drop_column("orders", "external_status")
    op.drop_column("orders", "venue")
    op.drop_column("orders", "external_order_id")
