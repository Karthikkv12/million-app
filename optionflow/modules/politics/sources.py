"""optionflow/modules/politics/sources.py — the three outside sources, raw calls only (no caching here).

- Lobbying: lda.gov (the Senate's LDA API moved there in mid-2026). Free; an optional key raises the rate limit.
- Federal contracts: api.usaspending.gov. Free, no key.
- Congressional trades: Financial Modeling Prep /stable/senate-trades and /stable/house-trades (paid plan, key in
  FMP_API_KEY). Without a key this source reports "not configured". Field names are read defensively.
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Any, Dict, List, Optional

import httpx

from optionflow.core.settings import get_settings

log = logging.getLogger(__name__)

LDA = "https://lda.gov/api/v1"
USASPENDING = "https://api.usaspending.gov/api/v2"
FMP = "https://financialmodelingprep.com/stable"
UA = {"User-Agent": "optionflow/1.0"}
TIMEOUT = 25
CONTRACT_TYPES = ["A", "B", "C", "D"]          # definitive contracts, purchase orders, delivery orders, BPA calls


class NotConfigured(Exception):
    """The source needs a key the server doesn't have."""


# ── Lobbying ─────────────────────────────────────────────────────────────────
def lda_filings(client_query: str, year: int, max_pages: int = 4) -> List[Dict[str, Any]]:
    """Every LDA filing for `year` whose client name contains `client_query` (the API matches loosely; callers
    keep exact name matches only)."""
    key = get_settings().lda_api_key
    headers = {**UA, **({"Authorization": f"Token {key}"} if key else {})}
    url: Optional[str] = f"{LDA}/filings/"
    params: Optional[Dict[str, Any]] = {"client_name": client_query, "filing_year": year, "page_size": 100}
    out: List[Dict[str, Any]] = []
    for _ in range(max_pages):
        r = httpx.get(url, params=params, headers=headers, timeout=TIMEOUT, follow_redirects=True)
        r.raise_for_status()
        data = r.json()
        out.extend(data.get("results") or [])
        url, params = data.get("next"), None
        if not url:
            break
    return out


# ── Federal contracts ────────────────────────────────────────────────────────
def _usa(category: str, name: str, start: date, end: date, limit: int) -> List[Dict[str, Any]]:
    body = {"filters": {"recipient_search_text": [name],
                        "time_period": [{"start_date": start.isoformat(), "end_date": end.isoformat()}],
                        "award_type_codes": CONTRACT_TYPES},
            "limit": limit}
    r = httpx.post(f"{USASPENDING}/search/spending_by_category/{category}/", json=body, headers=UA, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json().get("results") or []


def contract_recipients(name: str, start: date, end: date) -> List[Dict[str, Any]]:
    """[{name, amount, uei}] recipients whose name matches `name`, contract dollars obligated in the window."""
    return _usa("recipient", name, start, end, 50)


def contract_agencies(name: str, start: date, end: date) -> List[Dict[str, Any]]:
    """[{name, amount}] awarding agencies for recipients matching `name`."""
    return _usa("awarding_agency", name, start, end, 10)


# ── Congressional trades ─────────────────────────────────────────────────────
def _fmp(path: str, **params: Any) -> List[Dict[str, Any]]:
    key = get_settings().fmp_api_key
    if not key:
        raise NotConfigured("FMP_API_KEY is not set")
    r = httpx.get(f"{FMP}/{path}", params={**params, "apikey": key}, headers=UA, timeout=TIMEOUT)
    r.raise_for_status()
    data = r.json()
    if isinstance(data, dict):                     # FMP reports errors as {"Error Message": ...}
        raise RuntimeError(str(data.get("Error Message") or data)[:200])
    return data or []


def congress_trades(symbol: str) -> List[Dict[str, Any]]:
    """Raw senate + house disclosures for one ticker, each tagged with its chamber."""
    out = []
    for chamber, path in (("Senate", "senate-trades"), ("House", "house-trades")):
        out.extend({**t, "_chamber": chamber} for t in _fmp(path, symbol=symbol.upper()))
    return out


def congress_latest(limit: int = 100) -> List[Dict[str, Any]]:
    """The newest disclosures from both chambers (all tickers)."""
    out = []
    for chamber, path in (("Senate", "senate-latest"), ("House", "house-latest")):
        out.extend({**t, "_chamber": chamber} for t in _fmp(path, page=0, limit=limit))
    return out
