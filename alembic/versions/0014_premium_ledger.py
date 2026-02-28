"""premium_ledger — per-position premium tracking per holding

Revision ID: 0014
Revises: 0013
Create Date: 2026-02-27

Adds:
  - premium_ledger  — one row per (holding × option_position).
    Tracks premium_sold, realized_premium, unrealized_premium so that
    adj_basis and live_adj_basis can be derived correctly at all times.
"""

from alembic import op
import sqlalchemy as sa

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "premium_ledger",
        sa.Column("id",                 sa.Integer,  primary_key=True),
        sa.Column("user_id",            sa.Integer,  sa.ForeignKey("users.id"),            nullable=False),
        sa.Column("holding_id",         sa.Integer,  sa.ForeignKey("stock_holdings.id"),   nullable=False),
        sa.Column("position_id",        sa.Integer,  sa.ForeignKey("option_positions.id"), nullable=False),
        sa.Column("symbol",             sa.String,   nullable=False),
        sa.Column("week_id",            sa.Integer,  sa.ForeignKey("weekly_snapshots.id"), nullable=True),
        sa.Column("option_type",        sa.String,   nullable=False),
        sa.Column("strike",             sa.Float,    nullable=False),
        sa.Column("contracts",          sa.Integer,  nullable=False, default=1),
        sa.Column("expiry_date",        sa.DateTime, nullable=True),
        sa.Column("premium_sold",       sa.Float,    nullable=False, default=0.0),
        sa.Column("realized_premium",   sa.Float,    nullable=False, default=0.0),
        sa.Column("unrealized_premium", sa.Float,    nullable=False, default=0.0),
        sa.Column("status",             sa.String,   nullable=False, default="ACTIVE"),
        sa.Column("notes",              sa.String,   nullable=True),
        sa.Column("created_at",         sa.DateTime, nullable=False),
        sa.Column("updated_at",         sa.DateTime, nullable=False),
    )
    op.create_index("ix_premium_ledger_user_id",    "premium_ledger", ["user_id"])
    op.create_index("ix_premium_ledger_holding_id", "premium_ledger", ["holding_id"])
    op.create_index("ix_premium_ledger_position_id","premium_ledger", ["position_id"])
    op.create_index("ix_premium_ledger_symbol",     "premium_ledger", ["symbol"])
    op.create_index("ix_premium_ledger_week_id",    "premium_ledger", ["week_id"])
    op.create_index("ix_premium_ledger_status",     "premium_ledger", ["status"])
    op.create_unique_constraint(
        "ux_premium_ledger_holding_position",
        "premium_ledger",
        ["holding_id", "position_id"],
    )


def downgrade() -> None:
    op.drop_table("premium_ledger")
