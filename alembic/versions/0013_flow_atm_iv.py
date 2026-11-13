"""ATM implied vol on net-flow snapshots (flow.chain_stats.atm_iv): nearest expiry and constant 30-day

Revision ID: 0013_flow_atm_iv
Revises: 0012_flow_strike_sides
Create Date: 2026-11-13 21:00:00

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0013_flow_atm_iv'
down_revision = '0012_flow_strike_sides'
branch_labels = None
depends_on = None

_COLS = ('atm_iv_near', 'atm_iv_30d')


def upgrade() -> None:
    # plain ADD COLUMN (nullable): SQLite does it in place, no copy of the big snapshots table
    for c in _COLS:
        op.add_column('net_flow_snapshots', sa.Column(c, sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('net_flow_snapshots') as b:
        for c in reversed(_COLS):
            b.drop_column(c)
