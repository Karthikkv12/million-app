"""Cash ledger foundation (double-entry).

Revision ID: 0011_cash_ledger_foundation
Revises: 0010_orders_external_linkage
Create Date: 2025-12-28

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0011_cash_ledger_foundation"
down_revision = "0010_orders_external_linkage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ledger_accounts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("type", sa.Enum("ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE", name="ledgeraccounttype"), nullable=False),
        sa.Column("currency", sa.String(), nullable=False, server_default="USD"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_ledger_accounts_user_id", "ledger_accounts", ["user_id"], unique=False)
    op.create_index("ix_ledger_accounts_type", "ledger_accounts", ["type"], unique=False)
    op.create_index("ix_ledger_accounts_created_at", "ledger_accounts", ["created_at"], unique=False)
    op.create_unique_constraint(
        "ux_ledger_accounts_user_name_currency",
        "ledger_accounts",
        ["user_id", "name", "currency"],
    )

    op.create_table(
        "ledger_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("entry_type", sa.Enum("CASH_DEPOSIT", "CASH_WITHDRAW", name="ledgerentrytype"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("effective_at", sa.DateTime(), nullable=True),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("idempotency_key", sa.String(), nullable=True),
        sa.Column("source_type", sa.String(), nullable=True),
        sa.Column("source_id", sa.Integer(), nullable=True),
    )
    op.create_index("ix_ledger_entries_user_id", "ledger_entries", ["user_id"], unique=False)
    op.create_index("ix_ledger_entries_entry_type", "ledger_entries", ["entry_type"], unique=False)
    op.create_index("ix_ledger_entries_created_at", "ledger_entries", ["created_at"], unique=False)
    op.create_index("ix_ledger_entries_effective_at", "ledger_entries", ["effective_at"], unique=False)
    op.create_index("ix_ledger_entries_source_type", "ledger_entries", ["source_type"], unique=False)
    op.create_index("ix_ledger_entries_source_id", "ledger_entries", ["source_id"], unique=False)
    op.create_unique_constraint(
        "ux_ledger_entries_user_idempotency_key",
        "ledger_entries",
        ["user_id", "idempotency_key"],
    )

    op.create_table(
        "ledger_lines",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("entry_id", sa.Integer(), sa.ForeignKey("ledger_entries.id"), nullable=False),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("ledger_accounts.id"), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("memo", sa.String(), nullable=True),
    )
    op.create_index("ix_ledger_lines_entry_id", "ledger_lines", ["entry_id"], unique=False)
    op.create_index("ix_ledger_lines_account_id", "ledger_lines", ["account_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_ledger_lines_account_id", table_name="ledger_lines")
    op.drop_index("ix_ledger_lines_entry_id", table_name="ledger_lines")
    op.drop_table("ledger_lines")

    op.drop_constraint("ux_ledger_entries_user_idempotency_key", "ledger_entries", type_="unique")
    op.drop_index("ix_ledger_entries_source_id", table_name="ledger_entries")
    op.drop_index("ix_ledger_entries_source_type", table_name="ledger_entries")
    op.drop_index("ix_ledger_entries_effective_at", table_name="ledger_entries")
    op.drop_index("ix_ledger_entries_created_at", table_name="ledger_entries")
    op.drop_index("ix_ledger_entries_entry_type", table_name="ledger_entries")
    op.drop_index("ix_ledger_entries_user_id", table_name="ledger_entries")
    op.drop_table("ledger_entries")

    op.drop_constraint("ux_ledger_accounts_user_name_currency", "ledger_accounts", type_="unique")
    op.drop_index("ix_ledger_accounts_created_at", table_name="ledger_accounts")
    op.drop_index("ix_ledger_accounts_type", table_name="ledger_accounts")
    op.drop_index("ix_ledger_accounts_user_id", table_name="ledger_accounts")
    op.drop_table("ledger_accounts")

    # best-effort cleanup of enum types (postgres)
    try:
        op.execute("DROP TYPE ledgerentrytype")
    except Exception:
        pass
    try:
        op.execute("DROP TYPE ledgeraccounttype")
    except Exception:
        pass
