"""add active_until to budget for recurring end-date

Revision ID: 0018
Revises: 0017
Create Date: 2026-03-01
"""
from alembic import op
import sqlalchemy as sa

revision = '0018'
down_revision = '0017'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('budget', schema=None) as batch_op:
        batch_op.add_column(sa.Column('active_until', sa.String(), nullable=True))


def downgrade():
    with op.batch_alter_table('budget', schema=None) as batch_op:
        batch_op.drop_column('active_until')
