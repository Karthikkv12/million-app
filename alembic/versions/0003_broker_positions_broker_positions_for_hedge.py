"""broker_positions for the hedge module

Revision ID: 0003_broker_positions
Revises: 0002_gex_snapshots
Create Date: 2026-11-08 18:00:00

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0003_broker_positions'
down_revision = '0002_gex_snapshots'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('broker_positions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('source', sa.String(), nullable=False),
    sa.Column('account', sa.String(), nullable=True),
    sa.Column('symbol', sa.String(), nullable=False),
    sa.Column('kind', sa.String(), nullable=False),
    sa.Column('quantity', sa.Float(), nullable=False),
    sa.Column('avg_price', sa.Float(), nullable=True),
    sa.Column('option_type', sa.String(), nullable=True),
    sa.Column('strike', sa.Float(), nullable=True),
    sa.Column('expiry', sa.String(), nullable=True),
    sa.Column('multiplier', sa.Float(), nullable=False),
    sa.Column('opened_at', sa.String(), nullable=True),
    sa.Column('synced_at', sa.String(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('broker_positions', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_broker_positions_user_id'), ['user_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_broker_positions_symbol'), ['symbol'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('broker_positions', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_broker_positions_symbol'))
        batch_op.drop_index(batch_op.f('ix_broker_positions_user_id'))
    op.drop_table('broker_positions')
