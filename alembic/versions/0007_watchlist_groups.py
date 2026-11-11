"""named watchlists (up to 20 per user), seeded one per sector, with per-list columns

Revision ID: 0007_watchlist_groups
Revises: 0006_reports
Create Date: 2026-11-11 14:00:00

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0007_watchlist_groups'
down_revision = '0006_reports'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('watchlist_groups',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('kind', sa.String(), nullable=False),
    sa.Column('sector', sa.String(), nullable=True),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('symbols', sa.Text(), nullable=False),
    sa.Column('columns', sa.Text(), nullable=True),
    sa.Column('created_at', sa.String(), nullable=False),
    sa.Column('updated_at', sa.String(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('watchlist_groups', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_watchlist_groups_user_id'), ['user_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('watchlist_groups', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_watchlist_groups_user_id'))
    op.drop_table('watchlist_groups')
