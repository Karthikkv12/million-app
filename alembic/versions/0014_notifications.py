"""Notification Center: every alert raised for a user, read or not (notify module)

Revision ID: 0014_notifications
Revises: 0013_flow_atm_iv
Create Date: 2026-11-14 12:00:00

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0014_notifications'
down_revision = '0013_flow_atm_iv'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'notifications',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('kind', sa.String(), nullable=False),
        sa.Column('symbol', sa.String(), nullable=True),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('body', sa.Text(), nullable=True),
        sa.Column('url', sa.String(), nullable=True),
        sa.Column('key', sa.String(), nullable=False),
        sa.Column('created_at', sa.String(), nullable=False),
        sa.Column('read_at', sa.String(), nullable=True),
        sa.UniqueConstraint('user_id', 'key', name='uq_notifications_user_key'),
    )
    op.create_index('ix_notifications_user_created', 'notifications', ['user_id', 'created_at'])


def downgrade() -> None:
    op.drop_index('ix_notifications_user_created', table_name='notifications')
    op.drop_table('notifications')
