"""broker sync tables: positions, account snapshots, activity (hedge + portfolio)

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

    op.create_table('broker_account_snapshots',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('source', sa.String(), nullable=False),
    sa.Column('account', sa.String(), nullable=False),
    sa.Column('day', sa.String(), nullable=False),
    sa.Column('total_value', sa.Float(), nullable=True),
    sa.Column('equity_value', sa.Float(), nullable=True),
    sa.Column('options_value', sa.Float(), nullable=True),
    sa.Column('crypto_value', sa.Float(), nullable=True),
    sa.Column('cash', sa.Float(), nullable=True),
    sa.Column('buying_power', sa.Float(), nullable=True),
    sa.Column('synced_at', sa.String(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('broker_account_snapshots', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_broker_account_snapshots_user_id'), ['user_id'], unique=False)
        batch_op.create_index('ux_broker_snap_user_acct_day', ['user_id', 'source', 'account', 'day'], unique=True)

    op.create_table('broker_activity',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('source', sa.String(), nullable=False),
    sa.Column('ext_id', sa.String(), nullable=False),
    sa.Column('account', sa.String(), nullable=True),
    sa.Column('kind', sa.String(), nullable=False),
    sa.Column('ts', sa.String(), nullable=False),
    sa.Column('symbol', sa.String(), nullable=False),
    sa.Column('side', sa.String(), nullable=True),
    sa.Column('position_effect', sa.String(), nullable=True),
    sa.Column('option_type', sa.String(), nullable=True),
    sa.Column('strike', sa.Float(), nullable=True),
    sa.Column('expiry', sa.String(), nullable=True),
    sa.Column('quantity', sa.Float(), nullable=True),
    sa.Column('price', sa.Float(), nullable=True),
    sa.Column('amount', sa.Float(), nullable=True),
    sa.Column('realized_gain', sa.Float(), nullable=True),
    sa.Column('strategy', sa.String(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('broker_activity', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_broker_activity_user_id'), ['user_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_broker_activity_ts'), ['ts'], unique=False)
        batch_op.create_index(batch_op.f('ix_broker_activity_symbol'), ['symbol'], unique=False)
        batch_op.create_index('ux_broker_activity_ext', ['user_id', 'source', 'ext_id'], unique=True)


def downgrade() -> None:
    with op.batch_alter_table('broker_activity', schema=None) as batch_op:
        batch_op.drop_index('ux_broker_activity_ext')
        batch_op.drop_index(batch_op.f('ix_broker_activity_symbol'))
        batch_op.drop_index(batch_op.f('ix_broker_activity_ts'))
        batch_op.drop_index(batch_op.f('ix_broker_activity_user_id'))
    op.drop_table('broker_activity')
    with op.batch_alter_table('broker_account_snapshots', schema=None) as batch_op:
        batch_op.drop_index('ux_broker_snap_user_acct_day')
        batch_op.drop_index(batch_op.f('ix_broker_account_snapshots_user_id'))
    op.drop_table('broker_account_snapshots')
    with op.batch_alter_table('broker_positions', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_broker_positions_symbol'))
        batch_op.drop_index(batch_op.f('ix_broker_positions_user_id'))
    op.drop_table('broker_positions')
