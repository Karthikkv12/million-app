"""identity security and idempotency

Revision ID: 0003_identity_security_and_idempotency
Revises: 0002_trade_close_fields
Create Date: 2025-12-28

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0003_identity_security_and_idempotency"
down_revision = "0002_trade_close_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Trades: idempotent order submission
    op.add_column("trades", sa.Column("client_order_id", sa.String(), nullable=True))
    op.create_index(
        "ux_trades_user_client_order_id",
        "trades",
        ["user_id", "client_order_id"],
        unique=True,
    )

    # Token revocation (logout)
    op.create_table(
        "revoked_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("jti", sa.String(), nullable=False, unique=True, index=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_revoked_tokens_user_id", "revoked_tokens", ["user_id"], unique=False)
    op.create_index("ix_revoked_tokens_expires_at", "revoked_tokens", ["expires_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_revoked_tokens_expires_at", table_name="revoked_tokens")
    op.drop_index("ix_revoked_tokens_user_id", table_name="revoked_tokens")
    op.drop_table("revoked_tokens")

    op.drop_index("ux_trades_user_client_order_id", table_name="trades")
    with op.batch_alter_table("trades") as batch:
        batch.drop_column("client_order_id")
