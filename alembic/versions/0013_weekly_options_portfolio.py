"""weekly options portfolio tables

Revision ID: 0013
Revises: 0012
Create Date: 2026-02-27

Adds:
  - weekly_snapshots  — one row per Friday; tracks account value + completion
  - option_positions  — one row per option leg sold; carries forward when active
  - stock_assignments — stock acquired via put assignment + cost basis tracking
"""

from alembic import op
import sqlalchemy as sa

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "weekly_snapshots",
        sa.Column("id",            sa.Integer,  primary_key=True),
        sa.Column("user_id",       sa.Integer,  sa.ForeignKey("users.id"), nullable=False),
        sa.Column("week_start",    sa.DateTime, nullable=False),
        sa.Column("week_end",      sa.DateTime, nullable=False),
        sa.Column("account_value", sa.Float,    nullable=True),
        sa.Column("is_complete",   sa.Boolean,  nullable=False, default=False),
        sa.Column("completed_at",  sa.DateTime, nullable=True),
        sa.Column("notes",         sa.String,   nullable=True),
        sa.Column("created_at",    sa.DateTime, nullable=False),
    )
    op.create_index("ix_weekly_snapshots_user_id",    "weekly_snapshots", ["user_id"])
    op.create_index("ix_weekly_snapshots_week_start", "weekly_snapshots", ["week_start"])
    op.create_index("ix_weekly_snapshots_week_end",   "weekly_snapshots", ["week_end"])
    op.create_index("ix_weekly_snapshots_is_complete","weekly_snapshots", ["is_complete"])
    op.create_index("ux_weekly_snapshots_user_week_end", "weekly_snapshots",
                    ["user_id", "week_end"], unique=True)

    op.create_table(
        "option_positions",
        sa.Column("id",              sa.Integer, primary_key=True),
        sa.Column("user_id",         sa.Integer, sa.ForeignKey("users.id"),              nullable=False),
        sa.Column("week_id",         sa.Integer, sa.ForeignKey("weekly_snapshots.id"),   nullable=False),
        sa.Column("symbol",          sa.String,  nullable=False),
        sa.Column("contracts",       sa.Integer, nullable=False, default=1),
        sa.Column("strike",          sa.Float,   nullable=False),
        sa.Column("option_type",     sa.String,  nullable=False),
        sa.Column("sold_date",       sa.DateTime, nullable=True),
        sa.Column("buy_date",        sa.DateTime, nullable=True),
        sa.Column("expiry_date",     sa.DateTime, nullable=True),
        sa.Column("premium_in",      sa.Float,   nullable=True),
        sa.Column("premium_out",     sa.Float,   nullable=True),
        sa.Column("is_roll",         sa.Boolean, nullable=False, default=False),
        sa.Column("status",          sa.String,  nullable=False, default="ACTIVE"),
        sa.Column("rolled_to_id",    sa.Integer, sa.ForeignKey("option_positions.id"), nullable=True),
        sa.Column("carried_from_id", sa.Integer, sa.ForeignKey("option_positions.id"), nullable=True),
        sa.Column("margin",          sa.Float,   nullable=True),
        sa.Column("notes",           sa.String,  nullable=True),
        sa.Column("created_at",      sa.DateTime, nullable=False),
        sa.Column("updated_at",      sa.DateTime, nullable=False),
    )
    op.create_index("ix_option_positions_user_id",    "option_positions", ["user_id"])
    op.create_index("ix_option_positions_week_id",    "option_positions", ["week_id"])
    op.create_index("ix_option_positions_symbol",     "option_positions", ["symbol"])
    op.create_index("ix_option_positions_status",     "option_positions", ["status"])
    op.create_index("ix_option_positions_expiry_date","option_positions", ["expiry_date"])

    op.create_table(
        "stock_assignments",
        sa.Column("id",                 sa.Integer, primary_key=True),
        sa.Column("user_id",            sa.Integer, sa.ForeignKey("users.id"),           nullable=False),
        sa.Column("position_id",        sa.Integer, sa.ForeignKey("option_positions.id"), nullable=False),
        sa.Column("symbol",             sa.String,  nullable=False),
        sa.Column("shares_acquired",    sa.Integer, nullable=False),
        sa.Column("acquisition_price",  sa.Float,   nullable=False),
        sa.Column("additional_buys",    sa.String,  nullable=True),
        sa.Column("covered_calls",      sa.String,  nullable=True),
        sa.Column("net_option_premium", sa.Float,   nullable=True, default=0.0),
        sa.Column("notes",              sa.String,  nullable=True),
        sa.Column("created_at",         sa.DateTime, nullable=False),
        sa.Column("updated_at",         sa.DateTime, nullable=False),
    )
    op.create_index("ix_stock_assignments_user_id",    "stock_assignments", ["user_id"])
    op.create_index("ix_stock_assignments_position_id","stock_assignments", ["position_id"])
    op.create_index("ix_stock_assignments_symbol",     "stock_assignments", ["symbol"])


def downgrade() -> None:
    op.drop_table("stock_assignments")
    op.drop_table("option_positions")
    op.drop_table("weekly_snapshots")
