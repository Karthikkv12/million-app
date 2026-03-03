"""add spot_price to option_positions for moneyness / extrinsic value calc

Revision ID: 0019
Revises: 0018
Create Date: 2026-03-02
"""
from alembic import op
import sqlalchemy as sa

revision = '0019'
down_revision = '0018'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('option_positions', schema=None) as batch_op:
        batch_op.add_column(sa.Column('spot_price', sa.Float(), nullable=True))


def downgrade():
    with op.batch_alter_table('option_positions', schema=None) as batch_op:
        batch_op.drop_column('spot_price')
