"""gex_snapshots: GEX levels through the session, for replay

Revision ID: 0002_gex_snapshots
Revises: 0001_baseline
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0002_gex_snapshots"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "gex_snapshots",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("symbol", sa.String(), nullable=False),
        sa.Column("ts", sa.String(), nullable=False),
        sa.Column("spot", sa.Float(), nullable=False),
        sa.Column("net_gex", sa.Float(), nullable=True),
        sa.Column("zero_gamma", sa.Float(), nullable=True),
        sa.Column("call_wall", sa.Float(), nullable=True),
        sa.Column("put_wall", sa.Float(), nullable=True),
        sa.Column("king", sa.Float(), nullable=True),
        sa.Column("profile", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_gex_snapshots_symbol", "gex_snapshots", ["symbol"])
    op.create_index("ix_gex_snapshots_ts", "gex_snapshots", ["ts"])


def downgrade() -> None:
    op.drop_index("ix_gex_snapshots_ts", table_name="gex_snapshots")
    op.drop_index("ix_gex_snapshots_symbol", table_name="gex_snapshots")
    op.drop_table("gex_snapshots")
