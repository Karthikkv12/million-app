"""optionflow/modules/strategy/schemas.py — request/response models."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class StrategyInfo(BaseModel):
    key: str
    name: str
    summary: str
    steps: List[List[str]]
    sides: str = Field(..., description="put | call | both: the legs it opens")
    buys_options: bool
    defaults: Dict[str, Any]


class StrategySettingsOut(BaseModel):
    strategy: str
    rules: Dict[str, Any] = Field(..., description="Effective rules: the strategy's defaults + overrides")
    overrides: Dict[str, Any]
    updated_at: Optional[str] = None


class StrategyOut(StrategySettingsOut):
    strategies: List[StrategyInfo]


class StrategyUpdate(BaseModel):
    strategy: Optional[str] = Field(None, max_length=40)
    rules: Optional[Dict[str, Any]] = Field(None, description="Overrides of the strategy's rules; {} = defaults")
