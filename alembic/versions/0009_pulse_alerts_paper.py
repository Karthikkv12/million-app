"""price alerts and paper trades (pulse module, C-98 items 2-3)

Revision ID: 0009_pulse_alerts_paper
Revises: 0008_strategy_settings
Create Date: 2026-11-12 03:00:00

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0009_pulse_alerts_paper'
down_revision = '0008_strategy_settings'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('price_alerts',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('symbol', sa.String(), nullable=False),
    sa.Column('price', sa.Float(), nullable=False),
    sa.Column('direction', sa.String(), nullable=False),
    sa.Column('note', sa.String(), nullable=True),
    sa.Column('created_at', sa.String(), nullable=False),
    sa.Column('triggered_at', sa.String(), nullable=True),
    sa.Column('triggered_price', sa.Float(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('price_alerts', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_price_alerts_user_id'), ['user_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_price_alerts_symbol'), ['symbol'], unique=False)

    op.create_table('paper_trades',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('symbol', sa.String(), nullable=False),
    sa.Column('side', sa.String(), nullable=False),
    sa.Column('qty', sa.Float(), nullable=False),
    sa.Column('entry', sa.Float(), nullable=False),
    sa.Column('stop', sa.Float(), nullable=True),
    sa.Column('target', sa.Float(), nullable=True),
    sa.Column('status', sa.String(), nullable=False),
    sa.Column('note', sa.String(), nullable=True),
    sa.Column('created_at', sa.String(), nullable=False),
    sa.Column('opened_at', sa.String(), nullable=True),
    sa.Column('closed_at', sa.String(), nullable=True),
    sa.Column('exit_price', sa.Float(), nullable=True),
    sa.Column('created_price', sa.Float(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('paper_trades', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_paper_trades_user_id'), ['user_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_paper_trades_symbol'), ['symbol'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('paper_trades', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_paper_trades_symbol'))
        batch_op.drop_index(batch_op.f('ix_paper_trades_user_id'))
    op.drop_table('paper_trades')
    with op.batch_alter_table('price_alerts', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_price_alerts_symbol'))
        batch_op.drop_index(batch_op.f('ix_price_alerts_user_id'))
    op.drop_table('price_alerts')
