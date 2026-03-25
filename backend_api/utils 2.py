"""backend_api/utils.py — Shared helpers used across routers."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List

import pandas as pd


def df_records(df: pd.DataFrame) -> List[Dict[str, Any]]:
    """Serialise a DataFrame to a list of JSON-safe dicts.

    All ``pd.Timestamp`` / ``datetime`` values are converted to ISO-8601 strings.
    Returns an empty list when *df* is ``None`` or empty.
    """
    if df is None or df.empty:
        return []
    out: List[Dict[str, Any]] = []
    for rec in df.to_dict(orient="records"):
        cleaned: Dict[str, Any] = {}
        for k, v in rec.items():
            if isinstance(v, (pd.Timestamp, datetime)):
                cleaned[k] = pd.to_datetime(v).to_pydatetime().isoformat()
            else:
                cleaned[k] = v
        out.append(cleaned)
    return out
