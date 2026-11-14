"""Signal log: the live track record of Signal-scanner buys (hedge.signal_log)

Revision ID: 0015_signal_log
Revises: 0014_notifications
Create Date: 2026-11-14 22:00:00

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0015_signal_log'
down_revision = '0014_notifications'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'signal_log',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('day', sa.String(), nullable=False),
        sa.Column('symbol', sa.String(), nullable=False),
        sa.Column('kind', sa.String(), nullable=False),
        sa.Column('trigger', sa.String(), nullable=False),
        sa.Column('price', sa.Float(), nullable=False),
        sa.Column('fear_score', sa.Float(), nullable=True),
        sa.Column('ret5', sa.Float(), nullable=True),
        sa.Column('universe', sa.String(), nullable=True),
        sa.Column('created_at', sa.String(), nullable=False),
        sa.UniqueConstraint('day', 'symbol', 'kind', 'trigger', name='uq_signal_log'),
    )
    op.create_index('ix_signal_log_day', 'signal_log', ['day'])


def downgrade() -> None:
    op.drop_index('ix_signal_log_day', table_name='signal_log')
    op.drop_table('signal_log')
