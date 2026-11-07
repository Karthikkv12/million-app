"""optionflow/modules/portfolio/positions.py — Option positions within a week."""
from __future__ import annotations
from datetime import datetime
from optionflow.core.db import get_portfolio_session as _portfolio_session
from database.models import WeeklySnapshot, OptionPosition, OptionPositionStatus, PremiumLedger
from optionflow.modules.portfolio._common import _float_or_none, _pos_to_dict, parse_dt


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
        result = _pos_to_dict(pos)
    finally:
        session.close()

    # Auto-register in watchlist (fire-and-forget — never block position creation)
    try:
        from optionflow.modules.watchlist.service import upsert_symbol as _wl_upsert
        _wl_upsert(user_id=user_id, symbol=result["symbol"], source="position")
    except Exception:
        pass

    return result


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


def distinct_symbols(*, user_id: int) -> list[str]:
    session = _portfolio_session()
    try:
        return [r.symbol for r in session.query(OptionPosition.symbol).filter(OptionPosition.user_id == user_id).distinct().all()]
    finally:
        session.close()
