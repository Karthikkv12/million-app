"""optionflow/modules/unusual/schemas.py — scanner response (rows stay open while the UI iterates)."""
from __future__ import annotations

from typing import Any, Dict, List

from pydantic import BaseModel, ConfigDict


class UnusualScanOut(BaseModel):
    model_config = ConfigDict(extra="allow")
    rows: List[Dict[str, Any]] = []
    count: int = 0
    symbols: List[str] = []
    call_premium: float = 0.0
    put_premium: float = 0.0
    as_of: str
    source: str
