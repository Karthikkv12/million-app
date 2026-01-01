from __future__ import annotations

import os

from .base import BrokerAdapter
from .paper import PaperBroker


def broker_enabled() -> bool:
    v = str(os.getenv("BROKER_ENABLED", "0") or "").strip().lower()
    return v in {"1", "true", "yes", "on"}


def get_broker() -> BrokerAdapter:
    provider = str(os.getenv("BROKER_PROVIDER", "paper") or "paper").strip().lower()
    if provider == "paper":
        return PaperBroker()

    raise ValueError(f"Unsupported BROKER_PROVIDER: {provider}")
