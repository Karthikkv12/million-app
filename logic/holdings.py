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

from logic.services import get_session, _portfolio_session
from database.models import (
    StockHolding,
    HoldingEvent,
    HoldingEventType,
    OptionPosition,
    OptionPositionStatus,
    PremiumLedger,
)


# ── Serialisers ───────────────────────────────────────────────────────────────

def _holding_to_dict(h: StockHolding, session=None) -> dict:
    """
    Serialize a StockHolding.

    Basis math (all from the PremiumLedger — single source of truth):

      adj_basis (stored)   = cost_basis − realized_premium_per_share
          Only moves when an option CLOSES/EXPIRES/IS ASSIGNED.
          This is the "locked-in" basis — permanent reductions from realized premium.

      live_adj_basis       = adj_basis − unrealized_premium_per_share
          Subtracts in-flight (ACTIVE) premium from the stored adj_basis.
          Shows what you're effectively paying for the stock right now.

      realized_premium     = total $ collected from closed/expired options
      unrealized_premium   = total $ still in-flight (ACTIVE options)
      upside_basis         = lowest active CC strike (ceiling if called away)
    """
    adj = h.adjusted_cost_basis   # stored: cost_basis - realized_prem/share
    live_adj = adj
    upside_basis: float | None = None
    realized_prem_total   = 0.0
    unrealized_prem_total = 0.0
    total_prem_sold       = 0.0

    if session is not None and h.id:
        # Pull aggregated premium totals from ledger (no double-counting)
        ledger_rows = (
            session.query(PremiumLedger)
            .filter(PremiumLedger.holding_id == h.id)
            .all()
        )
        realized_prem_total   = sum(r.realized_premium   for r in ledger_rows)
        unrealized_prem_total = sum(r.unrealized_premium for r in ledger_rows)
        total_prem_sold       = sum(r.premium_sold       for r in ledger_rows)

        if h.shares > 0:
            unrealized_per_share = unrealized_prem_total / h.shares
            live_adj = max(0.0, adj - unrealized_per_share)

        # Upside ceiling from active CC positions
        active_cc_strikes = [
            r.strike for r in ledger_rows
            if r.status == "ACTIVE" and r.option_type == "CALL"
        ]
        if active_cc_strikes:
            upside_basis = min(active_cc_strikes)

    basis_reduction_stored = round((h.cost_basis - adj)      * h.shares, 2)
    basis_reduction_live   = round((h.cost_basis - live_adj) * h.shares, 2)

    # ── Assignment status ─────────────────────────────────────────────────────
    # Look up the most recent CC_ASSIGNED or CSP_ASSIGNED event for this holding.
    last_assignment_type: str | None = None
    last_assignment_date: str | None = None
    called_away = False
    if session is not None and h.id:
        assign_event = (
            session.query(HoldingEvent)
            .filter(
                HoldingEvent.holding_id == h.id,
                HoldingEvent.event_type.in_([
                    HoldingEventType.CC_ASSIGNED,
                    HoldingEventType.CSP_ASSIGNED,
                ]),
            )
            .order_by(HoldingEvent.created_at.desc())
            .first()
        )
        if assign_event is not None:
            last_assignment_type = assign_event.event_type.value
            last_assignment_date = assign_event.created_at.isoformat()
            # A holding is "called away" when it was closed via CC assignment
            # and is currently CLOSED (shares == 0 / status CLOSED).
            called_away = (
                assign_event.event_type == HoldingEventType.CC_ASSIGNED
                and h.status == "CLOSED"
            )

    # ── Realized gain for closed holdings ────────────────────────────────────
    # Sum ALL realized_gain events for this holding so multi-assignment cases
    # (e.g. two CC assignments on HIMS) are totalled correctly.
    realized_gain_total: float | None = None
    if session is not None and h.id and h.status == "CLOSED":
        gain_events = (
            session.query(HoldingEvent)
            .filter(
                HoldingEvent.holding_id == h.id,
                HoldingEvent.realized_gain.isnot(None),
            )
            .all()
        )
        if gain_events:
            realized_gain_total = round(sum(float(e.realized_gain) for e in gain_events), 2)

    return {
        "id":                    h.id,
        "symbol":                h.symbol,
        "company_name":          h.company_name,
        "shares":                h.shares,
        "cost_basis":            h.cost_basis,
        # Stored adj basis: only realized premium has been subtracted
        "adjusted_cost_basis":   round(adj, 4),
        # Live adj basis: realized + unrealized both subtracted (what you effectively own at)
        "live_adj_basis":        round(live_adj, 4),
        "upside_basis":          round(upside_basis, 2) if upside_basis is not None else None,
        "downside_basis":        round(live_adj, 4),
        # Premium breakdown
        "realized_premium":      round(realized_prem_total,   2),
        "unrealized_premium":    round(unrealized_prem_total, 2),
        "total_premium_sold":    round(total_prem_sold,       2),
        "acquired_date":         h.acquired_date.isoformat() if h.acquired_date else None,
        "status":                h.status,
        "notes":                 h.notes,
        "created_at":            h.created_at.isoformat(),
        "updated_at":            h.updated_at.isoformat(),
        # Computed totals
        "total_original_cost":   round(h.cost_basis * h.shares, 2),
        "total_adjusted_cost":   round(live_adj     * h.shares, 2),
        "basis_reduction":       basis_reduction_live,
        "basis_reduction_stored": basis_reduction_stored,
        # Assignment tracking
        "called_away":           called_away,
        "last_assignment_type":  last_assignment_type,
        "last_assignment_date":  last_assignment_date,
        # Realized P&L for closed/called-away holdings (None for active)
        "realized_gain":         realized_gain_total,
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
    Recompute adjusted_cost_basis whenever the user changes the avg cost.

    Formula: adj_basis = new_cost_basis - total_premium_savings_per_share

    Premium savings come from two sources (in priority order):
      1. PremiumLedger rows (realized_premium) — used for active holdings
         that have linked option positions.
      2. HoldingEvent basis_delta sum — fallback for closed/called-away lots
         whose premium history lives only in the event log (no ledger rows).

    This ensures that if the user edits 'Avg Cost' on ANY holding — active
    or closed — the adj_basis always reflects: new_cost - historical_savings.
    """
    # PremiumLedger path (primary — active holdings with linked positions)
    ledger_rows = (
        session.query(PremiumLedger)
        .filter(PremiumLedger.holding_id == h.id)
        .all()
    )
    if ledger_rows:
        realized_total = sum(r.realized_premium for r in ledger_rows)
        if h.shares > 0:
            adj = h.cost_basis - (realized_total / h.shares)
        else:
            # shares=0 (fully called away): preserve per-share savings
            adj = h.cost_basis - realized_total
        return round(max(0.0, adj), 4)

    # HoldingEvent fallback (closed lots / lots without a ledger)
    # Sum ALL basis_delta values across the holding's lifetime:
    #   CC_EXPIRED events  → negative delta (premium reductions)
    #   MANUAL close event → positive delta (stock-gain adjustment on close)
    # Together they give the true net adj_basis offset relative to cost_basis.
    event_rows = (
        session.query(HoldingEvent)
        .filter(HoldingEvent.holding_id == h.id)
        .all()
    )
    if event_rows:
        total_delta = sum(e.basis_delta for e in event_rows if e.basis_delta is not None)
        adj = h.cost_basis + total_delta
        return round(max(0.0, adj), 4)

    # No history at all — adj_basis equals cost_basis
    return round(h.cost_basis, 4)


# ── CRUD ──────────────────────────────────────────────────────────────────────

def list_holdings(*, user_id: int) -> list[dict]:
    session = _portfolio_session()
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
    """
    Create a new StockHolding, or reactivate a prior CLOSED one.

    Reactivation logic:
    When the user adds shares for a symbol that already has a CLOSED holding
    (e.g. they were called away and are re-entering), instead of starting fresh
    we reactivate the existing record so the accumulated adjusted_cost_basis
    (reduced by all historical premium collected) continues to carry forward.

    The new shares are blended into the existing holding using a weighted average:
      new_cost_basis = (old_adj_basis × old_shares + new_price × new_shares)
                       / (old_shares + new_shares)

    This preserves the premium-reduction history, which is the user's real
    advantage from running the covered-call wheel.
    """
    session = _portfolio_session()
    try:
        symbol = str(data["symbol"]).upper().strip()
        new_shares = float(data["shares"])
        new_cost   = float(data["cost_basis"])
        now        = datetime.utcnow()

        # ── Check for an existing CLOSED holding for this symbol ─────────────
        prior = (
            session.query(StockHolding)
            .filter(
                StockHolding.user_id == user_id,
                StockHolding.symbol  == symbol,
                StockHolding.status  == "CLOSED",
            )
            .order_by(StockHolding.updated_at.desc())
            .first()
        )

        if prior is not None:
            # ── Reactivate: blend new shares into prior lot ───────────────────
            old_adj    = prior.adjusted_cost_basis
            old_shares = prior.shares  # may be 0 when fully called away

            if old_shares > 0:
                # Weighted average of prior adj basis + new purchase price
                blended_basis = (old_adj * old_shares + new_cost * new_shares) / (old_shares + new_shares)
            else:
                # All shares were called away — start cost from new purchase,
                # but the adj_basis offset earned from historical premium carries forward:
                #   blended_adj = new_cost - (old_cost_basis - old_adj)
                #   i.e. subtract the per-share premium saved historically
                prior_savings_per_share = prior.cost_basis - old_adj
                blended_basis = max(0.0, new_cost - prior_savings_per_share)

            total_shares = old_shares + new_shares
            blended_basis = round(blended_basis, 4)

            prior.shares               = total_shares
            prior.cost_basis           = round(new_cost, 4)   # latest purchase price as new raw basis
            prior.adjusted_cost_basis  = blended_basis
            prior.status               = "ACTIVE"
            if data.get("acquired_date"):
                prior.acquired_date    = _parse_dt(data["acquired_date"])
            if data.get("company_name"):
                prior.company_name     = data["company_name"]
            if data.get("notes"):
                prior.notes            = data["notes"]
            prior.updated_at           = now

            # Record this reactivation as a MANUAL HoldingEvent
            savings = prior.cost_basis - blended_basis
            event = HoldingEvent(
                user_id      = user_id,
                holding_id   = prior.id,
                position_id  = None,
                event_type   = HoldingEventType.MANUAL,
                shares_delta = round(new_shares, 4),
                basis_delta  = round(blended_basis - old_adj, 4),
                realized_gain= None,
                description  = (
                    f"{symbol} re-entered: {new_shares:.0f} sh @ ${new_cost:.2f} blended into prior lot "
                    f"({old_shares:.0f} sh, adj basis ${old_adj:.2f}) → "
                    f"{total_shares:.0f} sh, new adj basis ${blended_basis:.2f}/sh "
                    f"(carrying ${savings:.2f}/sh historical premium savings forward)"
                ),
                created_at   = now,
            )
            session.add(event)
            session.commit()
            session.refresh(prior)
            return _holding_to_dict(prior, session)

        # ── No prior CLOSED lot — create fresh ───────────────────────────────
        h = StockHolding(
            user_id             = user_id,
            symbol              = symbol,
            company_name        = data.get("company_name"),
            shares              = new_shares,
            cost_basis          = new_cost,
            adjusted_cost_basis = new_cost,   # starts equal to cost basis
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
    session = _portfolio_session()
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
        if "company_name"         in data: h.company_name         = data["company_name"]
        # When cost_basis changes, recalculate adj basis from event history
        # so accumulated premium reductions are preserved correctly.
        if "cost_basis" in data:
            h.cost_basis = float(data["cost_basis"])
            h.adjusted_cost_basis = _recalculate_adj_basis(h, session)
        elif "adjusted_cost_basis" in data:
            # Allow direct override only if explicitly passed without cost_basis
            h.adjusted_cost_basis = float(data["adjusted_cost_basis"])

        # ── Manual close with exit price ──────────────────────────────────────
        # Realized P&L decomposition:
        #   stock_gain   = (close_price − cost_basis) × shares   ← did the stock go up or down?
        #   premium_gain = (cost_basis  − adj_basis)  × shares   ← premium collected over time
        #   total_gain   = (close_price − adj_basis)  × shares   ← what actually ended up in pocket
        #
        # Example (BMNR):
        #   cost_basis=$18.96, adj_basis=$18.20 (net $0.76/sh premium), close=$18.88
        #   stock_gain   = (18.88 − 18.96) × 100 = −$8   (sold below purchase price)
        #   premium_gain = (18.96 − 18.20) × 100 = +$76  (from covered calls)
        #   total_gain   = (18.88 − 18.20) × 100 = +$68  ✓
        #
        # Final adj_basis stored on the closed record:
        #   closed_adj = cost_basis − total_gain_per_share
        #              = cost_basis − (close_price − adj_basis)
        #              = adj_basis + (cost_basis − close_price)    ← stock loss added back
        #   BMNR: 18.20 + (18.96 − 18.88) = 18.20 + 0.08 = $18.28  ✓
        #
        # This means: "after all gains and losses, your net cost per share was $18.28".
        # It preserves the re-entry blending correctly: when you re-buy at any price,
        # prior_savings = cost_basis(new) − closed_adj carries the full net history.
        now = datetime.utcnow()
        close_event = None
        if data.get("status") == "CLOSED" and "close_price" in data and data["close_price"] is not None:
            close_price   = float(data["close_price"])
            cost_basis    = h.cost_basis
            adj_basis     = h.adjusted_cost_basis
            shares        = h.shares

            stock_gain_per_sh   = round(close_price - cost_basis, 4)
            premium_gain_per_sh = round(cost_basis  - adj_basis,  4)
            total_gain_per_sh   = round(close_price - adj_basis,  4)

            stock_gain_total    = round(stock_gain_per_sh   * shares, 2)
            premium_gain_total  = round(premium_gain_per_sh * shares, 2)
            realized_gain       = round(total_gain_per_sh   * shares, 2)

            # Update adj_basis to reflect the true net cost after close:
            #   closed_adj = adj_basis + (cost_basis - close_price)
            # This absorbs the stock-side gain/loss into the basis so the
            # closed card shows the real net result, and re-entry blending
            # correctly inherits the full wheel history.
            closed_adj = round(adj_basis + (cost_basis - close_price), 4)
            h.adjusted_cost_basis = closed_adj

            close_event = HoldingEvent(
                user_id       = user_id,
                holding_id    = h.id,
                position_id   = None,
                event_type    = HoldingEventType.MANUAL,
                shares_delta  = -shares,
                basis_delta   = round(closed_adj - adj_basis, 4),
                realized_gain = realized_gain,
                description   = (
                    f"{h.symbol} closed: {shares:.0f} sh sold @ ${close_price:.2f} "
                    f"| stock {'+' if stock_gain_total >= 0 else ''}${stock_gain_total:.2f} "
                    f"({stock_gain_per_sh:+.2f}/sh vs cost ${cost_basis:.2f}) "
                    f"| premium +${premium_gain_total:.2f} "
                    f"(adj basis ${adj_basis:.2f} → ${closed_adj:.2f}) "
                    f"| total {'gain' if realized_gain >= 0 else 'loss'} "
                    f"{'+' if realized_gain >= 0 else ''}${realized_gain:.2f}"
                ),
                created_at    = now,
            )

        if "status" in data:
            h.status = data["status"]
            # When manually closing, zero out shares so the holding is fully closed
            if data["status"] == "CLOSED":
                h.shares = 0

        if close_event:
            session.add(close_event)

        h.updated_at = now
        session.commit()
        session.refresh(h)
        return _holding_to_dict(h, session)
    finally:
        session.close()


def delete_holding(*, user_id: int, holding_id: int) -> None:
    """
    Delete a holding — with one important guard:

    If the holding has any HoldingEvents (meaning premium history has accumulated),
    we NEVER hard-delete it.  Instead we soft-delete it by setting status=CLOSED
    and shares=0.  This preserves the adj_basis history so that if the user
    re-enters the same symbol later, create_holding can inherit the premium savings.

    If there are no events (a freshly-added lot with no option history), we
    hard-delete as before.
    """
    session = _portfolio_session()
    try:
        h = session.query(StockHolding).filter(
            StockHolding.id == holding_id,
            StockHolding.user_id == user_id,
        ).first()
        if h is None:
            raise ValueError("Holding not found")

        # Check for premium/event history
        event_count = (
            session.query(HoldingEvent)
            .filter(HoldingEvent.holding_id == holding_id)
            .count()
        )

        if event_count > 0:
            # Soft-delete: preserve record + adj_basis history for future re-entry
            h.shares   = 0.0
            h.status   = "CLOSED"
            h.updated_at = datetime.utcnow()
            session.commit()
        else:
            session.delete(h)
            session.commit()
    finally:
        session.close()


def list_holding_events(*, user_id: int, holding_id: int) -> list[dict]:
    session = _portfolio_session()
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

    Flow:
      1. Update the PremiumLedger row for this position (upsert).
      2. Recompute holding.adjusted_cost_basis from ALL realized ledger rows.
      3. Write a HoldingEvent for the audit log.

    Triggers:
      CC + EXPIRED or CLOSED  → position realized → adj_basis decreases
      CC + ASSIGNED           → shares called away, realized gain recorded
      PUT + ASSIGNED          → add shares, blend cost basis
    """
    from logic.premium_ledger import upsert_ledger_row, get_premium_summary

    session = _portfolio_session()
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
            # Step 1: upsert this position's ledger row (moves premium to realized)
            upsert_ledger_row(user_id=user_id, position_id=position_id, session=session)

            # Step 2: recompute adj_basis from ALL realized ledger rows
            if h.shares > 0:
                summary = get_premium_summary(holding_id=h.id, session=session)
                realized_per_share = summary["realized_premium"] / h.shares
                new_adj = max(0.0, h.cost_basis - realized_per_share)
                old_adj = h.adjusted_cost_basis
                h.adjusted_cost_basis = round(new_adj, 4)
                h.updated_at = now

                # Net premium for this specific close (for the event log)
                prem_in  = (pos.premium_in  or 0.0) * pos.contracts * 100
                prem_out = (pos.premium_out or 0.0) * pos.contracts * 100
                net_prem = max(0.0, prem_in + prem_out)
                basis_reduction_per_share = net_prem / h.shares

                event = HoldingEvent(
                    user_id      = user_id,
                    holding_id   = h.id,
                    position_id  = position_id,
                    event_type   = HoldingEventType.CC_EXPIRED,
                    shares_delta = 0.0,
                    basis_delta  = round(-(basis_reduction_per_share), 4),
                    realized_gain= None,
                    description  = (
                        f"{pos.symbol} CC ${pos.strike} x{pos.contracts} {status.lower()} — "
                        f"net ${net_prem:.2f} realized, basis ${old_adj:.4f} → ${new_adj:.4f}/share"
                    ),
                    created_at   = now,
                )

        # ── CC assigned (shares called away) ──
        elif option_type == "CALL" and status == "ASSIGNED":
            # Upsert ledger (marks as realized)
            upsert_ledger_row(user_id=user_id, position_id=position_id, session=session)
            if h.shares > 0:
                summary = get_premium_summary(holding_id=h.id, session=session)
                realized_per_share = summary["realized_premium"] / h.shares
                h.adjusted_cost_basis = max(0.0, round(h.cost_basis - realized_per_share, 4))

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

        # ── PUT expired / closed (CSP kept premium, no assignment) ──
        elif option_type == "PUT" and status in ("EXPIRED", "CLOSED"):
            upsert_ledger_row(user_id=user_id, position_id=position_id, session=session)
            if h.shares > 0:
                summary = get_premium_summary(holding_id=h.id, session=session)
                realized_per_share = summary["realized_premium"] / h.shares
                new_adj = max(0.0, h.cost_basis - realized_per_share)
                old_adj = h.adjusted_cost_basis
                h.adjusted_cost_basis = round(new_adj, 4)
                h.updated_at = now

                prem_in  = (pos.premium_in  or 0.0) * pos.contracts * 100
                prem_out = (pos.premium_out or 0.0) * pos.contracts * 100
                net_prem = max(0.0, prem_in + prem_out)
                basis_reduction_per_share = net_prem / h.shares

                event = HoldingEvent(
                    user_id      = user_id,
                    holding_id   = h.id,
                    position_id  = position_id,
                    event_type   = HoldingEventType.CC_EXPIRED,  # reuse type for PUT expired
                    shares_delta = 0.0,
                    basis_delta  = round(-(basis_reduction_per_share), 4),
                    realized_gain= None,
                    description  = (
                        f"{pos.symbol} PUT ${pos.strike} x{pos.contracts} {status.lower()} — "
                        f"net ${net_prem:.2f} realized, basis ${old_adj:.4f} → ${new_adj:.4f}/share"
                    ),
                    created_at   = now,
                )

        # ── Reverting to ACTIVE (undoing a premature close/expire/assign) ──
        elif status == "ACTIVE":
            # Move premium back to unrealized and recompute adj_basis from scratch
            upsert_ledger_row(user_id=user_id, position_id=position_id, session=session)
            if h.shares > 0:
                summary = get_premium_summary(holding_id=h.id, session=session)
                realized_per_share = summary["realized_premium"] / h.shares
                old_adj = h.adjusted_cost_basis
                new_adj = max(0.0, h.cost_basis - realized_per_share)
                h.adjusted_cost_basis = round(new_adj, 4)
                h.updated_at = now

                event = HoldingEvent(
                    user_id      = user_id,
                    holding_id   = h.id,
                    position_id  = position_id,
                    event_type   = HoldingEventType.MANUAL,
                    shares_delta = 0.0,
                    basis_delta  = round(new_adj - old_adj, 4),
                    realized_gain= None,
                    description  = (
                        f"{pos.symbol} position reverted to ACTIVE — "
                        f"premium moved back to unrealized. "
                        f"adj basis ${old_adj:.4f} → ${new_adj:.4f}/share"
                    ),
                    created_at   = now,
                )

        if event:
            session.add(event)
            session.commit()
            session.refresh(h)
            return _holding_to_dict(h, session)

        # Always commit ledger upserts even when no event is created (e.g. ROLLED)
        session.commit()
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
    session = _portfolio_session()
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
    session = _portfolio_session()
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
