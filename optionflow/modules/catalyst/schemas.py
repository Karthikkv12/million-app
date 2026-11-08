"""optionflow/modules/catalyst/schemas.py — the catalysts response.

Top-level sections are declared; nested sections stay open dictionaries
(extra="allow") because the cloud session is still iterating on them.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict


class CatalystSignal(BaseModel):
    label: str
    tone: str            # good | bad | warn | neutral


class CatalystsOut(BaseModel):
    model_config = ConfigDict(extra="allow")
    symbol: str
    name: Optional[str] = None
    price: Optional[float] = None
    change_pct: Optional[float] = None
    earnings: Optional[Dict[str, Any]] = None
    dividend: Optional[Dict[str, Any]] = None
    expected_move: Optional[Dict[str, Any]] = None
    earnings_history: List[Dict[str, Any]] = []
    analysts: Optional[Dict[str, Any]] = None
    volume: Optional[Dict[str, Any]] = None
    range: Optional[Dict[str, Any]] = None
    news: List[Dict[str, Any]] = []
    signals: List[CatalystSignal] = []
    as_of: Optional[str] = None
    source: Optional[str] = None
