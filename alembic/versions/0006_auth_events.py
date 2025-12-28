"""auth events

Revision ID: 0006_auth_events
Revises: 0005_refresh_tokens
Create Date: 2025-12-28

"""

from alembic import op
import sqlalchemy as sa


revision = "0006_auth_events"
down_revision = "0005_refresh_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "auth_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("event_type", sa.String(), nullable=False),
        sa.Column("success", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("username", sa.String(), nullable=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("ip", sa.String(), nullable=True),
        sa.Column("user_agent", sa.String(), nullable=True),
        sa.Column("detail", sa.String(), nullable=True),
    )
    op.create_index("ix_auth_events_created_at", "auth_events", ["created_at"])
    op.create_index("ix_auth_events_event_type", "auth_events", ["event_type"])
    op.create_index("ix_auth_events_success", "auth_events", ["success"])
    op.create_index("ix_auth_events_username", "auth_events", ["username"])
    op.create_index("ix_auth_events_user_id", "auth_events", ["user_id"])
    op.create_index("ix_auth_events_ip", "auth_events", ["ip"])


def downgrade() -> None:
    op.drop_index("ix_auth_events_ip", table_name="auth_events")
    op.drop_index("ix_auth_events_user_id", table_name="auth_events")
    op.drop_index("ix_auth_events_username", table_name="auth_events")
    op.drop_index("ix_auth_events_success", table_name="auth_events")
    op.drop_index("ix_auth_events_event_type", table_name="auth_events")
    op.drop_index("ix_auth_events_created_at", table_name="auth_events")
    op.drop_table("auth_events")
