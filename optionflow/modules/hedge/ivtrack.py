"""optionflow/modules/hedge/ivtrack.py — ATM IV history per symbol, IV rate-of-change and spike flag.

Kept in memory (process lifetime). Samples come from each chain refresh (~every 60 s).
"""
from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Deque, Dict, Optional, Tuple

# Spike rule (protocol §1): ATM IV up sharply while the stock makes a violent move up.
SPIKE_IV_ROC = 0.10        # ATM IV +10% (relative) vs the session's first reading …
SPIKE_IV_ROC_FAST = 0.05   # … or +5% within the last 15 minutes
SPIKE_PRICE_MOVE = 0.015   # with the stock up ≥ 1.5% on the day
FAST_WINDOW_S = 15 * 60
_MAX_SAMPLES = 2000


@dataclass
class IvState:
    atm_iv: Optional[float]
    iv_open: Optional[float]          # first ATM IV seen this UTC day
    iv_roc_day: Optional[float]       # (iv / iv_open) - 1
    iv_roc_15m: Optional[float]       # (iv / iv 15 min ago) - 1
    iv_high: Optional[float]          # highest ATM IV today
    spike: bool                       # rule-1 spike: IV jump + stock up hard
    cooling: bool                     # IV off its high by ≥ 20% of the day's rise → post-spike


class IvTracker:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._samples: Dict[str, Deque[Tuple[float, float]]] = {}

    def record(self, symbol: str, iv: Optional[float], now: Optional[float] = None) -> None:
        if iv is None or iv <= 0:
            return
        t = time.time() if now is None else now
        with self._lock:
            dq = self._samples.setdefault(symbol.upper(), deque(maxlen=_MAX_SAMPLES))
            dq.append((t, float(iv)))

    def reset(self) -> None:
        with self._lock:
            self._samples.clear()

    def state(self, symbol: str, day_change: Optional[float], now: Optional[float] = None) -> IvState:
        t = time.time() if now is None else now
        today = datetime.fromtimestamp(t, timezone.utc).date()
        with self._lock:
            rows = [s for s in self._samples.get(symbol.upper(), ()) if datetime.fromtimestamp(s[0], timezone.utc).date() == today]
        if not rows:
            return IvState(None, None, None, None, None, False, False)
        iv = rows[-1][1]
        iv_open = rows[0][1]
        iv_high = max(v for _, v in rows)
        past = [v for ts, v in rows if ts <= t - FAST_WINDOW_S]
        iv_15 = past[-1] if past else rows[0][1]
        roc_day = iv / iv_open - 1.0 if iv_open else None
        roc_15 = iv / iv_15 - 1.0 if iv_15 else None
        up_hard = day_change is not None and day_change >= SPIKE_PRICE_MOVE
        spike = up_hard and ((roc_day or 0) >= SPIKE_IV_ROC or (roc_15 or 0) >= SPIKE_IV_ROC_FAST)
        rise = iv_high - iv_open
        cooling = rise > 0 and (iv_high - iv) >= 0.2 * rise and (iv_high / iv_open - 1.0) >= SPIKE_IV_ROC_FAST
        return IvState(iv, iv_open, roc_day, roc_15, iv_high, spike, cooling)


TRACKER = IvTracker()
