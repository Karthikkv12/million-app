"""logic/portfolio_services.py — Portfolio value history snapshots."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import pandas as pd
from sqlalchemy.orm import sessionmaker

from database.models import get_portfolio_session

_logger = logging.getLogger("optionflow.portfolio")


# ── Session helper ────────────────────────────────────────────────────────────

def _portfolio_session():
    """Session for portfolio.db. Respects monkeypatched logic.services.engine."""
    try:
        import logic.services as _svc
        if getattr(_svc, "engine", None) is not None:
            return sessionmaker(bind=_svc.engine)()
    except Exception:
        pass
    import database.models as _dbm
    return _dbm.get_portfolio_session()


# ── Snapshots ─────────────────────────────────────────────────────────────────

def list_portfolio_snapshots(*, user_id: int, limit: int = 365, offset: int = 0) -> list[dict]:
    session = _portfolio_session()
    try:
        from database.models import PortfolioValueHistory
        rows = (
            session.query(PortfolioValueHistory)
            .filter(PortfolioValueHistory.user_id == int(user_id))
            .order_by(PortfolioValueHistory.snapshot_date.desc())
            .offset(int(offset))
            .limit(int(limit))
            .all()
        )
        return [
            {
                "id": int(r.id),
                "snapshot_date": r.snapshot_date,
                "total_value": (float(r.total_value) if r.total_value is not None else None),
                "cash": (float(r.cash) if r.cash is not None else None),
                "stock_value": (float(r.stock_value) if r.stock_value is not None else None),
                "options_value": (float(r.options_value) if r.options_value is not None else None),
                "realized_pnl": (float(r.realized_pnl) if r.realized_pnl is not None else None),
                "unrealized_pnl": (float(r.unrealized_pnl) if r.unrealized_pnl is not None else None),
                "notes": (str(r.notes) if r.notes else None),
                "created_at": r.created_at,
            }
            for r in rows
        ]
    finally:
        session.close()


def upsert_portfolio_snapshot(
    *,
    user_id: int,
    snapshot_date,
    total_value: float | None = None,
    cash: float | None = None,
    stock_value: float | None = None,
    options_value: float | None = None,
    realized_pnl: float | None = None,
    unrealized_pnl: float | None = None,
    notes: str | None = None,
) -> dict:
    session = _portfolio_session()
    try:
        from database.models import PortfolioValueHistory
        snap_dt = pd.to_datetime(snapshot_date).to_pydatetime().replace(tzinfo=None) if snapshot_date is not None else None
        if snap_dt is None:
            raise ValueError("snapshot_date is required")
        snap_dt = snap_dt.replace(hour=0, minute=0, second=0, microsecond=0)

        existing = (
            session.query(PortfolioValueHistory)
            .filter(PortfolioValueHistory.user_id == int(user_id))
            .filter(PortfolioValueHistory.snapshot_date == snap_dt)
            .first()
        )
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        if existing is None:
            row = PortfolioValueHistory(
                user_id=int(user_id), snapshot_date=snap_dt,
                total_value=(float(total_value) if total_value is not None else None),
                cash=(float(cash) if cash is not None else None),
                stock_value=(float(stock_value) if stock_value is not None else None),
                options_value=(float(options_value) if options_value is not None else None),
                realized_pnl=(float(realized_pnl) if realized_pnl is not None else None),
                unrealized_pnl=(float(unrealized_pnl) if unrealized_pnl is not None else None),
                notes=(str(notes)[:500] if notes else None),
                created_at=now,
            )
            session.add(row)
        else:
            row = existing
            if total_value is not None:
                row.total_value = float(total_value)
            if cash is not None:
                row.cash = float(cash)
            if stock_value is not None:
                row.stock_value = float(stock_value)
            if options_value is not None:
                row.options_value = float(options_value)
            if realized_pnl is not None:
                row.realized_pnl = float(realized_pnl)
            if unrealized_pnl is not None:
                row.unrealized_pnl = float(unrealized_pnl)
            if notes is not None:
                row.notes = str(notes)[:500]
            session.add(row)

        session.commit()
        session.refresh(row)
        return {
            "id": int(row.id),
            "snapshot_date": row.snapshot_date,
            "total_value": (float(row.total_value) if row.total_value is not None else None),
            "cash": (float(row.cash) if row.cash is not None else None),
            "stock_value": (float(row.stock_value) if row.stock_value is not None else None),
            "options_value": (float(row.options_value) if row.options_value is not None else None),
            "realized_pnl": (float(row.realized_pnl) if row.realized_pnl is not None else None),
            "unrealized_pnl": (float(row.unrealized_pnl) if row.unrealized_pnl is not None else None),
            "notes": (str(row.notes) if row.notes else None),
            "created_at": row.created_at,
        }
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
