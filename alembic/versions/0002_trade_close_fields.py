"""trade close lifecycle fields

Revision ID: 0002_trade_close_fields
Revises: 0001_initial
Create Date: 2025-12-28

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0002_trade_close_fields"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add close-trade lifecycle fields (existing rows become open positions).
    op.add_column(
        "trades",
        sa.Column("is_closed", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("trades", sa.Column("exit_date", sa.DateTime(), nullable=True))
    op.add_column("trades", sa.Column("exit_price", sa.Float(), nullable=True))
    op.add_column("trades", sa.Column("realized_pnl", sa.Float(), nullable=True))

    # Drop server default now that the column exists.
    with op.batch_alter_table("trades") as batch:
        batch.alter_column("is_closed", server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("trades") as batch:
        batch.drop_column("realized_pnl")
        batch.drop_column("exit_price")
        batch.drop_column("exit_date")
        batch.drop_column("is_closed")
