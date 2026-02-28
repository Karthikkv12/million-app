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
        if pos.carried_from_id is not None:
            # This is a carry-forward copy — the original already has a ledger row.
            # Update the original's ledger row with current status instead.
            position_id = pos.carried_from_id
            pos = session.query(OptionPosition).filter(
                OptionPosition.id == position_id,
            ).first()
            if pos is None:
                return None

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

    IMPORTANT: Only ORIGINAL positions are counted (carried_from_id IS NULL).
    Carry-forward copies exist so the current week's view shows active positions,
    but they represent the SAME option contract — counting them would double the premium.

    Args:
        user_id:    Required.
        holding_id: Optional — limits sync to one holding.

    Returns:
        {"upserted": N, "rows": [...]}
    """
    session = get_session()
    try:
        q = session.query(OptionPosition).filter(
            OptionPosition.user_id       == user_id,
            OptionPosition.holding_id    != None,   # noqa: E711
            OptionPosition.carried_from_id == None, # noqa: E711  only originals, not carry-forward copies
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


def get_premium_dashboard(*, user_id: int) -> dict:
    """
    Returns a full premium dashboard for the user:
      - by_symbol: per-ticker totals (realized, unrealized, total_sold, adj_basis_impact)
      - by_week:   per-week totals with per-symbol breakdown
      - grand_total: overall realized + unrealized + total_sold
      - rows: all individual ledger rows (for the detail table)
    """
    session = get_session()
    try:
        from database.models import StockHolding, WeeklySnapshot
        rows = (
            session.query(PremiumLedger)
            .filter(PremiumLedger.user_id == user_id)
            .order_by(PremiumLedger.symbol, PremiumLedger.week_id)
            .all()
        )

        # Fetch week labels
        week_map: dict[int, str] = {}
        all_week_ids = {r.week_id for r in rows if r.week_id}
        if all_week_ids:
            weeks = session.query(WeeklySnapshot).filter(
                WeeklySnapshot.id.in_(all_week_ids)
            ).all()
            for w in weeks:
                week_map[w.id] = w.week_end.strftime("%b %d, %Y") if w.week_end else str(w.id)

        # Fetch holding cost_basis and shares for adj_basis impact calc
        holding_map: dict[int, Any] = {}
        for r in rows:
            if r.holding_id not in holding_map:
                h = session.query(StockHolding).filter(StockHolding.id == r.holding_id).first()
                if h:
                    holding_map[r.holding_id] = {"cost_basis": h.cost_basis, "shares": h.shares, "symbol": h.symbol}

        # by_symbol
        by_symbol: dict[str, dict] = {}
        by_week: dict[int, dict] = {}

        for r in rows:
            sym = r.symbol
            if sym not in by_symbol:
                hinfo = holding_map.get(r.holding_id, {})
                by_symbol[sym] = {
                    "symbol":             sym,
                    "holding_id":         r.holding_id,
                    "cost_basis":         hinfo.get("cost_basis", 0.0),
                    "shares":             hinfo.get("shares", 0.0),
                    "realized_premium":   0.0,
                    "unrealized_premium": 0.0,
                    "total_premium_sold": 0.0,
                    "positions":          0,
                    "rows":               [],
                }
            by_symbol[sym]["realized_premium"]   += r.realized_premium
            by_symbol[sym]["unrealized_premium"]  += r.unrealized_premium
            by_symbol[sym]["total_premium_sold"]  += r.premium_sold
            by_symbol[sym]["positions"]           += 1
            by_symbol[sym]["rows"].append(_row_to_dict(r))

            wid = r.week_id or 0
            if wid not in by_week:
                by_week[wid] = {
                    "week_id":            wid,
                    "week_label":         week_map.get(wid, f"Week {wid}"),
                    "realized_premium":   0.0,
                    "unrealized_premium": 0.0,
                    "total_premium_sold": 0.0,
                    "symbols":            {},
                }
            by_week[wid]["realized_premium"]   += r.realized_premium
            by_week[wid]["unrealized_premium"]  += r.unrealized_premium
            by_week[wid]["total_premium_sold"]  += r.premium_sold
            if sym not in by_week[wid]["symbols"]:
                by_week[wid]["symbols"][sym] = {"realized": 0.0, "unrealized": 0.0, "sold": 0.0}
            by_week[wid]["symbols"][sym]["realized"]   += r.realized_premium
            by_week[wid]["symbols"][sym]["unrealized"] += r.unrealized_premium
            by_week[wid]["symbols"][sym]["sold"]       += r.premium_sold

        # Compute adj_basis_impact per symbol
        for sym, d in by_symbol.items():
            shares = d["shares"]
            d["realized_per_share"]   = round(d["realized_premium"]   / shares, 4) if shares > 0 else 0.0
            d["unrealized_per_share"] = round(d["unrealized_premium"] / shares, 4) if shares > 0 else 0.0
            d["live_adj_basis"]       = round(max(0.0, d["cost_basis"] - d["realized_per_share"] - d["unrealized_per_share"]), 4)
            d["adj_basis_stored"]     = round(max(0.0, d["cost_basis"] - d["realized_per_share"]), 4)
            d["realized_premium"]     = round(d["realized_premium"],   2)
            d["unrealized_premium"]   = round(d["unrealized_premium"], 2)
            d["total_premium_sold"]   = round(d["total_premium_sold"], 2)

        # Round week totals and convert symbols dict to list
        for wid, w in by_week.items():
            w["realized_premium"]   = round(w["realized_premium"],   2)
            w["unrealized_premium"] = round(w["unrealized_premium"], 2)
            w["total_premium_sold"] = round(w["total_premium_sold"], 2)
            w["symbols"] = [
                {"symbol": sym, **vals}
                for sym, vals in sorted(w["symbols"].items())
            ]

        grand_realized   = sum(d["realized_premium"]   for d in by_symbol.values())
        grand_unrealized = sum(d["unrealized_premium"] for d in by_symbol.values())
        grand_sold       = sum(d["total_premium_sold"] for d in by_symbol.values())

        return {
            "by_symbol":   sorted(by_symbol.values(), key=lambda x: -x["total_premium_sold"]),
            "by_week":     sorted(by_week.values(),   key=lambda x: x["week_id"]),
            "grand_total": {
                "realized_premium":   round(grand_realized,   2),
                "unrealized_premium": round(grand_unrealized, 2),
                "total_premium_sold": round(grand_sold,       2),
            },
        }
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
