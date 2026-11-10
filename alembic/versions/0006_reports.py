"""daily report pages pushed by scheduled tasks

Revision ID: 0006_reports
Revises: 0005_push_prefs
Create Date: 2026-11-10 12:00:00

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0006_reports'
down_revision = '0005_push_prefs'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('reports',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('slug', sa.String(), nullable=False),
    sa.Column('title', sa.String(), nullable=False),
    sa.Column('html', sa.Text(), nullable=False),
    sa.Column('source_url', sa.String(), nullable=True),
    sa.Column('published_at', sa.String(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'slug', name='uq_reports_user_slug')
    )
    with op.batch_alter_table('reports', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_reports_user_id'), ['user_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('reports', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_reports_user_id'))
    op.drop_table('reports')
