"""traded premium on net-flow snapshots (Δvolume × mid, flow.traded)

Revision ID: 0010_flow_traded_premium
Revises: 0009_pulse_alerts_paper
Create Date: 2026-11-13 03:00:00

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0010_flow_traded_premium'
down_revision = '0009_pulse_alerts_paper'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # plain ADD COLUMN (nullable): SQLite does it in place, no copy of the big snapshots table
    op.add_column('net_flow_snapshots', sa.Column('call_traded', sa.Float(), nullable=True))
    op.add_column('net_flow_snapshots', sa.Column('put_traded', sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('net_flow_snapshots') as b:
        b.drop_column('put_traded')
        b.drop_column('call_traded')
