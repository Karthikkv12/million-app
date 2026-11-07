"""0023 — watchlist_symbols table

Revision ID: 0023
Revises: 0022
Create Date: 2026-03-25

Stores per-user watchlist entries.
Symbols are auto-registered from positions and holdings, or added manually.
Once added they are never auto-deleted (only soft-deleted by the user via is_active=False).
"""
from alembic import op
import sqlalchemy as sa

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "watchlist_symbols",
        sa.Column("id",           sa.Integer,  primary_key=True),
        sa.Column("user_id",      sa.Integer,  nullable=False, index=True),
        sa.Column("symbol",       sa.String,   nullable=False, index=True),
        sa.Column("company_name", sa.String,   nullable=True),
        sa.Column("source",       sa.String,   nullable=False, server_default="manual"),
        sa.Column("notes",        sa.String,   nullable=True),
        sa.Column("is_active",    sa.Boolean,  nullable=False, server_default=sa.true()),
        sa.Column("added_at",     sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at",   sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        "ux_watchlist_user_symbol",
        "watchlist_symbols",
        ["user_id", "symbol"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ux_watchlist_user_symbol", table_name="watchlist_symbols")
    op.drop_table("watchlist_symbols")
