"""
logic/watchlist.py — Watchlist service layer.

Clean, single-responsibility module that manages the watchlist_symbols table.

Public API
----------
list_watchlist(user_id)             → list of symbol dicts, active only
upsert_symbol(user_id, symbol, ...) → insert or reactivate + update metadata
remove_symbol(user_id, symbol)      → soft-delete (is_active=False)
bulk_register(user_id, symbols, source)
    → register a batch of symbols from positions/holdings (no-ops if already present)
sync_from_positions(user_id)        → scan all OptionPositions, register any missing symbols
sync_from_holdings(user_id)         → scan all StockHoldings, register any missing symbols
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from logic.services import _portfolio_session
from database.models import WatchlistSymbol, OptionPosition, StockHolding


SymbolSource = Literal["manual", "position", "holding"]

# ── Serializer ────────────────────────────────────────────────────────────────

def _to_dict(w: WatchlistSymbol) -> dict:
    return {
        "id":           w.id,
        "symbol":       w.symbol,
        "company_name": w.company_name,
        "source":       w.source,
        "notes":        w.notes,
        "is_active":    w.is_active,
        "added_at":     w.added_at.isoformat() if w.added_at else None,
        "updated_at":   w.updated_at.isoformat() if w.updated_at else None,
    }


# ── Read ──────────────────────────────────────────────────────────────────────

def list_watchlist(*, user_id: int, include_inactive: bool = False) -> list[dict]:
    """Return all watchlist entries for the user, sorted by symbol."""
    session = _portfolio_session()
    try:
        q = session.query(WatchlistSymbol).filter(
            WatchlistSymbol.user_id == user_id,
        )
        if not include_inactive:
            q = q.filter(WatchlistSymbol.is_active == True)  # noqa: E712
        rows = q.order_by(WatchlistSymbol.symbol).all()
        return [_to_dict(r) for r in rows]
    finally:
        session.close()


# ── Write ─────────────────────────────────────────────────────────────────────

def upsert_symbol(
    *,
    user_id: int,
    symbol: str,
    company_name: str | None = None,
    source: SymbolSource = "manual",
    notes: str | None = None,
) -> dict:
    """
    Insert a new watchlist entry, or re-activate it if it was soft-deleted.

    Source priority: manual > position > holding.
    If the row already exists with a higher-priority source, we leave the
    source unchanged.  Company name is updated whenever a non-None value
    is provided.
    """
    symbol = symbol.upper().strip()
    SOURCE_PRIORITY = {"manual": 3, "position": 2, "holding": 1}

    session = _portfolio_session()
    try:
        row = session.query(WatchlistSymbol).filter(
            WatchlistSymbol.user_id == user_id,
            WatchlistSymbol.symbol == symbol,
        ).first()

        now = datetime.utcnow()

        if row is None:
            row = WatchlistSymbol(
                user_id=user_id,
                symbol=symbol,
                company_name=company_name,
                source=source,
                notes=notes,
                is_active=True,
                added_at=now,
                updated_at=now,
            )
            session.add(row)
        else:
            # Reactivate if soft-deleted
            row.is_active = True
            # Upgrade source only if new source has higher priority
            if SOURCE_PRIORITY.get(source, 0) > SOURCE_PRIORITY.get(row.source, 0):
                row.source = source
            # Update optional fields
            if company_name is not None:
                row.company_name = company_name
            if notes is not None:
                row.notes = notes
            row.updated_at = now

        session.commit()
        session.refresh(row)
        return _to_dict(row)
    finally:
        session.close()


def remove_symbol(*, user_id: int, symbol: str) -> None:
    """Soft-delete: mark is_active=False.  Symbol history is preserved."""
    symbol = symbol.upper().strip()
    session = _portfolio_session()
    try:
        row = session.query(WatchlistSymbol).filter(
            WatchlistSymbol.user_id == user_id,
            WatchlistSymbol.symbol == symbol,
        ).first()
        if row:
            row.is_active = False
            row.updated_at = datetime.utcnow()
            session.commit()
    finally:
        session.close()


def bulk_register(
    *,
    user_id: int,
    symbols: list[str],
    source: SymbolSource,
) -> None:
    """
    Register a batch of symbols (e.g. from a positions or holdings sync).
    Existing active entries are left unchanged; soft-deleted ones are
    reactivated only if the source priority warrants it.
    Uses a single session for efficiency.
    """
    SOURCE_PRIORITY = {"manual": 3, "position": 2, "holding": 1}
    now = datetime.utcnow()
    clean = [s.upper().strip() for s in symbols if s and s.strip()]
    if not clean:
        return

    session = _portfolio_session()
    try:
        # Load all existing rows for these symbols in one query
        existing = {
            row.symbol: row
            for row in session.query(WatchlistSymbol).filter(
                WatchlistSymbol.user_id == user_id,
                WatchlistSymbol.symbol.in_(clean),
            ).all()
        }

        for sym in clean:
            row = existing.get(sym)
            if row is None:
                row = WatchlistSymbol(
                    user_id=user_id,
                    symbol=sym,
                    source=source,
                    is_active=True,
                    added_at=now,
                    updated_at=now,
                )
                session.add(row)
            else:
                if not row.is_active:
                    row.is_active = True
                    row.updated_at = now
                if SOURCE_PRIORITY.get(source, 0) > SOURCE_PRIORITY.get(row.source, 0):
                    row.source = source
                    row.updated_at = now

        session.commit()
    finally:
        session.close()


# ── Sync helpers ──────────────────────────────────────────────────────────────

def sync_from_positions(*, user_id: int) -> int:
    """
    Scan ALL OptionPositions for this user and register any symbols not yet
    in the watchlist.  Returns the count of newly added/reactivated symbols.
    """
    session = _portfolio_session()
    try:
        symbols = [
            row.symbol
            for row in session.query(OptionPosition.symbol)
            .filter(OptionPosition.user_id == user_id)
            .distinct()
            .all()
        ]
    finally:
        session.close()

    before = {r["symbol"] for r in list_watchlist(user_id=user_id)}
    bulk_register(user_id=user_id, symbols=symbols, source="position")
    after  = {r["symbol"] for r in list_watchlist(user_id=user_id)}
    return len(after - before)


def sync_from_holdings(*, user_id: int) -> int:
    """
    Scan ALL StockHoldings for this user and register any symbols not yet
    in the watchlist.  Returns the count of newly added/reactivated symbols.
    """
    session = _portfolio_session()
    try:
        symbols = [
            row.symbol
            for row in session.query(StockHolding.symbol)
            .filter(StockHolding.user_id == user_id)
            .distinct()
            .all()
        ]
    finally:
        session.close()

    before = {r["symbol"] for r in list_watchlist(user_id=user_id)}
    bulk_register(user_id=user_id, symbols=symbols, source="holding")
    after  = {r["symbol"] for r in list_watchlist(user_id=user_id)}
    return len(after - before)
