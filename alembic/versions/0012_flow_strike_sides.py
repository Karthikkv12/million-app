"""per-strike bought / sold premium and delta dollars (flow.traded.strikes)

Revision ID: 0012_flow_strike_sides
Revises: 0011_flow_premium_sides
Create Date: 2026-11-13 15:00:00

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0012_flow_strike_sides'
down_revision = '0011_flow_premium_sides'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'flow_strike_sides',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('symbol', sa.String(), nullable=False),
        sa.Column('day', sa.String(), nullable=False),
        sa.Column('expiry', sa.String(), nullable=False),
        sa.Column('strike', sa.Float(), nullable=False),
        sa.Column('otype', sa.String(), nullable=False),
        sa.Column('bought', sa.Float(), nullable=False, server_default='0'),
        sa.Column('sold', sa.Float(), nullable=False, server_default='0'),
        sa.Column('bought_dd', sa.Float(), nullable=False, server_default='0'),
        sa.Column('sold_dd', sa.Float(), nullable=False, server_default='0'),
    )
    op.create_index('ix_flow_strike_sides_symbol_day', 'flow_strike_sides', ['symbol', 'day'])


def downgrade() -> None:
    op.drop_index('ix_flow_strike_sides_symbol_day', table_name='flow_strike_sides')
    op.drop_table('flow_strike_sides')
