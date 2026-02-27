"""
Premium Ledger logic.

The PremiumLedger table is the single source of truth for every dollar of
option premium sold against a stock holding.  One row per (holding × position).

Key rules:
  - ACTIVE position  → unrealized_premium = premium_sold,  realized_premium = 0
  - CLOSED/EXPIRED   → unrealized_premium = 0,  realized_premium = net_credit
      net_credit = (premium_in × contracts × 100) + (premium_out × contracts × 100)
      premium_out is the buyback debit (stored as negative), so adding it gives net.
  - ASSIGNED (CC)    → same as CLOSED — premium locked in
  - ROLLED           → closed leg is realized, new leg becomes a new ACTIVE row

Derived holdings basis:
  adj_basis (stored)  = cost_basis  − SUM(realized_premium)  / shares
  live_adj_basis      = adj_basis   − SUM(unrealized_premium) / shares
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from logic.services import get_session
from database.models import (
    PremiumLedger,
    StockHolding,
    OptionPosition,
    OptionPositionStatus,
)

# ── Helpers ───────────────────────────────────────────────────────────────────

_REALIZED_STATUSES = {
    OptionPositionStatus.CLOSED,
    OptionPositionStatus.EXPIRED,
    OptionPositionStatus.ASSIGNED,
    OptionPositionStatus.ROLLED,
}
_ACTIVE_STATUS = OptionPositionStatus.ACTIVE


def _compute_premiums(pos: OptionPosition) -> tuple[float, float]:
    """
    Returns (realized_premium, unrealized_premium) total dollar amounts.
    premium_in  = credit received when position was opened (positive)
    premium_out = debit paid to close/buy back (negative, stored as-is)
    """
    prem_in  = (pos.premium_in  or 0.0) * pos.contracts * 100
    prem_out = (pos.premium_out or 0.0) * pos.contracts * 100  # already negative
    gross    = prem_in + prem_out  # net credit (prem_out is negative)
    gross    = max(0.0, gross)     # can't realize a negative credit

    if pos.status in _REALIZED_STATUSES:
        return round(gross, 4), 0.0
    else:  # ACTIVE
        return 0.0, round(prem_in, 4)   # unrealized = full premium_in (buyback not yet known)


# ── Upsert single row ─────────────────────────────────────────────────────────

def upsert_ledger_row(*, user_id: int, position_id: int, session=None) -> dict | None:
    """
    Create or update the PremiumLedger row for one position.
    If session is passed in, the caller owns commit; otherwise auto-commits.
    """
    own_session = session is None
    if own_session:
        session = get_session()
    try:
        pos = session.query(OptionPosition).filter(
            OptionPosition.id == position_id,
            OptionPosition.user_id == user_id,
        ).first()
        if pos is None or pos.holding_id is None:
            return None  # nothing to do if position isn't linked to a holding

        realized, unrealized = _compute_premiums(pos)
        prem_sold = (pos.premium_in or 0.0) * pos.contracts * 100

        existing = session.query(PremiumLedger).filter(
            PremiumLedger.holding_id  == pos.holding_id,
            PremiumLedger.position_id == pos.id,
        ).first()

        now = datetime.utcnow()
        if existing:
            existing.premium_sold       = prem_sold
            existing.realized_premium   = realized
            existing.unrealized_premium = unrealized
            existing.status             = pos.status.value
            existing.updated_at         = now
            row = existing
        else:
            row = PremiumLedger(
                user_id             = user_id,
                holding_id          = pos.holding_id,
                position_id         = pos.id,
                symbol              = pos.symbol,
                week_id             = pos.week_id,
                option_type         = (pos.option_type or "").upper(),
                strike              = pos.strike,
                contracts           = pos.contracts,
                expiry_date         = pos.expiry_date,
                premium_sold        = prem_sold,
                realized_premium    = realized,
                unrealized_premium  = unrealized,
                status              = pos.status.value,
                created_at          = now,
                updated_at          = now,
            )
            session.add(row)

        if own_session:
            session.commit()
            session.refresh(row)

        return _row_to_dict(row)
    finally:
        if own_session:
            session.close()


# ── Sync all positions for a user (or holding) ───────────────────────────────

def sync_ledger_from_positions(*, user_id: int, holding_id: int | None = None) -> dict:
    """
    Full rebuild of PremiumLedger rows from OptionPosition data.
    Safe to call repeatedly — purely idempotent upserts.

    Args:
        user_id:    Required.
        holding_id: Optional — limits sync to one holding.

    Returns:
        {"upserted": N, "rows": [...]}
    """
    session = get_session()
    try:
        q = session.query(OptionPosition).filter(
            OptionPosition.user_id    == user_id,
            OptionPosition.holding_id != None,  # noqa: E711
        )
        if holding_id is not None:
            q = q.filter(OptionPosition.holding_id == holding_id)
        positions = q.all()

        upserted = 0
        rows = []
        now = datetime.utcnow()

        for pos in positions:
            realized, unrealized = _compute_premiums(pos)
            prem_sold = (pos.premium_in or 0.0) * pos.contracts * 100

            existing = session.query(PremiumLedger).filter(
                PremiumLedger.holding_id  == pos.holding_id,
                PremiumLedger.position_id == pos.id,
            ).first()

            if existing:
                existing.premium_sold       = prem_sold
                existing.realized_premium   = realized
                existing.unrealized_premium = unrealized
                existing.status             = pos.status.value
                existing.updated_at         = now
                rows.append(_row_to_dict(existing))
            else:
                row = PremiumLedger(
                    user_id             = user_id,
                    holding_id          = pos.holding_id,
                    position_id         = pos.id,
                    symbol              = pos.symbol,
                    week_id             = pos.week_id,
                    option_type         = (pos.option_type or "").upper(),
                    strike              = pos.strike,
                    contracts           = pos.contracts,
                    expiry_date         = pos.expiry_date,
                    premium_sold        = prem_sold,
                    realized_premium    = realized,
                    unrealized_premium  = unrealized,
                    status              = pos.status.value,
                    created_at          = now,
                    updated_at          = now,
                )
                session.add(row)
                session.flush()
                rows.append(_row_to_dict(row))
            upserted += 1

        session.commit()
        return {"upserted": upserted, "rows": rows}
    finally:
        session.close()


# ── Query helpers ─────────────────────────────────────────────────────────────

def get_premium_summary(*, holding_id: int, session=None) -> dict:
    """
    Returns aggregated premium totals for a holding.

      realized_premium   — sum of all CLOSED/EXPIRED premiums (locked in)
      unrealized_premium — sum of all ACTIVE in-flight premiums
      total_premium_sold — gross credit ever sold (realized + original unrealized)
      rows               — individual ledger rows
    """
    own_session = session is None
    if own_session:
        session = get_session()
    try:
        rows = (
            session.query(PremiumLedger)
            .filter(PremiumLedger.holding_id == holding_id)
            .order_by(PremiumLedger.created_at)
            .all()
        )
        realized   = sum(r.realized_premium   for r in rows)
        unrealized = sum(r.unrealized_premium for r in rows)
        sold       = sum(r.premium_sold       for r in rows)
        return {
            "holding_id":          holding_id,
            "realized_premium":    round(realized,   4),
            "unrealized_premium":  round(unrealized, 4),
            "total_premium_sold":  round(sold,       4),
            "rows":                [_row_to_dict(r) for r in rows],
        }
    finally:
        if own_session:
            session.close()


def get_all_premium_summaries(*, user_id: int) -> dict[int, dict]:
    """Returns {holding_id: summary_dict} for all holdings of a user."""
    session = get_session()
    try:
        rows = (
            session.query(PremiumLedger)
            .filter(PremiumLedger.user_id == user_id)
            .order_by(PremiumLedger.holding_id, PremiumLedger.created_at)
            .all()
        )
        summaries: dict[int, dict] = {}
        for r in rows:
            hid = r.holding_id
            if hid not in summaries:
                summaries[hid] = {
                    "holding_id":         hid,
                    "realized_premium":   0.0,
                    "unrealized_premium": 0.0,
                    "total_premium_sold": 0.0,
                    "rows":               [],
                }
            summaries[hid]["realized_premium"]   += r.realized_premium
            summaries[hid]["unrealized_premium"]  += r.unrealized_premium
            summaries[hid]["total_premium_sold"]  += r.premium_sold
            summaries[hid]["rows"].append(_row_to_dict(r))

        # Round totals
        for s in summaries.values():
            s["realized_premium"]   = round(s["realized_premium"],   4)
            s["unrealized_premium"] = round(s["unrealized_premium"], 4)
            s["total_premium_sold"] = round(s["total_premium_sold"], 4)
        return summaries
    finally:
        session.close()


# ── Serialiser ────────────────────────────────────────────────────────────────

def _row_to_dict(r: PremiumLedger) -> dict:
    return {
        "id":                  r.id,
        "holding_id":          r.holding_id,
        "position_id":         r.position_id,
        "symbol":              r.symbol,
        "week_id":             r.week_id,
        "option_type":         r.option_type,
        "strike":              r.strike,
        "contracts":           r.contracts,
        "expiry_date":         r.expiry_date.isoformat() if r.expiry_date else None,
        "premium_sold":        r.premium_sold,
        "realized_premium":    r.realized_premium,
        "unrealized_premium":  r.unrealized_premium,
        "status":              r.status,
        "created_at":          r.created_at.isoformat(),
        "updated_at":          r.updated_at.isoformat(),
    }
