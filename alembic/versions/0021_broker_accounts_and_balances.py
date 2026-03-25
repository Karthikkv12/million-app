"""Add broker_accounts and account_balances tables

Revision ID: 0021
Revises: 0020
Create Date: 2026-03-14
"""
from alembic import op
import sqlalchemy as sa

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "broker_accounts",
        sa.Column("id",         sa.Integer(),  nullable=False, primary_key=True),
        sa.Column("user_id",    sa.Integer(),  nullable=False, index=True),
        sa.Column("name",       sa.String(),   nullable=False),
        sa.Column("color",      sa.String(),   nullable=True),
        sa.Column("sort_order", sa.Integer(),  nullable=False, default=0),
        sa.Column("is_active",  sa.Boolean(),  nullable=False, default=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "account_balances",
        sa.Column("id",         sa.Integer(), nullable=False, primary_key=True),
        sa.Column("user_id",    sa.Integer(), nullable=False, index=True),
        sa.Column("account_id", sa.Integer(), nullable=False, index=True),
        sa.Column("week_date",  sa.Date(),    nullable=False, index=True),
        sa.Column("balance",    sa.Float(),   nullable=False),
    )


def downgrade() -> None:
    op.drop_table("account_balances")
    op.drop_table("broker_accounts")
