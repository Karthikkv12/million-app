"""optionflow/modules/watchlists/service.py — named watchlists.

Each user has up to MAX_LISTS lists of up to MAX_SYMBOLS tickers. The first read seeds the
starter set: "My watchlist" (the active symbols of the old single watchlist) and one list
per sector (sectors.py). After that the lists are the user's: renamed, emptied or deleted,
they stay that way. `restore_sectors` puts back any sector list that is missing.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Dict, List, Optional

from database.models import WatchlistGroup, WatchlistSymbol
from optionflow.core.db import get_session
from optionflow.modules.watchlists.sectors import SECTOR_LISTS

MAX_LISTS = 20
MAX_SYMBOLS = 100
_SYMBOL = re.compile(r"^[A-Z0-9][A-Z0-9.\-^=]{0,11}$")


class WatchlistError(ValueError):
    """A request the rules refuse (limit reached, bad symbol, duplicate name). Maps to 400/404/409."""
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def clean_symbol(raw: str) -> str:
    s = (raw or "").strip().upper()
    if not _SYMBOL.match(s):
        raise WatchlistError(f"'{raw}' is not a ticker symbol")
    return s


def _clean_symbols(raw: List[str]) -> List[str]:
    out: List[str] = []
    for r in raw:
        s = clean_symbol(r)
        if s not in out:
            out.append(s)
    if len(out) > MAX_SYMBOLS:
        raise WatchlistError(f"A list holds at most {MAX_SYMBOLS} symbols")
    return out


def _clean_name(raw: str) -> str:
    name = " ".join((raw or "").split())
    if not name:
        raise WatchlistError("Give the list a name")
    if len(name) > 40:
        raise WatchlistError("Names are at most 40 characters")
    return name


def _out(g: WatchlistGroup) -> Dict:
    return {"id": g.id, "name": g.name, "kind": g.kind, "sector": g.sector, "position": g.position,
            "symbols": json.loads(g.symbols or "[]"), "created_at": g.created_at, "updated_at": g.updated_at}


def _rows(session, user_id: int) -> List[WatchlistGroup]:
    return (session.query(WatchlistGroup).filter(WatchlistGroup.user_id == user_id)
            .order_by(WatchlistGroup.position, WatchlistGroup.id).all())


def _get(session, user_id: int, list_id: int) -> WatchlistGroup:
    g = session.query(WatchlistGroup).filter(WatchlistGroup.user_id == user_id, WatchlistGroup.id == list_id).first()
    if g is None:
        raise WatchlistError("No such list", 404)
    return g


def _name_taken(rows: List[WatchlistGroup], name: str, but: Optional[int] = None) -> bool:
    return any(r.name.lower() == name.lower() and r.id != but for r in rows)


def _seed(session, user_id: int) -> None:
    now = _now()
    legacy = [w.symbol for w in session.query(WatchlistSymbol)
              .filter(WatchlistSymbol.user_id == user_id, WatchlistSymbol.is_active == True)  # noqa: E712
              .order_by(WatchlistSymbol.symbol).all()][:MAX_SYMBOLS]
    session.add(WatchlistGroup(user_id=user_id, name="My watchlist", kind="custom", position=0,
                               symbols=json.dumps(legacy), created_at=now, updated_at=now))
    for i, (sector, syms) in enumerate(SECTOR_LISTS, start=1):
        session.add(WatchlistGroup(user_id=user_id, name=sector, kind="sector", sector=sector, position=i,
                                   symbols=json.dumps(syms), created_at=now, updated_at=now))


def list_groups(user_id: int) -> List[Dict]:
    """Every list of the user, in display order. Seeds the starter set the first time."""
    session = get_session()
    try:
        rows = _rows(session, user_id)
        if not rows:
            _seed(session, user_id)
            session.commit()
            rows = _rows(session, user_id)
        return [_out(g) for g in rows]
    finally:
        session.close()


def create_group(user_id: int, name: str, symbols: List[str]) -> Dict:
    session = get_session()
    try:
        rows = _rows(session, user_id)
        if len(rows) >= MAX_LISTS:
            raise WatchlistError(f"You can have up to {MAX_LISTS} watchlists. Delete one first.", 409)
        name = _clean_name(name)
        if _name_taken(rows, name):
            raise WatchlistError(f"You already have a list called '{name}'", 409)
        now = _now()
        g = WatchlistGroup(user_id=user_id, name=name, kind="custom", position=max((r.position for r in rows), default=-1) + 1,
                           symbols=json.dumps(_clean_symbols(symbols)), created_at=now, updated_at=now)
        session.add(g)
        session.commit()
        return _out(g)
    finally:
        session.close()


def update_group(user_id: int, list_id: int, name: Optional[str] = None, symbols: Optional[List[str]] = None) -> Dict:
    session = get_session()
    try:
        g = _get(session, user_id, list_id)
        if name is not None:
            name = _clean_name(name)
            if _name_taken(_rows(session, user_id), name, but=g.id):
                raise WatchlistError(f"You already have a list called '{name}'", 409)
            g.name = name
        if symbols is not None:
            g.symbols = json.dumps(_clean_symbols(symbols))
        g.updated_at = _now()
        session.commit()
        return _out(g)
    finally:
        session.close()


def delete_group(user_id: int, list_id: int) -> None:
    session = get_session()
    try:
        session.delete(_get(session, user_id, list_id))
        session.commit()
    finally:
        session.close()


def add_symbol(user_id: int, list_id: int, symbol: str) -> Dict:
    session = get_session()
    try:
        g = _get(session, user_id, list_id)
        s = clean_symbol(symbol)
        syms = json.loads(g.symbols or "[]")
        if s not in syms:
            if len(syms) >= MAX_SYMBOLS:
                raise WatchlistError(f"A list holds at most {MAX_SYMBOLS} symbols", 409)
            syms.append(s)
            g.symbols, g.updated_at = json.dumps(syms), _now()
            session.commit()
        return _out(g)
    finally:
        session.close()


def remove_symbol(user_id: int, list_id: int, symbol: str) -> Dict:
    session = get_session()
    try:
        g = _get(session, user_id, list_id)
        s = (symbol or "").strip().upper()
        syms = [x for x in json.loads(g.symbols or "[]") if x != s]
        g.symbols, g.updated_at = json.dumps(syms), _now()
        session.commit()
        return _out(g)
    finally:
        session.close()


def reorder(user_id: int, ids: List[int]) -> List[Dict]:
    """Set the display order; ids not named keep their place after the named ones."""
    session = get_session()
    try:
        rows = _rows(session, user_id)
        rank = {i: n for n, i in enumerate(ids)}
        rows.sort(key=lambda r: (rank.get(r.id, len(ids)), r.position, r.id))
        for n, r in enumerate(rows):
            r.position = n
        session.commit()
        return [_out(g) for g in rows]
    finally:
        session.close()


def restore_sectors(user_id: int) -> List[Dict]:
    """Add back any sector list the user deleted, while there is room under MAX_LISTS."""
    session = get_session()
    try:
        rows = _rows(session, user_id)
        have = {r.sector for r in rows if r.kind == "sector"}
        pos = max((r.position for r in rows), default=-1)
        now, count = _now(), len(rows)
        for sector, syms in SECTOR_LISTS:
            if sector in have:
                continue
            if count >= MAX_LISTS:
                break
            name = sector if not _name_taken(rows, sector) else f"{sector} (sector)"
            pos += 1
            count += 1
            session.add(WatchlistGroup(user_id=user_id, name=name, kind="sector", sector=sector, position=pos,
                                       symbols=json.dumps(syms), created_at=now, updated_at=now))
        session.commit()
        return [_out(g) for g in _rows(session, user_id)]
    finally:
        session.close()
