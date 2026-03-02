"""add merchant to budget and card_name to credit_card_weeks

Revision ID: 0017
Revises: 0016
Create Date: 2026-03-01
"""
from alembic import op
import sqlalchemy as sa

revision = '0017'
down_revision = '0016'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('budget') as batch_op:
        batch_op.add_column(sa.Column('merchant', sa.String(), nullable=True))

    with op.batch_alter_table('credit_card_weeks') as batch_op:
        batch_op.add_column(sa.Column('card_name', sa.String(), nullable=True))


def downgrade():
    with op.batch_alter_table('budget') as batch_op:
        batch_op.drop_column('merchant')

    with op.batch_alter_table('credit_card_weeks') as batch_op:
        batch_op.drop_column('card_name')
