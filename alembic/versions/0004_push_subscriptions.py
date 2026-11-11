"""push subscriptions for phone notifications (notify module)

Revision ID: 0004_push_subscriptions
Revises: 0003_broker_positions
Create Date: 2026-11-09 03:00:00

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0004_push_subscriptions'
down_revision = '0003_broker_positions'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('push_subscriptions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('endpoint', sa.String(), nullable=False),
    sa.Column('p256dh', sa.String(), nullable=False),
    sa.Column('auth', sa.String(), nullable=False),
    sa.Column('user_agent', sa.String(), nullable=True),
    sa.Column('created_at', sa.String(), nullable=False),
    sa.Column('last_ok_at', sa.String(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('endpoint')
    )
    with op.batch_alter_table('push_subscriptions', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_push_subscriptions_user_id'), ['user_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('push_subscriptions', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_push_subscriptions_user_id'))
    op.drop_table('push_subscriptions')
