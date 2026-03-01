"""Create credit_card_weeks table

Revision ID: 0015
Revises: 0014
Create Date: 2026-03-01
"""
from alembic import op
import sqlalchemy as sa

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "credit_card_weeks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("week_start", sa.DateTime(), nullable=False),
        sa.Column("balance", sa.Float(), nullable=False, server_default="0"),
        sa.Column("squared_off", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("paid_amount", sa.Float(), nullable=True),
        sa.Column("note", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_credit_card_weeks_user_week", "credit_card_weeks", ["user_id", "week_start"])


def downgrade() -> None:
    op.drop_index("ix_credit_card_weeks_user_week", table_name="credit_card_weeks")
    op.drop_table("credit_card_weeks")
