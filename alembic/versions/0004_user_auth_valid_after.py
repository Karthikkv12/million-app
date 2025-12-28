"""user auth valid after

Revision ID: 0004_user_auth_valid_after
Revises: 0003_identity_security_and_idempotency
Create Date: 2025-12-28

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0004_user_auth_valid_after"
down_revision = "0003_identity_security_and_idempotency"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Tokens with iat < auth_valid_after are invalid.
    op.add_column(
        "users",
        sa.Column(
            "auth_valid_after",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("'1970-01-01 00:00:00'"),
        ),
    )

    # Drop the server default after backfilling.
    with op.batch_alter_table("users") as batch:
        batch.alter_column("auth_valid_after", server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("auth_valid_after")
