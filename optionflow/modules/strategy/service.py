"""optionflow/modules/strategy/service.py — the user's strategy and rule overrides (DB)."""
from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from optionflow.core.db import get_session
from optionflow.modules.strategy import catalog

_RULES_TTL = 5.0                     # the desk asks every second; a change shows within 5 s (set() clears it at once)
_rules_cache: Dict[int, tuple] = {}
_lock = threading.Lock()


class StrategyError(ValueError):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _json(raw: Optional[str]) -> Dict[str, Any]:
    try:
        v = json.loads(raw) if raw else {}
    except (TypeError, ValueError):
        return {}
    return v if isinstance(v, dict) else {}


def get_settings(user_id: int) -> Dict[str, Any]:
    """{strategy, rules (effective), overrides, updated_at}."""
    from database.models import StrategySetting as S
    s = get_session()
    try:
        row = s.query(S).filter(S.user_id == user_id).first()
        key = row.strategy if row and row.strategy in catalog.CATALOG else catalog.DEFAULT_KEY
        overrides = catalog.clean_overrides(_json(row.rules) if row else {})
        return {"strategy": key, "rules": catalog.rules_for(key, overrides).to_dict(), "overrides": overrides,
                "updated_at": row.updated_at if row else None}
    finally:
        s.close()


def update_settings(user_id: int, *, strategy: Optional[str] = None, rules: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Partial update. Changing the strategy clears the rule overrides unless new ones are given
    (each strategy has its own defaults). `rules` replaces the stored overrides; {} = defaults."""
    from database.models import StrategySetting as S
    if strategy is not None and strategy not in catalog.CATALOG:
        raise StrategyError(f"Unknown strategy {strategy!r}")
    s = get_session()
    try:
        row = s.query(S).filter(S.user_id == user_id).first()
        if row is None:
            row = S(user_id=user_id, strategy=catalog.DEFAULT_KEY, updated_at=now_iso())
            s.add(row)
        if strategy is not None and strategy != row.strategy:
            row.strategy = strategy
            if rules is None:
                row.rules = None
        if rules is not None:
            row.rules = json.dumps(catalog.clean_overrides(rules)) if rules else None
        row.updated_at = now_iso()
        s.commit()
    finally:
        s.close()
    with _lock:
        _rules_cache.pop(user_id, None)
    return get_settings(user_id)


def rules_for_user(user_id: int) -> Optional[catalog.Rules]:
    """The rules the desk runs for this user; None means the spike wheel (the desk's original playbook)."""
    with _lock:
        hit = _rules_cache.get(user_id)
    if hit and time.time() - hit[0] < _RULES_TTL:
        return hit[1]
    st = get_settings(user_id)
    rules = None if st["strategy"] == catalog.DEFAULT_KEY else catalog.rules_for(st["strategy"], st["overrides"])
    with _lock:
        _rules_cache[user_id] = (time.time(), rules)
    return rules
