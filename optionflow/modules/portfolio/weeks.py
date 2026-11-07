"""optionflow/modules/portfolio/weeks.py — Weekly portfolio snapshots: create, list, update, complete, reopen."""
from __future__ import annotations
from datetime import datetime, timedelta
from optionflow.core.db import get_portfolio_session as _portfolio_session
from database.models import WeeklySnapshot, OptionPosition, OptionPositionStatus
from optionflow.modules.portfolio._common import _snap_to_dict, _week_bounds


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
                notes: str | None = None,
                acct_label_1: str | None = None, acct_val_1: float | None = None,
                acct_label_2: str | None = None, acct_val_2: float | None = None,
                acct_label_3: str | None = None, acct_val_3: float | None = None) -> dict:
    """Update the Friday account value and/or notes for a week.

    If any of acct_val_1/2/3 are provided the sum is written to account_value
    automatically.  Passing account_value directly still works for backwards
    compatibility (used when only a single number is provided).
    """
    session = _portfolio_session()
    try:
        s = session.query(WeeklySnapshot).filter(
            WeeklySnapshot.id == week_id,
            WeeklySnapshot.user_id == user_id,
        ).first()
        if s is None:
            raise ValueError("Week not found")
        # Sub-account labels
        if acct_label_1 is not None:
            s.acct_label_1 = acct_label_1
        if acct_label_2 is not None:
            s.acct_label_2 = acct_label_2
        if acct_label_3 is not None:
            s.acct_label_3 = acct_label_3
        # Sub-account values — update stored fields
        sub_updated = any(v is not None for v in (acct_val_1, acct_val_2, acct_val_3))
        if acct_val_1 is not None:
            s.acct_val_1 = acct_val_1
        if acct_val_2 is not None:
            s.acct_val_2 = acct_val_2
        if acct_val_3 is not None:
            s.acct_val_3 = acct_val_3
        # Auto-sum if any sub-value was touched
        if sub_updated:
            s.account_value = (s.acct_val_1 or 0) + (s.acct_val_2 or 0) + (s.acct_val_3 or 0)
        elif account_value is not None:
            s.account_value = account_value
        if notes is not None:
            s.notes = notes
        session.commit()
        session.refresh(s)
        return _snap_to_dict(s)
    finally:
        session.close()


def mark_week_complete(*, user_id: int, week_id: int, account_value: float | None = None,
                       acct_label_1: str | None = None, acct_val_1: float | None = None,
                       acct_label_2: str | None = None, acct_val_2: float | None = None,
                       acct_label_3: str | None = None, acct_val_3: float | None = None) -> dict:
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

        # Sub-account labels
        if acct_label_1 is not None:
            snap.acct_label_1 = acct_label_1
        if acct_label_2 is not None:
            snap.acct_label_2 = acct_label_2
        if acct_label_3 is not None:
            snap.acct_label_3 = acct_label_3
        # Sub-account values
        sub_updated = any(v is not None for v in (acct_val_1, acct_val_2, acct_val_3))
        if acct_val_1 is not None:
            snap.acct_val_1 = acct_val_1
        if acct_val_2 is not None:
            snap.acct_val_2 = acct_val_2
        if acct_val_3 is not None:
            snap.acct_val_3 = acct_val_3
        if sub_updated:
            snap.account_value = (snap.acct_val_1 or 0) + (snap.acct_val_2 or 0) + (snap.acct_val_3 or 0)
        elif account_value is not None:
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
