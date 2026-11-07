"""optionflow/modules/flow/repo.py — net-flow snapshots in the markets database (ORM only)."""
from __future__ import annotations

from typing import Iterable, List, Set

from sqlalchemy import or_

from database.models import NetFlowSnapshot
from optionflow.core.db import get_session

_FIELDS = ("symbol", "ts", "price", "call_prem", "put_prem", "net_flow", "total_prem", "volume")


def add_snapshot(**row) -> None:
    """Insert one snapshot (keys: symbol, ts, price, call_prem, put_prem, net_flow, total_prem, volume)."""
    add_snapshots([row])


def add_snapshots(rows: Iterable[dict]) -> int:
    """Insert many snapshots in one transaction; returns the count."""
    objs = [NetFlowSnapshot(**{k: r[k] for k in _FIELDS}) for r in rows]
    if not objs:
        return 0
    session = get_session()
    try:
        session.add_all(objs)
        session.commit()
        return len(objs)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def existing_timestamps(symbol: str, since_iso: str) -> Set[str]:
    """Timestamps already stored for `symbol` at or after `since_iso`."""
    session = get_session()
    try:
        rows = (
            session.query(NetFlowSnapshot.ts)
            .filter(NetFlowSnapshot.symbol == symbol, NetFlowSnapshot.ts >= since_iso)
            .all()
        )
        return {r[0] for r in rows}
    finally:
        session.close()


def list_since(symbol: str, since_z: str, since_offset: str) -> List[tuple]:
    """(ts, price, call_prem, put_prem, net_flow, total_prem, volume) rows, oldest first.

    Matches both timestamp spellings ever written ("…Z" and "…+00:00").
    """
    session = get_session()
    try:
        q = (
            session.query(
                NetFlowSnapshot.ts, NetFlowSnapshot.price, NetFlowSnapshot.call_prem,
                NetFlowSnapshot.put_prem, NetFlowSnapshot.net_flow,
                NetFlowSnapshot.total_prem, NetFlowSnapshot.volume,
            )
            .filter(NetFlowSnapshot.symbol == symbol)
            .filter(or_(NetFlowSnapshot.ts >= since_z, NetFlowSnapshot.ts >= since_offset))
            .order_by(NetFlowSnapshot.ts)
        )
        return [tuple(r) for r in q.all()]
    finally:
        session.close()
