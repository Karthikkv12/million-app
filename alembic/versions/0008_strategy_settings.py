"""per-user options strategy + scanner filters, and the scanner's picks

Revision ID: 0008_strategy_settings
Revises: 0007_watchlist_groups
Create Date: 2026-11-11 18:30:00

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0008_strategy_settings'
down_revision = '0007_watchlist_groups'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('strategy_settings',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('strategy', sa.String(), nullable=False),
    sa.Column('rules', sa.Text(), nullable=True),
    sa.Column('scanner', sa.Text(), nullable=True),
    sa.Column('notify', sa.Boolean(), nullable=False),
    sa.Column('updated_at', sa.String(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('strategy_settings', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_strategy_settings_user_id'), ['user_id'], unique=True)

    op.create_table('scanner_picks',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('day', sa.String(), nullable=False),
    sa.Column('key', sa.String(), nullable=False),
    sa.Column('symbol', sa.String(), nullable=False),
    sa.Column('strategy', sa.String(), nullable=False),
    sa.Column('score', sa.Float(), nullable=True),
    sa.Column('payload', sa.Text(), nullable=False),
    sa.Column('notified', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.String(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'day', 'key', name='uq_scanner_picks_user_day_key')
    )
    with op.batch_alter_table('scanner_picks', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_scanner_picks_user_id'), ['user_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('scanner_picks', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_scanner_picks_user_id'))
    op.drop_table('scanner_picks')
    with op.batch_alter_table('strategy_settings', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_strategy_settings_user_id'))
    op.drop_table('strategy_settings')
