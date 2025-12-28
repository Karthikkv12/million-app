"""accounts and holdings

Revision ID: 0008_accounts_and_holdings
Revises: 0007_refresh_token_metadata
Create Date: 2025-12-28

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0008_accounts_and_holdings"
down_revision = "0007_refresh_token_metadata"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "accounts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("broker", sa.String(), nullable=True),
        sa.Column("currency", sa.String(), nullable=False, server_default="USD"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_accounts_user_id", "accounts", ["user_id"], unique=False)

    op.create_table(
        "holdings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("symbol", sa.String(), nullable=False),
        sa.Column("quantity", sa.Float(), nullable=False, server_default="0"),
        sa.Column("avg_cost", sa.Float(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_holdings_user_id", "holdings", ["user_id"], unique=False)
    op.create_index("ix_holdings_account_id", "holdings", ["account_id"], unique=False)
    op.create_index("ix_holdings_symbol", "holdings", ["symbol"], unique=False)
    op.create_index("ix_holdings_updated_at", "holdings", ["updated_at"], unique=False)
    op.create_unique_constraint(
        "ux_holdings_user_account_symbol",
        "holdings",
        ["user_id", "account_id", "symbol"],
    )


def downgrade() -> None:
    op.drop_constraint("ux_holdings_user_account_symbol", "holdings", type_="unique")
    op.drop_index("ix_holdings_updated_at", table_name="holdings")
    op.drop_index("ix_holdings_symbol", table_name="holdings")
    op.drop_index("ix_holdings_account_id", table_name="holdings")
    op.drop_index("ix_holdings_user_id", table_name="holdings")
    op.drop_table("holdings")

    op.drop_index("ix_accounts_user_id", table_name="accounts")
    op.drop_table("accounts")
