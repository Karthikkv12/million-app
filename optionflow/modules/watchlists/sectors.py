"""The starter lists: one per sector, the sector's SPDR ETF first, then its biggest names.

Sector names match Yahoo's (what /market/watchlist-quotes returns), so a list lines up with the
Portfolio sector wheel. Edit freely: a user's copy is theirs once seeded.
"""
from __future__ import annotations

from typing import List, Tuple

SECTOR_LISTS: List[Tuple[str, List[str]]] = [
    ("Technology",             ["XLK", "AAPL", "MSFT", "NVDA", "AVGO", "ORCL", "AMD", "CRM", "ADBE", "QCOM", "TSM"]),
    ("Communication Services", ["XLC", "GOOGL", "META", "NFLX", "DIS", "TMUS", "VZ", "T", "CMCSA", "SPOT"]),
    ("Consumer Cyclical",      ["XLY", "AMZN", "TSLA", "HD", "MCD", "BKNG", "TJX", "LOW", "NKE", "SBUX"]),
    ("Financial Services",     ["XLF", "JPM", "V", "MA", "BAC", "GS", "MS", "WFC", "BLK", "PYPL"]),
    ("Healthcare",             ["XLV", "LLY", "UNH", "JNJ", "ABBV", "MRK", "TMO", "ABT", "AMGN", "PFE"]),
    ("Industrials",            ["XLI", "GE", "CAT", "RTX", "UBER", "HON", "BA", "UNP", "DE", "LMT"]),
    ("Consumer Defensive",     ["XLP", "WMT", "COST", "PG", "KO", "PEP", "PM", "MO", "MDLZ", "CL"]),
    ("Energy",                 ["XLE", "XOM", "CVX", "COP", "EOG", "SLB", "MPC", "PSX", "OXY"]),
    ("Utilities",              ["XLU", "NEE", "SO", "CEG", "DUK", "VST", "AEP", "D", "SRE"]),
    ("Real Estate",            ["XLRE", "PLD", "WELL", "AMT", "EQIX", "SPG", "O", "PSA", "DLR"]),
    ("Basic Materials",        ["XLB", "LIN", "SHW", "ECL", "APD", "FCX", "NEM", "NUE", "DOW", "MP"]),
]
