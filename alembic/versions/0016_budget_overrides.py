"""budget_overrides table

Revision ID: 0016
Revises: 0015
Create Date: 2026-03-01
"""
from alembic import op
import sqlalchemy as sa

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "budget_overrides",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("budget_id", sa.Integer(), sa.ForeignKey("budget.id"), nullable=False),
        sa.Column("month_key", sa.String(), nullable=False),   # 'YYYY-MM'
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_budget_overrides_user_id", "budget_overrides", ["user_id"])
    op.create_index("ix_budget_overrides_budget_id", "budget_overrides", ["budget_id"])
    op.create_index(
        "ux_budget_overrides_user_budget_month",
        "budget_overrides",
        ["user_id", "budget_id", "month_key"],
        unique=True,
    )


def downgrade():
    op.drop_index("ux_budget_overrides_user_budget_month", "budget_overrides")
    op.drop_index("ix_budget_overrides_budget_id", "budget_overrides")
    op.drop_index("ix_budget_overrides_user_id", "budget_overrides")
    op.drop_table("budget_overrides")
