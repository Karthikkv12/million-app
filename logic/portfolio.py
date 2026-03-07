"""
Weekly options portfolio logic.

Covers:
  - Week management (get or create, list, mark complete with carry-forward)
  - Option position CRUD
  - Stock assignment CRUD + cost basis / breakeven calculations
  - Portfolio summary aggregates
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from logic.services import get_session, _portfolio_session
from database.models import (
    WeeklySnapshot,
    OptionPosition,
    OptionPositionStatus,
    StockAssignment,
    PremiumLedger,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _week_bounds(for_date: datetime | None = None):
    """Return (monday_00:00, friday_23:59:59) UTC for the week containing for_date.
    Accepts either a datetime or a date object."""
    import datetime as _dt
    if for_date is None:
        d = datetime.now(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0, tzinfo=None
        )
    elif isinstance(for_date, _dt.datetime):
        d = for_date.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)
    else:
        # date object — convert to datetime at midnight
        d = datetime(for_date.year, for_date.month, for_date.day, 0, 0, 0)
    monday = d - timedelta(days=d.weekday())          # weekday() 0=Mon
    friday = monday + timedelta(days=4, hours=23, minutes=59, seconds=59)
    return monday, friday


def _pos_to_dict(p: OptionPosition) -> dict:
    intrinsic, extrinsic, moneyness = _compute_moneyness(p)
    return {
        "id":              p.id,
        "week_id":         p.week_id,
        "symbol":          p.symbol,
        "contracts":       p.contracts,
        "strike":          p.strike,
        "option_type":     p.option_type,
        "sold_date":       p.sold_date.isoformat() if p.sold_date else None,
        "buy_date":        p.buy_date.isoformat()  if p.buy_date  else None,
        "expiry_date":     p.expiry_date.isoformat() if p.expiry_date else None,
        "premium_in":      p.premium_in,
        "premium_out":     p.premium_out,
        "spot_price":      p.spot_price,
        "is_roll":         p.is_roll,
        "status":          p.status.value if p.status else "ACTIVE",
        "rolled_to_id":    p.rolled_to_id,
        "carried_from_id": p.carried_from_id,
        "holding_id":      p.holding_id,
        "margin":          p.margin,
        "notes":           p.notes,
        # Computed
        "net_premium":     _net_premium(p),
        "total_premium":   _net_premium(p) * p.contracts * 100,
        # Moneyness / extrinsic value (only when spot_price is provided)
        "intrinsic_value": intrinsic,
        "extrinsic_value": extrinsic,
        "moneyness":       moneyness,   # "ITM" | "ATM" | "OTM" | None
    }


def _net_premium(p: OptionPosition) -> float:
    """Premium in minus any debit paid out (roll debit stored as negative)."""
    inn  = p.premium_in  or 0.0
    out  = p.premium_out or 0.0
    return inn + out   # out is already signed (negative = debit)


def _compute_moneyness(p: OptionPosition):
    """Return (intrinsic_per_share, extrinsic_per_share, moneyness_label).
    intrinsic = the in-the-money component of premium_in (per share).
    extrinsic = premium_in - intrinsic  (the true time/theta value sold).
    moneyness  = 'ITM' | 'ATM' | 'OTM' | None (when spot_price not provided).
    ATM threshold: spot within ±0.5% of strike.
    """
    spot  = p.spot_price
    prem  = p.premium_in or 0.0
    strike = p.strike or 0.0

    if spot is None or spot <= 0 or strike <= 0:
        return None, None, None

    if p.option_type == "CALL":
        raw_intrinsic = max(0.0, spot - strike)
    else:  # PUT
        raw_intrinsic = max(0.0, strike - spot)

    intrinsic = round(min(raw_intrinsic, prem), 4)   # can't exceed premium paid
    extrinsic = round(max(0.0, prem - intrinsic), 4)

    atm_band = strike * 0.005   # ±0.5% of strike
    if abs(spot - strike) <= atm_band:
        moneyness = "ATM"
    elif (p.option_type == "CALL" and spot > strike) or (p.option_type == "PUT" and spot < strike):
        moneyness = "ITM"
    else:
        moneyness = "OTM"

    return intrinsic, extrinsic, moneyness


def _snap_to_dict(s: WeeklySnapshot) -> dict:
    return {
        "id":            s.id,
        "week_start":    s.week_start.isoformat(),
        "week_end":      s.week_end.isoformat(),
        "account_value": s.account_value,
        "is_complete":   s.is_complete,
        "completed_at":  s.completed_at.isoformat() if s.completed_at else None,
        "notes":         s.notes,
        "label":         s.week_end.strftime("Week of %b %d, %Y"),
    }


def _assignment_to_dict(a: StockAssignment) -> dict:
    additional = json.loads(a.additional_buys or "[]")
    covered    = json.loads(a.covered_calls   or "[]")
    cb         = calc_cost_basis(
        shares_acquired   = a.shares_acquired,
        acquisition_price = a.acquisition_price,
        additional_buys   = additional,
        net_option_premium= a.net_option_premium or 0.0,
    )
    return {
        "id":                 a.id,
        "position_id":        a.position_id,
        "symbol":             a.symbol,
        "shares_acquired":    a.shares_acquired,
        "acquisition_price":  a.acquisition_price,
        "additional_buys":    additional,
        "covered_calls":      covered,
        "net_option_premium": a.net_option_premium,
        "notes":              a.notes,
        **cb,
    }


# ── Cost basis calculator ─────────────────────────────────────────────────────

def calc_cost_basis(
    *,
    shares_acquired: int,
    acquisition_price: float,
    additional_buys: list[dict] | None = None,
    net_option_premium: float = 0.0,
) -> dict:
    """
    Compute blended cost basis and breakeven levels.

    additional_buys: [{shares, price}, ...]
    net_option_premium: total net credit collected on this symbol (reduces basis)
    """
    buys = additional_buys or []

    total_shares = shares_acquired + sum(b.get("shares", 0) for b in buys)
    total_cost   = (
        shares_acquired * acquisition_price
        + sum(b.get("shares", 0) * b.get("price", 0.0) for b in buys)
    )

    if total_shares <= 0:
        return {
            "total_shares":      0,
            "total_cost":        0.0,
            "weighted_avg_cost": 0.0,
            "downside_basis":    0.0,
            "upside_basis":      0.0,
            "downside_breakeven":0.0,
            "upside_breakeven":  0.0,
        }

    weighted_avg = total_cost / total_shares

    # Net premium per share lowers the effective cost basis
    premium_per_share = net_option_premium / total_shares

    # Downside basis  = avg cost minus premium collected
    #   → how low the stock can go before you're underwater
    downside_basis    = weighted_avg - premium_per_share
    # Upside basis    = avg cost (ignoring premium — conservative)
    upside_basis      = weighted_avg

    # Breakeven prices (same values, named for clarity in the UI)
    downside_breakeven = downside_basis   # stock needs to be ABOVE this to not lose
    upside_breakeven   = upside_basis     # covered-call assignment threshold

    return {
        "total_shares":       total_shares,
        "total_cost":         round(total_cost, 2),
        "weighted_avg_cost":  round(weighted_avg, 4),
        "downside_basis":     round(downside_basis, 4),
        "upside_basis":       round(upside_basis, 4),
        "downside_breakeven": round(downside_breakeven, 2),
        "upside_breakeven":   round(upside_breakeven, 2),
    }


# ── Week management ───────────────────────────────────────────────────────────

def get_or_create_week(*, user_id: int, for_date: datetime | None = None) -> dict:
    """Return the week containing for_date, creating it if necessary."""
    monday, friday = _week_bounds(for_date)
    session = _portfolio_session()
    try:
        snap = (
            session.query(WeeklySnapshot)
            .filter(
                WeeklySnapshot.user_id == user_id,
                WeeklySnapshot.week_end == friday,
            )
            .first()
        )
        if snap is None:
            snap = WeeklySnapshot(
                user_id      = user_id,
                week_start   = monday,
                week_end     = friday,
                is_complete  = False,
                created_at   = datetime.utcnow(),
            )
            session.add(snap)
            session.commit()
            session.refresh(snap)
        return _snap_to_dict(snap)
    finally:
        session.close()


def list_weeks(*, user_id: int) -> list[dict]:
    """Return all weeks for this user, newest first."""
    session = _portfolio_session()
    try:
        snaps = (
            session.query(WeeklySnapshot)
            .filter(WeeklySnapshot.user_id == user_id)
            .order_by(WeeklySnapshot.week_end.desc())
            .all()
        )
        return [_snap_to_dict(s) for s in snaps]
    finally:
        session.close()


def get_week(*, user_id: int, week_id: int) -> dict | None:
    session = _portfolio_session()
    try:
        s = session.query(WeeklySnapshot).filter(
            WeeklySnapshot.id == week_id,
            WeeklySnapshot.user_id == user_id,
        ).first()
        return _snap_to_dict(s) if s else None
    finally:
        session.close()


def update_week(*, user_id: int, week_id: int, account_value: float | None = None,
                notes: str | None = None) -> dict:
    """Update the Friday account value and/or notes for a week."""
    session = _portfolio_session()
    try:
        s = session.query(WeeklySnapshot).filter(
            WeeklySnapshot.id == week_id,
            WeeklySnapshot.user_id == user_id,
        ).first()
        if s is None:
            raise ValueError("Week not found")
        if account_value is not None:
            s.account_value = account_value
        if notes is not None:
            s.notes = notes
        session.commit()
        session.refresh(s)
        return _snap_to_dict(s)
    finally:
        session.close()


def mark_week_complete(*, user_id: int, week_id: int, account_value: float | None = None) -> dict:
    """
    Mark a week as complete and carry all ACTIVE positions forward into the
    next week (creating it if necessary).
    """
    session = _portfolio_session()
    try:
        snap = session.query(WeeklySnapshot).filter(
            WeeklySnapshot.id == week_id,
            WeeklySnapshot.user_id == user_id,
        ).first()
        if snap is None:
            raise ValueError("Week not found")
        if snap.is_complete:
            # Already complete — idempotent, just return current state
            return _snap_to_dict(snap)

        if account_value is not None:
            snap.account_value = account_value
        snap.is_complete  = True
        snap.completed_at = datetime.utcnow()
        session.commit()

        # Carry forward active positions
        active_positions = (
            session.query(OptionPosition)
            .filter(
                OptionPosition.week_id == week_id,
                OptionPosition.user_id == user_id,
                OptionPosition.status  == OptionPositionStatus.ACTIVE,
            )
            .all()
        )

        if active_positions:
            # Get or create next week
            next_monday = snap.week_end.replace(hour=0, minute=0, second=0) + timedelta(days=3)
            next_snap_dict = get_or_create_week(user_id=user_id, for_date=next_monday)
            next_week_id = next_snap_dict["id"]

            now = datetime.utcnow()
            for pos in active_positions:
                new_pos = OptionPosition(
                    user_id         = user_id,
                    week_id         = next_week_id,
                    symbol          = pos.symbol,
                    contracts       = pos.contracts,
                    strike          = pos.strike,
                    option_type     = pos.option_type,
                    sold_date       = pos.sold_date,
                    buy_date        = None,
                    expiry_date     = pos.expiry_date,
                    premium_in      = pos.premium_in,
                    premium_out     = pos.premium_out,
                    is_roll         = False,
                    status          = OptionPositionStatus.ACTIVE,
                    carried_from_id = pos.id,
                    margin          = pos.margin,
                    notes           = pos.notes,
                    created_at      = now,
                    updated_at      = now,
                )
                session.add(new_pos)

        session.commit()
        session.refresh(snap)
        return _snap_to_dict(snap)
    finally:
        session.close()


def reopen_week(*, user_id: int, week_id: int) -> dict:
    """
    Re-open a completed week so edits can be made.

    Steps:
      1. Set is_complete=False, completed_at=None on the snapshot.
      2. Find all positions in *other* weeks that were carried forward from
         this week (carried_from_id points to a position in week_id).
         Delete those carried copies so they are not orphaned duplicates.
    """
    session = _portfolio_session()
    try:
        snap = session.query(WeeklySnapshot).filter(
            WeeklySnapshot.id == week_id,
            WeeklySnapshot.user_id == user_id,
        ).first()
        if snap is None:
            raise ValueError("Week not found")
        if not snap.is_complete:
            return _snap_to_dict(snap)  # idempotent

        # Collect the IDs of positions that lived in this week
        week_position_ids = [
            p.id for p in session.query(OptionPosition.id).filter(
                OptionPosition.week_id == week_id,
                OptionPosition.user_id == user_id,
            ).all()
        ]

        # Delete any positions in other weeks whose carried_from_id is one of those IDs
        if week_position_ids:
            carried_copies = (
                session.query(OptionPosition)
                .filter(
                    OptionPosition.user_id == user_id,
                    OptionPosition.week_id != week_id,
                    OptionPosition.carried_from_id.in_(week_position_ids),
                )
                .all()
            )
            for copy in carried_copies:
                session.delete(copy)

        snap.is_complete  = False
        snap.completed_at = None
        session.commit()
        session.refresh(snap)
        return _snap_to_dict(snap)
    finally:
        session.close()


# ── Option positions ──────────────────────────────────────────────────────────

def list_positions(*, user_id: int, week_id: int) -> list[dict]:
    session = _portfolio_session()
    try:
        # Get the week snapshot to know if it's complete
        snap = session.query(WeeklySnapshot).filter(
            WeeklySnapshot.id == week_id,
            WeeklySnapshot.user_id == user_id,
        ).first()

        # Positions that belong to this week
        this_week = (
            session.query(OptionPosition)
            .filter(
                OptionPosition.user_id == user_id,
                OptionPosition.week_id == week_id,
            )
            .order_by(OptionPosition.symbol, OptionPosition.sold_date)
            .all()
        )

        result = [_pos_to_dict(p) for p in this_week]

        # Only append carried-forward positions when viewing an OPEN (incomplete) week.
        # When viewing a closed week, those positions already moved to the next week —
        # showing them here would double-count them and misrepresent the closed week's state.
        if snap and not snap.is_complete:
            # Find completed prior weeks for this user so we only show truly "carried"
            # positions (from weeks that are done), not positions in other open weeks.
            completed_week_ids_q = (
                session.query(WeeklySnapshot.id)
                .filter(
                    WeeklySnapshot.user_id == user_id,
                    WeeklySnapshot.is_complete == True,  # noqa: E712
                    WeeklySnapshot.id != week_id,
                )
            )
            completed_ids = [r[0] for r in completed_week_ids_q.all()]

            # IDs of positions already carried into this week (to avoid showing
            # the original again when its copy already lives in the current week)
            already_carried_ids = {
                p.carried_from_id
                for p in this_week
                if p.carried_from_id is not None
            }

            carried_all = (
                session.query(OptionPosition)
                .filter(
                    OptionPosition.user_id == user_id,
                    OptionPosition.week_id.in_(completed_ids) if completed_ids else False,
                    OptionPosition.status == OptionPositionStatus.ACTIVE,
                )
                .order_by(OptionPosition.symbol, OptionPosition.sold_date)
                .all()
            ) if completed_ids else []

            # Exclude positions whose carry-forward copy is already in this week
            carried = [p for p in carried_all if p.id not in already_carried_ids]

            # Build a lookup of week labels for carried positions
            carried_week_ids = {p.week_id for p in carried}
            week_labels: dict[int, str] = {}
            if carried_week_ids:
                snaps = (
                    session.query(WeeklySnapshot)
                    .filter(
                        WeeklySnapshot.id.in_(carried_week_ids),
                        WeeklySnapshot.user_id == user_id,
                    )
                    .all()
                )
                for s in snaps:
                    week_labels[s.id] = s.week_end.strftime("wk of %b %d")

            for p in carried:
                d = _pos_to_dict(p)
                d["carried"] = True
                d["origin_week_label"] = week_labels.get(p.week_id, "prior week")
                result.append(d)

        return result
    finally:
        session.close()


def list_all_positions(*, user_id: int) -> list[dict]:
    """Return every OptionPosition for the user across all weeks, ordered by expiry_date asc."""
    session = _portfolio_session()
    try:
        positions = (
            session.query(OptionPosition)
            .filter(OptionPosition.user_id == user_id)
            .order_by(OptionPosition.expiry_date.asc(), OptionPosition.symbol)
            .all()
        )
        return [_pos_to_dict(p) for p in positions]
    finally:
        session.close()


def create_position(*, user_id: int, week_id: int, data: dict) -> dict:
    session = _portfolio_session()
    try:
        # Validate week belongs to user
        snap = session.query(WeeklySnapshot).filter(
            WeeklySnapshot.id == week_id,
            WeeklySnapshot.user_id == user_id,
        ).first()
        if snap is None:
            raise ValueError("Week not found")
        if snap.is_complete:
            raise ValueError("Cannot add positions to a completed week")

        now = datetime.utcnow()
        raw_status = data.get("status", "ACTIVE")
        status_val = OptionPositionStatus(str(raw_status).upper()) if raw_status else OptionPositionStatus.ACTIVE
        pos = OptionPosition(
            user_id     = user_id,
            week_id     = week_id,
            symbol      = data["symbol"].upper().strip(),
            contracts   = int(data.get("contracts", 1)),
            strike      = float(data["strike"]),
            option_type = data["option_type"].upper(),
            sold_date   = parse_dt(data.get("sold_date")),
            buy_date    = parse_dt(data.get("buy_date")),
            expiry_date = parse_dt(data.get("expiry_date")),
            premium_in  = _float_or_none(data.get("premium_in")),
            premium_out = _float_or_none(data.get("premium_out")),
            spot_price  = _float_or_none(data.get("spot_price")),
            is_roll     = bool(data.get("is_roll", False)),
            status      = status_val,
            margin      = _float_or_none(data.get("margin")),
            holding_id  = int(data["holding_id"]) if data.get("holding_id") else None,
            notes       = data.get("notes"),
            created_at  = now,
            updated_at  = now,
        )
        session.add(pos)
        session.commit()
        session.refresh(pos)
        return _pos_to_dict(pos)
    finally:
        session.close()


def update_position(*, user_id: int, position_id: int, data: dict) -> dict:
    session = _portfolio_session()
    try:
        pos = session.query(OptionPosition).filter(
            OptionPosition.id == position_id,
            OptionPosition.user_id == user_id,
        ).first()
        if pos is None:
            raise ValueError("Position not found")

        updatable = [
            "contracts", "strike", "option_type", "sold_date", "buy_date",
            "expiry_date", "premium_in", "premium_out", "spot_price", "is_roll", "margin", "notes",
        ]
        for field in updatable:
            if field not in data:
                continue
            val = data[field]
            if field in ("sold_date", "buy_date", "expiry_date"):
                val = parse_dt(val)
            elif field in ("premium_in", "premium_out", "spot_price", "margin", "strike"):
                val = _float_or_none(val)
            elif field == "contracts":
                val = int(val)
            elif field == "is_roll":
                val = bool(val)
            elif field == "option_type":
                val = str(val).upper()
            setattr(pos, field, val)

        if "status" in data:
            pos.status = OptionPositionStatus(data["status"].upper())
        if "holding_id" in data:
            pos.holding_id = int(data["holding_id"]) if data["holding_id"] else None

        pos.updated_at = datetime.utcnow()
        session.commit()
        session.refresh(pos)
        return _pos_to_dict(pos)
    finally:
        session.close()


def delete_position(*, user_id: int, position_id: int) -> None:
    """
    Delete a position and ALL related carry-forward copies / the origin.

    - If deleting an original (carried_from_id=None): also delete every
      carry-copy that points to it across all weeks.
    - If deleting a carry-copy (carried_from_id != None): resolve to the
      original, then delete the original AND all its carry-copies.

    This ensures a "wrong trade" entered in week 1 is fully removed and
    never resurfaces as a ghost in the 'Carried from prior weeks' section.
    """
    session = _portfolio_session()
    try:
        pos = session.query(OptionPosition).filter(
            OptionPosition.id == position_id,
            OptionPosition.user_id == user_id,
        ).first()
        if pos is None:
            raise ValueError("Position not found")

        # Resolve to the true origin
        origin_id = pos.carried_from_id if pos.carried_from_id else pos.id

        # Collect all carry-copies of this origin across all weeks
        copies = session.query(OptionPosition).filter(
            OptionPosition.user_id == user_id,
            OptionPosition.carried_from_id == origin_id,
        ).all()

        # Collect all IDs to delete (origin + carry-copies) for ledger cleanup
        ids_to_delete = [origin_id] + [copy.id for copy in copies]

        # Delete any PremiumLedger rows for these positions so no ghost totals remain
        session.query(PremiumLedger).filter(
            PremiumLedger.user_id == user_id,
            PremiumLedger.position_id.in_(ids_to_delete),
        ).delete(synchronize_session=False)

        # Delete carry-copies and origin
        for copy in copies:
            session.delete(copy)

        # Delete the origin itself
        origin = session.query(OptionPosition).filter(
            OptionPosition.id == origin_id,
            OptionPosition.user_id == user_id,
        ).first()
        if origin:
            session.delete(origin)

        session.commit()
    finally:
        session.close()


# ── Stock assignments ─────────────────────────────────────────────────────────

def create_assignment(*, user_id: int, position_id: int, data: dict) -> dict:
    session = _portfolio_session()
    try:
        pos = session.query(OptionPosition).filter(
            OptionPosition.id == position_id,
            OptionPosition.user_id == user_id,
        ).first()
        if pos is None:
            raise ValueError("Position not found")

        now = datetime.utcnow()
        a = StockAssignment(
            user_id            = user_id,
            position_id        = position_id,
            symbol             = pos.symbol,
            shares_acquired    = int(data["shares_acquired"]),
            acquisition_price  = float(data["acquisition_price"]),
            additional_buys    = json.dumps(data.get("additional_buys") or []),
            covered_calls      = json.dumps(data.get("covered_calls")   or []),
            net_option_premium = float(data.get("net_option_premium") or 0.0),
            notes              = data.get("notes"),
            created_at         = now,
            updated_at         = now,
        )
        # Mark the position as assigned
        pos.status     = OptionPositionStatus.ASSIGNED
        pos.updated_at = now

        session.add(a)
        session.commit()
        session.refresh(a)
        return _assignment_to_dict(a)
    finally:
        session.close()


def update_assignment(*, user_id: int, assignment_id: int, data: dict) -> dict:
    session = _portfolio_session()
    try:
        a = session.query(StockAssignment).filter(
            StockAssignment.id == assignment_id,
            StockAssignment.user_id == user_id,
        ).first()
        if a is None:
            raise ValueError("Assignment not found")

        if "shares_acquired"    in data: a.shares_acquired    = int(data["shares_acquired"])
        if "acquisition_price"  in data: a.acquisition_price  = float(data["acquisition_price"])
        if "additional_buys"    in data: a.additional_buys    = json.dumps(data["additional_buys"])
        if "covered_calls"      in data: a.covered_calls      = json.dumps(data["covered_calls"])
        if "net_option_premium" in data: a.net_option_premium = float(data["net_option_premium"])
        if "notes"              in data: a.notes              = data["notes"]

        a.updated_at = datetime.utcnow()
        session.commit()
        session.refresh(a)
        return _assignment_to_dict(a)
    finally:
        session.close()


def get_assignment_for_position(*, user_id: int, position_id: int) -> dict | None:
    session = _portfolio_session()
    try:
        a = session.query(StockAssignment).filter(
            StockAssignment.position_id == position_id,
            StockAssignment.user_id == user_id,
        ).first()
        return _assignment_to_dict(a) if a else None
    finally:
        session.close()


def list_assignments(*, user_id: int) -> list[dict]:
    """All stock assignments for a user — for the portfolio summary."""
    session = _portfolio_session()
    try:
        rows = (
            session.query(StockAssignment)
            .filter(StockAssignment.user_id == user_id)
            .order_by(StockAssignment.symbol)
            .all()
        )
        return [_assignment_to_dict(r) for r in rows]
    finally:
        session.close()


# ── Portfolio summary ─────────────────────────────────────────────────────────

def portfolio_summary(*, user_id: int) -> dict:
    """
    Aggregate stats across all weeks:
      - Total premium collected (net)
      - Realized P&L (closed + expired positions)
      - Active positions count
      - Monthly account value series (for chart)
      - Capital gains (sum of realized P&L on closed/expired)
    """
    session = _portfolio_session()
    try:
        all_positions = (
            session.query(OptionPosition)
            .filter(OptionPosition.user_id == user_id)
            .all()
        )
        all_weeks = (
            session.query(WeeklySnapshot)
            .filter(WeeklySnapshot.user_id == user_id)
            .order_by(WeeklySnapshot.week_end)
            .all()
        )
        # Build set of week IDs that are open (not yet complete)
        open_week_ids = {w.id for w in all_weeks if not w.is_complete}

        total_premium   = 0.0
        realized_pnl    = 0.0
        active_count    = 0
        assigned_count  = 0
        seen_origin: set[int] = set()

        for p in all_positions:
            # Walk back to the original position to avoid double-counting
            origin_id = p.id
            if p.carried_from_id:
                origin_id = p.carried_from_id

            if origin_id in seen_origin:
                continue
            seen_origin.add(origin_id)

            # Use gross premium_in for total (consistent with Premium tab)
            gross = (p.premium_in or 0.0) * p.contracts * 100
            net   = _net_premium(p) * p.contracts * 100
            total_premium += gross

            if p.status in (OptionPositionStatus.CLOSED, OptionPositionStatus.EXPIRED):
                realized_pnl += net  # realized P&L stays net (accounts for buyback cost)
            elif p.status == OptionPositionStatus.ACTIVE:
                if p.week_id in open_week_ids:
                    active_count += 1
            elif p.status == OptionPositionStatus.ASSIGNED:
                assigned_count += 1

        # Per-week breakdown for the Year tab
        week_premium: dict[int, float] = {w.id: 0.0 for w in all_weeks}
        week_realized: dict[int, float] = {w.id: 0.0 for w in all_weeks}
        week_pos_count: dict[int, int] = {w.id: 0 for w in all_weeks}
        seen_origin2: set[int] = set()

        for p in all_positions:
            origin_id = p.id if not p.carried_from_id else p.carried_from_id
            if origin_id in seen_origin2:
                continue
            seen_origin2.add(origin_id)
            if p.week_id not in week_premium:
                continue
            # Use gross premium_in (same as Premium tab's total_premium_sold)
            # so the week-by-week figure matches what you actually collected.
            gross = (p.premium_in or 0.0) * p.contracts * 100
            net   = _net_premium(p) * p.contracts * 100
            week_premium[p.week_id] += gross
            week_pos_count[p.week_id] += 1
            if p.status in (OptionPositionStatus.CLOSED, OptionPositionStatus.EXPIRED):
                week_realized[p.week_id] += net

        weeks_breakdown = []
        for w in sorted(all_weeks, key=lambda x: x.week_end, reverse=True):
            prem = round(week_premium[w.id], 2)
            weeks_breakdown.append({
                "id":            w.id,
                "week_start":    w.week_start.date().isoformat(),
                "week_end":      w.week_end.date().isoformat(),
                "is_complete":   w.is_complete,
                "account_value": w.account_value,
                "premium":       prem,
                "realized_pnl":  round(week_realized[w.id], 2),
                "position_count": week_pos_count[w.id],
            })

        # Monthly account value series
        monthly: dict[str, float] = {}
        monthly_premium: dict[str, float] = {}
        for w in all_weeks:
            key = w.week_end.strftime("%Y-%m")
            if w.account_value is not None and w.is_complete:
                monthly[key] = w.account_value  # last complete week of the month wins
            monthly_premium[key] = round(
                monthly_premium.get(key, 0.0) + week_premium.get(w.id, 0.0), 2
            )

        # Always return all 12 months of the current calendar year so the chart
        # shows a complete Jan–Dec skeleton even when only a few weeks exist.
        import datetime as _dt
        _cy = _dt.datetime.utcnow().year
        for _m in range(1, 13):
            _k = f"{_cy}-{_m:02d}"
            if _k not in monthly_premium:
                monthly_premium[_k] = 0.0
        # Keep chronological order
        monthly_premium = dict(sorted(monthly_premium.items()))

        # Win rate: weeks with positive premium
        complete_weeks = [w for w in all_weeks if w.is_complete]
        winning_weeks = sum(1 for w in complete_weeks if week_premium.get(w.id, 0) > 0)
        win_rate = round(winning_weeks / len(complete_weeks) * 100, 1) if complete_weeks else 0.0

        best_week = max(weeks_breakdown, key=lambda x: x["premium"], default=None)
        worst_week = min(weeks_breakdown, key=lambda x: x["premium"], default=None)

        # Estimated capital gains tax (short-term: 22% bracket default)
        cap_gains_tax_rate = 0.22
        estimated_tax = max(0.0, realized_pnl * cap_gains_tax_rate)

        return {
            "total_premium_collected": round(total_premium, 2),
            "realized_pnl":            round(realized_pnl, 2),
            "active_positions":        active_count,
            "assigned_positions":      assigned_count,
            "estimated_tax":           round(estimated_tax, 2),
            "cap_gains_tax_rate":      cap_gains_tax_rate,
            "monthly_account_values":  monthly,
            "monthly_premium":         monthly_premium,
            "total_weeks":             len(all_weeks),
            "complete_weeks":          len(complete_weeks),
            "win_rate":                win_rate,
            "best_week":               best_week,
            "worst_week":              worst_week,
            "weeks_breakdown":         weeks_breakdown,
        }
    finally:
        session.close()


def symbol_summary(*, user_id: int) -> list[dict]:
    """Per-symbol aggregated P&L — powers the searchable stock list."""
    session = _portfolio_session()
    try:
        all_positions = (
            session.query(OptionPosition)
            .filter(OptionPosition.user_id == user_id)
            .all()
        )
        by_symbol: dict[str, dict[str, Any]] = {}
        seen_origin: set[int] = set()

        for p in all_positions:
            origin_id = p.carried_from_id or p.id
            if origin_id in seen_origin:
                continue
            seen_origin.add(origin_id)

            sym = p.symbol
            if sym not in by_symbol:
                by_symbol[sym] = {
                    "symbol": sym,
                    "total_premium": 0.0,
                    "realized_pnl":  0.0,
                    "active":        0,
                    "closed":        0,
                    "expired":       0,
                    "assigned":      0,
                }
            net = _net_premium(p) * p.contracts * 100
            by_symbol[sym]["total_premium"] += net
            if p.status in (OptionPositionStatus.CLOSED, OptionPositionStatus.EXPIRED,
                            OptionPositionStatus.ASSIGNED):
                # Premium is fully realized for closed, expired, and assigned positions
                # (assigned = option exercised against you; premium collected is kept)
                by_symbol[sym]["realized_pnl"] += net
                if p.status == OptionPositionStatus.CLOSED:
                    by_symbol[sym]["closed"] += 1
                elif p.status == OptionPositionStatus.EXPIRED:
                    by_symbol[sym]["expired"] += 1
                else:
                    by_symbol[sym]["assigned"] += 1
            elif p.status == OptionPositionStatus.ACTIVE:
                by_symbol[sym]["active"] += 1

        result = list(by_symbol.values())
        result.sort(key=lambda x: x["symbol"])
        for r in result:
            r["total_premium"] = round(r["total_premium"], 2)
            r["realized_pnl"]  = round(r["realized_pnl"],  2)
        return result
    finally:
        session.close()


# ── Utilities ─────────────────────────────────────────────────────────────────

def parse_dt(val: Any) -> datetime | None:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val
    s = str(val).strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%m/%d/%Y"):
        try:
            return datetime.strptime(s[:19], fmt[:len(s[:19])])
        except ValueError:
            continue
    return None


def _float_or_none(val: Any) -> float | None:
    if val is None or str(val).strip() == "":
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None
