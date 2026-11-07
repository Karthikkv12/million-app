"""0022 — cash_deposits table for tracking capital injections and withdrawals

Revision ID: 0022
Revises: 0021
Create Date: 2026-03-25
"""
from alembic import op
import sqlalchemy as sa

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cash_deposits",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, nullable=False, index=True),
        sa.Column("week_date", sa.Date, nullable=False, index=True),
        sa.Column("amount", sa.Float, nullable=False),
        sa.Column("note", sa.String, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_cash_deposits_user_week", "cash_deposits", ["user_id", "week_date"])


def downgrade() -> None:
    op.drop_index("ix_cash_deposits_user_week", table_name="cash_deposits")
    op.drop_table("cash_deposits")
