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

def _holding_to_dict(h: StockHolding) -> dict:
    return {
        "id":                  h.id,
        "symbol":              h.symbol,
        "company_name":        h.company_name,
        "shares":              h.shares,
        "cost_basis":          h.cost_basis,
        "adjusted_cost_basis": h.adjusted_cost_basis,
        "acquired_date":       h.acquired_date.isoformat() if h.acquired_date else None,
        "status":              h.status,
        "notes":               h.notes,
        "created_at":          h.created_at.isoformat(),
        "updated_at":          h.updated_at.isoformat(),
        # Computed
        "total_original_cost": round(h.cost_basis * h.shares, 2),
        "total_adjusted_cost": round(h.adjusted_cost_basis * h.shares, 2),
        "basis_reduction":     round((h.cost_basis - h.adjusted_cost_basis) * h.shares, 2),
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
        return [_holding_to_dict(h) for h in rows]
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
        return _holding_to_dict(h)
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
        if "cost_basis"           in data: h.cost_basis           = float(data["cost_basis"])
        if "adjusted_cost_basis"  in data: h.adjusted_cost_basis  = float(data["adjusted_cost_basis"])
        if "acquired_date"        in data: h.acquired_date        = _parse_dt(data["acquired_date"])
        if "notes"                in data: h.notes                = data["notes"]
        if "status"               in data: h.status               = data["status"]
        if "company_name"         in data: h.company_name         = data["company_name"]
        h.updated_at = datetime.utcnow()
        session.commit()
        session.refresh(h)
        return _holding_to_dict(h)
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
            return _holding_to_dict(h)

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
                # Use the strike of the first position as cost_basis
                strike = float(pos_list[0].strike or 0.0)
                total_shares = float(sum(p.contracts * 100 for p in pos_list))
                h = StockHolding(
                    user_id             = user_id,
                    symbol              = symbol,
                    company_name        = None,
                    shares              = total_shares,
                    cost_basis          = strike,
                    adjusted_cost_basis = strike,
                    status              = "ACTIVE",
                    created_at          = now,
                    updated_at          = now,
                )
                session.add(h)
                session.flush()  # populate h.id before linking
                created.append(_holding_to_dict(h))

            for p in pos_list:
                p.holding_id = h.id
                linked += 1

        session.commit()
        return {"created": created, "linked": linked}
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
