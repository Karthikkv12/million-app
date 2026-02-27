"""
Stock Holdings logic.

Covers:
  - CRUD for stock lots (StockHolding)
  - Automatic triggers fired when an OptionPosition status changes:
      CC EXPIRED/CLOSED  → reduce adjusted_cost_basis (premium prorated to shares)
      CC ASSIGNED        → remove shares (contracts × 100), record realized gain
      CSP ASSIGNED       → add shares (contracts × 100), blend cost basis
  - Holding event audit log
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from logic.services import get_session
from database.models import (
    StockHolding,
    HoldingEvent,
    HoldingEventType,
    OptionPosition,
    OptionPositionStatus,
)


# ── Serialisers ───────────────────────────────────────────────────────────────

def _holding_to_dict(h: StockHolding, session=None) -> dict:
    """
    Serialize a StockHolding.

    When `session` is provided, fetches all linked OptionPositions to compute:

      live_adj_basis   — adjusted_cost_basis MINUS in-flight premium from ACTIVE
                         positions not yet closed.  This is what you effectively
                         own the stock at right now.

      downside_basis   — same as live_adj_basis (your true breakeven if price → 0).

      upside_basis     — strike of the lowest-strike ACTIVE covered call linked
                         to this holding.  If shares get called away you sell there.
                         None when no active CC is written.

      pending_premium  — total premium still "in flight" (ACTIVE positions)
                         per share; reduces from live_adj_basis once they close.
    """
    adj = h.adjusted_cost_basis
    live_adj = adj
    upside_basis: float | None = None
    pending_premium_total = 0.0

    if session is not None and h.id:
        active_positions = (
            session.query(OptionPosition)
            .filter(
                OptionPosition.holding_id == h.id,
                OptionPosition.status == OptionPositionStatus.ACTIVE,
            )
            .all()
        )
        if active_positions and h.shares > 0:
            cc_strikes: list[float] = []
            for p in active_positions:
                prem = (p.premium_in or 0.0)
                # Net of any roll debit
                net_prem_per_contract = prem + (p.premium_out or 0.0)
                # Total collected for this position
                prem_total = net_prem_per_contract * p.contracts * 100
                pending_premium_total += prem_total

                # Track strikes of active CCs for upside ceiling
                if (p.option_type or "").upper() == "CALL":
                    cc_strikes.append(float(p.strike))

            # live adj basis = stored adj basis minus in-flight premium per share
            live_adj = max(0.0, adj - (pending_premium_total / h.shares))

            # Upside ceiling = lowest active CC strike
            if cc_strikes:
                upside_basis = min(cc_strikes)

    basis_reduction_stored = round((h.cost_basis - adj) * h.shares, 2)
    basis_reduction_live   = round((h.cost_basis - live_adj) * h.shares, 2)

    return {
        "id":                   h.id,
        "symbol":               h.symbol,
        "company_name":         h.company_name,
        "shares":               h.shares,
        "cost_basis":           h.cost_basis,
        "adjusted_cost_basis":  adj,          # stored (only closed/expired positions)
        "live_adj_basis":       round(live_adj, 4),   # includes in-flight premium
        "upside_basis":         round(upside_basis, 2) if upside_basis is not None else None,
        "downside_basis":       round(live_adj, 4),   # breakeven if stock → 0
        "pending_premium":      round(pending_premium_total, 2),
        "acquired_date":        h.acquired_date.isoformat() if h.acquired_date else None,
        "status":               h.status,
        "notes":                h.notes,
        "created_at":           h.created_at.isoformat(),
        "updated_at":           h.updated_at.isoformat(),
        # Computed
        "total_original_cost":  round(h.cost_basis * h.shares, 2),
        "total_adjusted_cost":  round(live_adj * h.shares, 2),
        "basis_reduction":      basis_reduction_live,
        "basis_reduction_stored": basis_reduction_stored,
    }


def _event_to_dict(e: HoldingEvent) -> dict:
    return {
        "id":            e.id,
        "holding_id":    e.holding_id,
        "position_id":   e.position_id,
        "event_type":    e.event_type.value,
        "shares_delta":  e.shares_delta,
        "basis_delta":   e.basis_delta,
        "realized_gain": e.realized_gain,
        "description":   e.description,
        "created_at":    e.created_at.isoformat(),
    }


def _recalculate_adj_basis(h: StockHolding, session) -> float:
    """
    Replay all HoldingEvents for this holding to compute the correct
    adjusted_cost_basis starting from cost_basis.
    Only CC_EXPIRED / MANUAL events with a basis_delta are applied.
    Returns the recalculated adjusted_cost_basis.
    """
    events = (
        session.query(HoldingEvent)
        .filter(
            HoldingEvent.holding_id == h.id,
            HoldingEvent.event_type.in_([
                HoldingEventType.CC_EXPIRED,
                HoldingEventType.MANUAL,
            ])
        )
        .order_by(HoldingEvent.created_at)
        .all()
    )
    adj = h.cost_basis
    for ev in events:
        if ev.basis_delta is not None:
            adj = max(0.0, adj + ev.basis_delta)  # basis_delta is negative for reductions
    return round(adj, 4)


# ── CRUD ──────────────────────────────────────────────────────────────────────

def list_holdings(*, user_id: int) -> list[dict]:
    session = get_session()
    try:
        rows = (
            session.query(StockHolding)
            .filter(StockHolding.user_id == user_id)
            .order_by(StockHolding.symbol, StockHolding.acquired_date)
            .all()
        )
        return [_holding_to_dict(h, session) for h in rows]
    finally:
        session.close()


def create_holding(*, user_id: int, data: dict) -> dict:
    session = get_session()
    try:
        now = datetime.utcnow()
        cost = float(data["cost_basis"])
        h = StockHolding(
            user_id             = user_id,
            symbol              = str(data["symbol"]).upper().strip(),
            company_name        = data.get("company_name"),
            shares              = float(data["shares"]),
            cost_basis          = cost,
            adjusted_cost_basis = cost,   # starts equal to cost basis
            acquired_date       = _parse_dt(data.get("acquired_date")),
            status              = "ACTIVE",
            notes               = data.get("notes"),
            created_at          = now,
            updated_at          = now,
        )
        session.add(h)
        session.commit()
        session.refresh(h)
        return _holding_to_dict(h, session)
    finally:
        session.close()


def update_holding(*, user_id: int, holding_id: int, data: dict) -> dict:
    session = get_session()
    try:
        h = session.query(StockHolding).filter(
            StockHolding.id == holding_id,
            StockHolding.user_id == user_id,
        ).first()
        if h is None:
            raise ValueError("Holding not found")
        if "shares"               in data: h.shares               = float(data["shares"])
        if "acquired_date"        in data: h.acquired_date        = _parse_dt(data["acquired_date"])
        if "notes"                in data: h.notes                = data["notes"]
        if "status"               in data: h.status               = data["status"]
        if "company_name"         in data: h.company_name         = data["company_name"]
        # When cost_basis changes, recalculate adj basis from event history
        # so accumulated premium reductions are preserved correctly.
        if "cost_basis" in data:
            h.cost_basis = float(data["cost_basis"])
            h.adjusted_cost_basis = _recalculate_adj_basis(h, session)
        elif "adjusted_cost_basis" in data:
            # Allow direct override only if explicitly passed without cost_basis
            h.adjusted_cost_basis = float(data["adjusted_cost_basis"])
        h.updated_at = datetime.utcnow()
        session.commit()
        session.refresh(h)
        return _holding_to_dict(h, session)
    finally:
        session.close()


def delete_holding(*, user_id: int, holding_id: int) -> None:
    session = get_session()
    try:
        h = session.query(StockHolding).filter(
            StockHolding.id == holding_id,
            StockHolding.user_id == user_id,
        ).first()
        if h is None:
            raise ValueError("Holding not found")
        session.delete(h)
        session.commit()
    finally:
        session.close()


def list_holding_events(*, user_id: int, holding_id: int) -> list[dict]:
    session = get_session()
    try:
        rows = (
            session.query(HoldingEvent)
            .filter(
                HoldingEvent.user_id == user_id,
                HoldingEvent.holding_id == holding_id,
            )
            .order_by(HoldingEvent.created_at.desc())
            .all()
        )
        return [_event_to_dict(e) for e in rows]
    finally:
        session.close()


# ── Automatic triggers ────────────────────────────────────────────────────────

def apply_position_status_change(
    *,
    user_id: int,
    position_id: int,
    new_status: str,
) -> dict | None:
    """
    Called whenever an OptionPosition status is changed.
    Returns the updated holding dict if a holding was affected, else None.

    Triggers:
      CC + EXPIRED or CLOSED  → reduce adjusted_cost_basis
      CC + ASSIGNED           → remove shares, record realized gain
      PUT + ASSIGNED          → add shares, blend cost basis
    """
    session = get_session()
    try:
        pos = session.query(OptionPosition).filter(
            OptionPosition.id == position_id,
            OptionPosition.user_id == user_id,
        ).first()
        if pos is None:
            return None

        holding_id = pos.holding_id
        if not holding_id:
            return None   # no holding linked — nothing to do

        h = session.query(StockHolding).filter(
            StockHolding.id == holding_id,
            StockHolding.user_id == user_id,
        ).first()
        if h is None:
            return None

        status = new_status.upper()
        option_type = (pos.option_type or "").upper()

        now = datetime.utcnow()
        event: HoldingEvent | None = None

        # ── CC expired worthless or bought back ──
        if option_type == "CALL" and status in ("EXPIRED", "CLOSED"):
            if h.shares > 0:
                # Premium collected = premium_in × contracts × 100
                # Per-share reduction = total_premium / current_shares
                premium_total = (pos.premium_in or 0.0) * pos.contracts * 100
                basis_reduction_per_share = premium_total / h.shares
                old_adj = h.adjusted_cost_basis
                h.adjusted_cost_basis = max(0.0, old_adj - basis_reduction_per_share)
                h.updated_at = now

                event = HoldingEvent(
                    user_id      = user_id,
                    holding_id   = h.id,
                    position_id  = position_id,
                    event_type   = HoldingEventType.CC_EXPIRED,
                    shares_delta = 0.0,
                    basis_delta  = -(basis_reduction_per_share),
                    realized_gain= None,
                    description  = (
                        f"{pos.symbol} CC ${pos.strike} x{pos.contracts} {status.lower()} — "
                        f"basis reduced by ${basis_reduction_per_share:.4f}/share "
                        f"(${premium_total:.2f} / {h.shares:.0f} shares)"
                    ),
                    created_at   = now,
                )

        # ── CC assigned (shares called away) ──
        elif option_type == "CALL" and status == "ASSIGNED":
            shares_called = pos.contracts * 100
            realized_gain = (pos.strike - h.adjusted_cost_basis) * shares_called
            old_shares = h.shares
            h.shares = max(0.0, h.shares - shares_called)
            h.updated_at = now
            if h.shares == 0:
                h.status = "CLOSED"

            event = HoldingEvent(
                user_id      = user_id,
                holding_id   = h.id,
                position_id  = position_id,
                event_type   = HoldingEventType.CC_ASSIGNED,
                shares_delta = -shares_called,
                basis_delta  = 0.0,
                realized_gain= round(realized_gain, 2),
                description  = (
                    f"{pos.symbol} CC ${pos.strike} x{pos.contracts} assigned — "
                    f"{shares_called} shares called away at ${pos.strike:.2f} "
                    f"(adj basis ${h.adjusted_cost_basis:.2f}) → "
                    f"realized {'gain' if realized_gain >= 0 else 'loss'} ${realized_gain:.2f}. "
                    f"Shares: {old_shares:.0f} → {h.shares:.0f}"
                ),
                created_at   = now,
            )

        # ── CSP assigned (put exercised — cash converts to shares) ──
        elif option_type == "PUT" and status == "ASSIGNED":
            new_shares = pos.contracts * 100
            strike_price = pos.strike
            old_shares = h.shares
            old_adj = h.adjusted_cost_basis
            old_basis = h.cost_basis

            # Blend adjusted cost basis
            total_old_adj_cost = old_adj * old_shares
            total_new_cost     = strike_price * new_shares
            total_shares       = old_shares + new_shares
            new_adj_basis      = (total_old_adj_cost + total_new_cost) / total_shares if total_shares > 0 else strike_price

            # Blend original cost basis
            total_old_cost = old_basis * old_shares
            new_orig_basis = (total_old_cost + total_new_cost) / total_shares if total_shares > 0 else strike_price

            h.shares               = total_shares
            h.adjusted_cost_basis  = round(new_adj_basis, 4)
            h.cost_basis           = round(new_orig_basis, 4)
            h.updated_at           = now
            if h.status == "CLOSED":
                h.status = "ACTIVE"

            event = HoldingEvent(
                user_id      = user_id,
                holding_id   = h.id,
                position_id  = position_id,
                event_type   = HoldingEventType.CSP_ASSIGNED,
                shares_delta = new_shares,
                basis_delta  = round(new_adj_basis - old_adj, 4),
                realized_gain= None,
                description  = (
                    f"{pos.symbol} CSP ${pos.strike} x{pos.contracts} assigned — "
                    f"added {new_shares} shares at ${strike_price:.2f}. "
                    f"Blended adj basis: ${old_adj:.2f} → ${new_adj_basis:.2f}. "
                    f"Shares: {old_shares:.0f} → {total_shares:.0f}"
                ),
                created_at   = now,
            )

        if event:
            session.add(event)
            session.commit()
            session.refresh(h)
            return _holding_to_dict(h, session)

        return None
    finally:
        session.close()


# ── Seed holdings from existing positions ────────────────────────────────────

def seed_holdings_from_positions(*, user_id: int) -> dict:
    """
    For every OptionPosition that has no holding_id, create (or reuse) one
    StockHolding per unique symbol using the position's strike as cost_basis
    and contracts * 100 as shares. Then link each position back via holding_id.

    If a symbol already has an ACTIVE StockHolding for this user, the positions
    are linked to that existing holding (no duplicate created).

    Returns:
        {"created": [<holding_dict>, ...], "linked": N}
    """
    session = get_session()
    try:
        positions = (
            session.query(OptionPosition)
            .filter(
                OptionPosition.user_id == user_id,
                OptionPosition.holding_id == None,  # noqa: E711
            )
            .all()
        )

        # Group unlinked positions by symbol
        by_symbol: dict[str, list] = {}
        for p in positions:
            sym = (p.symbol or "").upper().strip()
            if sym:
                by_symbol.setdefault(sym, []).append(p)

        created = []
        linked = 0
        now = datetime.utcnow()

        for symbol, pos_list in by_symbol.items():
            # Re-use existing ACTIVE holding if one exists for this symbol
            existing = (
                session.query(StockHolding)
                .filter(
                    StockHolding.user_id == user_id,
                    StockHolding.symbol == symbol,
                    StockHolding.status == "ACTIVE",
                )
                .first()
            )

            if existing:
                h = existing
            else:
                # Use the strike of the first position as initial cost_basis placeholder
                # (user should update cost_basis to their real avg cost).
                # adjusted_cost_basis starts equal to cost_basis — it only decreases
                # as premiums from linked positions are realized (closed/expired).
                strike = float(pos_list[0].strike or 0.0)
                total_shares = float(sum(p.contracts * 100 for p in pos_list))
                h = StockHolding(
                    user_id             = user_id,
                    symbol              = symbol,
                    company_name        = None,
                    shares              = total_shares,
                    cost_basis          = strike,
                    adjusted_cost_basis = strike,  # will equal cost_basis; recalculates as events are added
                    status              = "ACTIVE",
                    created_at          = now,
                    updated_at          = now,
                )
                session.add(h)
                session.flush()  # populate h.id before linking
                created.append(_holding_to_dict(h, session))

            for p in pos_list:
                p.holding_id = h.id
                linked += 1

        session.commit()
        return {"created": created, "linked": linked}
    finally:
        session.close()


def recalculate_all_holdings(*, user_id: int) -> dict:
    """
    Repair / recalculate adjusted_cost_basis for every holding owned by user_id.

    For each holding:
      1. Start from cost_basis (the real avg cost the user entered).
      2. Replay all CC_EXPIRED / MANUAL HoldingEvents (basis_delta reductions).
      3. Save the corrected adjusted_cost_basis back to the DB.

    This is idempotent — safe to call repeatedly.
    Returns a summary of how many holdings were updated.
    """
    session = get_session()
    try:
        holdings = (
            session.query(StockHolding)
            .filter(StockHolding.user_id == user_id)
            .all()
        )
        updated = 0
        results = []
        for h in holdings:
            old_adj = h.adjusted_cost_basis
            new_adj = _recalculate_adj_basis(h, session)
            if abs(new_adj - old_adj) > 0.0001:
                h.adjusted_cost_basis = new_adj
                h.updated_at = datetime.utcnow()
                updated += 1
            results.append({
                "id": h.id,
                "symbol": h.symbol,
                "cost_basis": h.cost_basis,
                "old_adj": old_adj,
                "new_adj": new_adj,
                "corrected": abs(new_adj - old_adj) > 0.0001,
            })
        session.commit()
        return {"updated": updated, "holdings": results}
    finally:
        session.close()


# ── Utility ───────────────────────────────────────────────────────────────────

def _parse_dt(val: Any) -> datetime | None:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val
    s = str(val).strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f"):
        try:
            return datetime.strptime(s[:19], fmt[:len(s[:19])])
        except ValueError:
            continue
    return None
