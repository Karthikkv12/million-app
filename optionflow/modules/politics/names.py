"""optionflow/modules/politics/names.py — ticker ↔ company names for government data.

Lobbying filings and federal contracts name companies, never tickers, so every match goes through a normalised
name: upper case, '&' → AND, punctuation dropped, legal suffixes dropped ("NVIDIA Corporation" → "NVIDIA").
Only exact normalised matches count, so "APPLE" never picks up "Apple Hospitality REIT". Big companies that
lobby or contract under another name (Alphabet → Google) are listed in ALIASES.
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional

_SUFFIX = re.compile(
    r"\b(INCORPORATED|INC|CORPORATION|CORP|COMPANY|COMPANIES|CO|LTD|LIMITED|LLC|LP|LLP|PLC|HOLDINGS?|GROUP|NV|SA|AG|SE|"
    r"THE|CLASS [A-C]|COMMON STOCK|ORDINARY SHARES|ADR|DE|DEL)\b")

# Names a company lobbies / contracts under besides its own (normalised on use).
ALIASES: Dict[str, List[str]] = {
    "GOOGL": ["Alphabet", "Google"], "GOOG": ["Alphabet", "Google"],
    "META": ["Meta Platforms", "Facebook"],
    "AMZN": ["Amazon.com", "Amazon.com Services", "Amazon Web Services", "Amazon"],
    "MSFT": ["Microsoft"], "AAPL": ["Apple"], "NVDA": ["NVIDIA"], "TSLA": ["Tesla", "Tesla Motors"],
    "BRK.B": ["Berkshire Hathaway"], "BRK-B": ["Berkshire Hathaway"],
    "JPM": ["JPMorgan Chase", "JPMorgan Chase & Co"], "GS": ["Goldman Sachs"], "MS": ["Morgan Stanley"],
    "BAC": ["Bank of America"], "WFC": ["Wells Fargo"], "C": ["Citigroup"],
    "UNH": ["UnitedHealth Group", "UnitedHealth"], "CVS": ["CVS Health"], "JNJ": ["Johnson & Johnson"],
    "LLY": ["Eli Lilly", "Eli Lilly and Company"], "PFE": ["Pfizer"], "MRK": ["Merck", "Merck & Co"],
    "XOM": ["Exxon Mobil", "ExxonMobil"], "CVX": ["Chevron", "Chevron USA"],
    "LMT": ["Lockheed Martin"], "RTX": ["RTX", "Raytheon", "Raytheon Technologies"], "NOC": ["Northrop Grumman"],
    "GD": ["General Dynamics"], "BA": ["Boeing", "The Boeing Company"], "LHX": ["L3Harris Technologies", "L3Harris"],
    "T": ["AT&T", "AT&T Services"], "VZ": ["Verizon", "Verizon Communications"], "TMUS": ["T-Mobile USA", "T-Mobile"],
    "CMCSA": ["Comcast", "Comcast Corporation"], "DIS": ["Walt Disney", "The Walt Disney Company"],
    "PLTR": ["Palantir Technologies", "Palantir"], "ORCL": ["Oracle", "Oracle America"], "IBM": ["International Business Machines", "IBM"],
    "INTC": ["Intel"], "AMD": ["Advanced Micro Devices", "AMD"], "QCOM": ["Qualcomm"], "AVGO": ["Broadcom"],
    "WMT": ["Walmart"], "COST": ["Costco Wholesale", "Costco"], "HD": ["Home Depot"], "KO": ["Coca-Cola", "The Coca-Cola Company"],
    "PEP": ["PepsiCo"], "PG": ["Procter & Gamble"], "V": ["Visa", "Visa USA"], "MA": ["Mastercard", "Mastercard International"],
}


def norm(name: Optional[str]) -> str:
    """Comparable form of a company name ('' for none)."""
    s = (name or "").upper().replace("&", " AND ")
    s = re.sub(r"[^A-Z0-9 ]+", " ", s)
    s = _SUFFIX.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()


def candidates(symbol: str, company: Optional[str]) -> List[str]:
    """Normalised names to match for a ticker: its company name plus any aliases (deduplicated, in order)."""
    out: List[str] = []
    for n in [company, *ALIASES.get(symbol.upper(), [])]:
        k = norm(n)
        if k and k not in out:
            out.append(k)
    return out


def matches(name: Optional[str], wanted: List[str]) -> bool:
    return norm(name) in wanted
