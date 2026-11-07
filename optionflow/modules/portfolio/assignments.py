"""optionflow/modules/portfolio/assignments.py — Stock assignments from options."""
from __future__ import annotations
import json
from datetime import datetime
from optionflow.core.db import get_session
from database.models import OptionPosition, OptionPositionStatus, StockAssignment
from optionflow.modules.portfolio._common import _assignment_to_dict


# ── Stock assignments ─────────────────────────────────────────────────────────

def create_assignment(*, user_id: int, position_id: int, data: dict) -> dict:
    session = get_session()
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
    session = get_session()
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
    session = get_session()
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
    session = get_session()
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
