"""optionflow/modules/hedge/scan.py — the tested signal across 100 popular US stocks and ETFs, ranked by fear score.

Same code path as the stock page's read for a ticker you don't hold (hedge.signal.evaluate with held=False): Buy /
Wait / Don't buy yet, the fear score, and the prices that would turn it into Buy. Built in the background from daily
bars (2 years, cached SCAN_BARS_TTL) and the VIX; one scan is shared by every user and kept SCAN_TTL. The user's own
holdings are only marked per request, never stored.
"""
from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from optionflow.modules.hedge import service
from optionflow.modules.hedge import signal as sg

logger = logging.getLogger("optionflow.hedge.scan")

POPULAR_100 = """AAPL MSFT NVDA AMZN GOOGL META TSLA AVGO BRK-B JPM LLY V UNH XOM MA COST HD PG JNJ WMT
NFLX ORCL CRM ADBE AMD INTC QCOM TXN MU AMAT LRCX KLAC TSM ASML ARM SMCI DELL IBM CSCO NOW
PLTR SNOW SHOP UBER ABNB PYPL COIN MSTR HOOD SOFI AFRM UPST RBLX ROKU NET CRWD DDOG MDB PANW ZS
BABA PDD JD BIDU NIO NBIS IONQ RGTI RIVN LCID F GM BA CAT DE GE LMT RTX DIS
BAC WFC C GS MS SCHW KO PEP MCD SBUX NKE CVX OXY PFE MRK ABBV
SPY QQQ IWM DIA SMH""".split()
assert len(POPULAR_100) == 100 and len(set(POPULAR_100)) == 100

SCAN_TTL = 15 * 60.0          # a scan is fresh for 15 minutes
SCAN_BARS_TTL = 3600.0        # daily bars per symbol, hourly
WORKERS = 4                   # parallel fetches (provider rate limits)

_lock = threading.Lock()
_state: Dict[str, Any] = {"at": 0.0, "as_of": None, "rows": [], "building": False, "failed": [], "vix": None, "vix_pct": None}


def _bars(sym: str) -> List[Dict[str, Any]]:
    def load():
        from optionflow.providers.market_data import bars_from_history, get_market_data
        df = get_market_data().price_history(sym, "2y", "1d")
        return bars_from_history(df, intraday=False) if df is not None and not df.empty else []
    return service.CACHE.get("bars2y", sym, SCAN_BARS_TTL, load) or []


def row(sym: str, vix: List[float], vix_dates: List[str], today: str) -> Optional[Dict[str, Any]]:
    """One symbol's read (not held). None when there's no history."""
    bars = _bars(sym)
    if len(bars) < 60:
        return None
    closes = [b["close"] for b in bars]
    spot = closes[-1]
    t = sg.Tape(spot, closes, [b.get("volume") for b in bars], [b.get("high") for b in bars], [b.get("low") for b in bars],
                today_bar=bars[-1]["date"] == today, vix=vix, dates=[b["date"] for b in bars], vix_dates=vix_dates,
                held=False, symbol=sym)
    g = sg.evaluate(t, 1.0)
    px = closes
    m50 = sg.sma(px, 50)
    hi52 = max(px[-252:])
    prev = closes[-2] if len(closes) > 1 else None
    p = g.probability or {}
    plan = g.plan or {}
    return {"symbol": sym, "price": round(spot, 2), "day_change": (spot / prev - 1.0) if prev else None,
            "as_of": bars[-1]["date"], "verdict": g.verdict, "label": service.LABELS["none"][g.verdict],
            "case": p.get("case"), "fear_score": g.fear_score, "rsi": sg.rsi(px),
            "vs_50d": (spot / m50 - 1.0) if m50 else None, "off_high": spot / hi52 - 1.0,
            "buy_below": plan.get("buy_below"), "vix_trigger": plan.get("vix_trigger"),
            "support": (g.support or {}).get("price"), "headline": g.headline,
            "p_edge_positive": p.get("p_edge_positive"), "edge_60": p.get("edge_60")}


def build(symbols: List[str] = POPULAR_100) -> Dict[str, Any]:
    """Compute the scan now (blocking) and store it."""
    vbars = service._daily_bars(service.VIX)
    vix, vix_dates = [b["close"] for b in vbars], [b["date"] for b in vbars]
    today = service._session_frac()[0].isoformat()
    rows, failed = [], []

    def one(sym: str):
        try:
            return sym, row(sym, vix, vix_dates, today)
        except Exception:
            logger.exception("signal scan %s failed", sym)
            return sym, None
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for sym, r in ex.map(one, symbols):
            (rows.append(r) if r else failed.append(sym))
    rows.sort(key=lambda r: (-(r["fear_score"] or 0.0), r["symbol"]))
    vp = sg.vix_percentile(vix) if vix else None
    out = {"at": time.time(), "as_of": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
           "rows": rows, "building": False, "failed": failed, "vix": vix[-1] if vix else None, "vix_pct": vp}
    with _lock:
        _state.update(out)
    return out


def _refresh() -> None:
    try:
        build()
    except Exception:
        logger.exception("signal scan failed")
    finally:
        with _lock:
            _state["building"] = False


def get(held: Optional[set] = None, wait: float = 0.0) -> Dict[str, Any]:
    """The latest scan; starts a background rebuild when it's stale. `wait`: seconds to block for a first scan."""
    with _lock:
        stale = time.time() - _state["at"] > SCAN_TTL
        if stale and not _state["building"]:
            _state["building"] = True
            threading.Thread(target=_refresh, name="signal-scan", daemon=True).start()
    deadline = time.time() + wait
    while wait and not _state["rows"] and _state["building"] and time.time() < deadline:
        time.sleep(0.25)
    with _lock:
        snap = {k: v for k, v in _state.items() if k != "at"}
        snap["rows"] = [dict(r, held=bool(held and r["symbol"] in held)) for r in _state["rows"]]
    snap["universe"] = len(POPULAR_100)
    snap["score_cut"] = sg.SCORE_CUT
    return snap
