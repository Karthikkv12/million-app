"""optionflow/modules/flow/repo.py — net-flow snapshots in the markets database (ORM only)."""
from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Set, Tuple

from sqlalchemy import or_

from database.models import FlowStrikeSide, NetFlowSnapshot
from optionflow.core.db import get_session

_FIELDS = ("symbol", "ts", "price", "call_prem", "put_prem", "net_flow", "total_prem", "volume")
_OPTIONAL = ("call_traded", "put_traded", "call_bought", "call_sold", "put_bought", "put_sold", "atm_iv_near", "atm_iv_30d")


def add_snapshot(**row) -> None:
    """Insert one snapshot (keys: symbol, ts, price, call_prem, put_prem, net_flow, total_prem, volume)."""
    add_snapshots([row])


def add_snapshots(rows: Iterable[dict]) -> int:
    """Insert many snapshots in one transaction; returns the count."""
    objs = [NetFlowSnapshot(**{k: r[k] for k in _FIELDS}, **{k: r.get(k) for k in _OPTIONAL}) for r in rows]
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
    """(ts, price, call_prem, put_prem, net_flow, total_prem, volume, call_traded, put_traded, call_bought, call_sold,
    put_bought, put_sold, atm_iv_near, atm_iv_30d) rows, oldest first.

    Matches both timestamp spellings ever written ("…Z" and "…+00:00").
    """
    session = get_session()
    try:
        q = (
            session.query(
                NetFlowSnapshot.ts, NetFlowSnapshot.price, NetFlowSnapshot.call_prem,
                NetFlowSnapshot.put_prem, NetFlowSnapshot.net_flow,
                NetFlowSnapshot.total_prem, NetFlowSnapshot.volume,
                NetFlowSnapshot.call_traded, NetFlowSnapshot.put_traded,
                NetFlowSnapshot.call_bought, NetFlowSnapshot.call_sold,
                NetFlowSnapshot.put_bought, NetFlowSnapshot.put_sold,
                NetFlowSnapshot.atm_iv_near, NetFlowSnapshot.atm_iv_30d,
            )
            .filter(NetFlowSnapshot.symbol == symbol)
            .filter(or_(NetFlowSnapshot.ts >= since_z, NetFlowSnapshot.ts >= since_offset))
            .order_by(NetFlowSnapshot.ts)
        )
        return [tuple(r) for r in q.all()]
    finally:
        session.close()


def list_all_since(since_z: str, since_offset: str) -> List[tuple]:
    """(symbol, ts, price, call_prem, put_prem, net_flow, total_prem, volume, call_traded, put_traded) rows for every
    symbol, ordered by symbol then time (both timestamp spellings, as list_since)."""
    session = get_session()
    try:
        q = (
            session.query(
                NetFlowSnapshot.symbol, NetFlowSnapshot.ts, NetFlowSnapshot.price,
                NetFlowSnapshot.call_prem, NetFlowSnapshot.put_prem, NetFlowSnapshot.net_flow,
                NetFlowSnapshot.total_prem, NetFlowSnapshot.volume,
                NetFlowSnapshot.call_traded, NetFlowSnapshot.put_traded,
            )
            .filter(or_(NetFlowSnapshot.ts >= since_z, NetFlowSnapshot.ts >= since_offset))
            .order_by(NetFlowSnapshot.symbol, NetFlowSnapshot.ts)
        )
        return [tuple(r) for r in q.all()]
    finally:
        session.close()


def last_traded(symbol: str, since_z: str, since_offset: str):
    """(call_traded, put_traded, call_bought, call_sold, put_bought, put_sold) of the newest snapshot at or after
    `since` that has traded totals, or None. The side figures are None on rows written before they existed."""
    session = get_session()
    try:
        r = (
            session.query(NetFlowSnapshot.call_traded, NetFlowSnapshot.put_traded,
                          NetFlowSnapshot.call_bought, NetFlowSnapshot.call_sold,
                          NetFlowSnapshot.put_bought, NetFlowSnapshot.put_sold)
            .filter(NetFlowSnapshot.symbol == symbol, NetFlowSnapshot.call_traded.isnot(None),
                    NetFlowSnapshot.put_traded.isnot(None))
            .filter(or_(NetFlowSnapshot.ts >= since_z, NetFlowSnapshot.ts >= since_offset))
            .order_by(NetFlowSnapshot.ts.desc())
            .first()
        )
        if not r:
            return None
        return (float(r[0]), float(r[1])) + tuple(None if x is None else float(x) for x in r[2:6])
    finally:
        session.close()


# ── per-strike sides (flow.traded.strikes) ──────────────────────────────────────
StrikeKey = Tuple[str, float, str]


def save_strike_sides(symbol: str, day: str, by: Dict[StrikeKey, List[float]]) -> int:
    """Replace `symbol`'s rows for `day` with `by` ({(expiry, strike, otype): [bought, sold, bought $Δ, sold $Δ]})."""
    session = get_session()
    try:
        session.query(FlowStrikeSide).filter(FlowStrikeSide.symbol == symbol, FlowStrikeSide.day == day).delete()
        session.add_all([FlowStrikeSide(symbol=symbol, day=day, expiry=k[0], strike=k[1], otype=k[2],
                                        bought=v[0], sold=v[1], bought_dd=v[2], sold_dd=v[3]) for k, v in by.items()])
        session.commit()
        return len(by)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def load_strike_sides(symbol: str, day: Optional[str] = None) -> Optional[Tuple[str, Dict[StrikeKey, List[float]]]]:
    """(day, rows) for `day`, or for the latest saved day when `day` is None; None when nothing is saved."""
    session = get_session()
    try:
        if day is None:
            last = (session.query(FlowStrikeSide.day).filter(FlowStrikeSide.symbol == symbol)
                    .order_by(FlowStrikeSide.day.desc()).first())
            if not last:
                return None
            day = last[0]
        rows = session.query(FlowStrikeSide).filter(FlowStrikeSide.symbol == symbol, FlowStrikeSide.day == day).all()
        if not rows:
            return None
        return day, {(r.expiry, float(r.strike), r.otype): [r.bought, r.sold, r.bought_dd, r.sold_dd] for r in rows}
    finally:
        session.close()
