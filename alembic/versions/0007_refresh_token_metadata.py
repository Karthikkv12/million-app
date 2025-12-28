"""refresh token metadata

Revision ID: 0007_refresh_token_metadata
Revises: 0006_auth_events
Create Date: 2025-12-28

"""

from alembic import op
import sqlalchemy as sa


revision = "0007_refresh_token_metadata"
down_revision = "0006_auth_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("refresh_tokens") as batch:
        batch.add_column(sa.Column("created_ip", sa.String(), nullable=True))
        batch.add_column(sa.Column("created_user_agent", sa.String(), nullable=True))
        batch.add_column(sa.Column("last_used_at", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("last_used_ip", sa.String(), nullable=True))
        batch.add_column(sa.Column("last_used_user_agent", sa.String(), nullable=True))
        batch.add_column(sa.Column("revoked_reason", sa.String(), nullable=True))

    op.create_index("ix_refresh_tokens_created_ip", "refresh_tokens", ["created_ip"])
    op.create_index("ix_refresh_tokens_last_used_at", "refresh_tokens", ["last_used_at"])
    op.create_index("ix_refresh_tokens_last_used_ip", "refresh_tokens", ["last_used_ip"])


def downgrade() -> None:
    op.drop_index("ix_refresh_tokens_last_used_ip", table_name="refresh_tokens")
    op.drop_index("ix_refresh_tokens_last_used_at", table_name="refresh_tokens")
    op.drop_index("ix_refresh_tokens_created_ip", table_name="refresh_tokens")

    with op.batch_alter_table("refresh_tokens") as batch:
        batch.drop_column("revoked_reason")
        batch.drop_column("last_used_user_agent")
        batch.drop_column("last_used_ip")
        batch.drop_column("last_used_at")
        batch.drop_column("created_user_agent")
        batch.drop_column("created_ip")
