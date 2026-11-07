"""Add per-account sub-values to weekly_snapshots

Revision ID: 0020
Revises: 0019
Create Date: 2026-03-14

Adds three account-value + label columns so users can enter values from
each broker individually; account_value is kept as the auto-computed sum.
"""
from alembic import op
import sqlalchemy as sa

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("weekly_snapshots") as batch_op:
        batch_op.add_column(sa.Column("acct_label_1", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("acct_val_1",   sa.Float(),  nullable=True))
        batch_op.add_column(sa.Column("acct_label_2", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("acct_val_2",   sa.Float(),  nullable=True))
        batch_op.add_column(sa.Column("acct_label_3", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("acct_val_3",   sa.Float(),  nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("weekly_snapshots") as batch_op:
        batch_op.drop_column("acct_val_3")
        batch_op.drop_column("acct_label_3")
        batch_op.drop_column("acct_val_2")
        batch_op.drop_column("acct_label_2")
        batch_op.drop_column("acct_val_1")
        batch_op.drop_column("acct_label_1")
