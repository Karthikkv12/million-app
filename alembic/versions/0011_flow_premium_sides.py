"""bought / sold split of traded premium on net-flow snapshots (flow.traded.side)

Revision ID: 0011_flow_premium_sides
Revises: 0010_flow_traded_premium
Create Date: 2026-11-13 11:45:00

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0011_flow_premium_sides'
down_revision = '0010_flow_traded_premium'
branch_labels = None
depends_on = None

_COLS = ('call_bought', 'call_sold', 'put_bought', 'put_sold')


def upgrade() -> None:
    # plain ADD COLUMN (nullable): SQLite does it in place, no copy of the big snapshots table
    for c in _COLS:
        op.add_column('net_flow_snapshots', sa.Column(c, sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('net_flow_snapshots') as b:
        for c in reversed(_COLS):
            b.drop_column(c)
