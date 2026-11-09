"""notification prefs per device (which alerts, which symbols)

Revision ID: 0005_push_prefs
Revises: 0004_push_subscriptions
Create Date: 2026-11-09 04:30:00

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0005_push_prefs'
down_revision = '0004_push_subscriptions'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('push_subscriptions', schema=None) as batch_op:
        batch_op.add_column(sa.Column('prefs', sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('push_subscriptions', schema=None) as batch_op:
        batch_op.drop_column('prefs')
