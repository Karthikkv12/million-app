"""optionflow/modules/market/router.py — search, quotes, company data, price history (HTTP only)."""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends

from optionflow.core.deps import get_current_user
from optionflow.modules.market import service
from optionflow.modules.market.schemas import (
    LiveQuoteOut, PriceHistoryOut, QuoteOut, StockInfoOut, TickerSearchResult, WatchlistRowOut,
)

router = APIRouter(tags=["market"])


@router.get("/search/tickers", response_model=List[TickerSearchResult])
def search_tickers(q: str = "", limit: int = 8) -> List[TickerSearchResult]:
    """Ticker / company search. No auth required."""
    return service.search(q, limit)


@router.get("/market/quotes", response_model=List[QuoteOut])
def market_quotes(symbols: str) -> List[QuoteOut]:
    """Up to 25 quotes. Unauthenticated: used by server-side renders."""
    return service.quotes(symbols)


@router.get("/market/watchlist-quotes", response_model=List[WatchlistRowOut])
def watchlist_quotes(symbols: str, _user=Depends(get_current_user)) -> List[WatchlistRowOut]:
    """Price, change, volume, valuation and range data for up to 150 symbols (cached 5 min)."""
    return service.watchlist_rows(symbols)


@router.get("/quote/{symbol}", response_model=LiveQuoteOut)
def live_quote(symbol: str, _user=Depends(get_current_user)) -> LiveQuoteOut:
    return service.live_quote(symbol)


@router.get("/stocks/{symbol}/info", response_model=StockInfoOut)
def stock_info(symbol: str, _user=Depends(get_current_user)) -> StockInfoOut:
    return service.stock_info(symbol)


@router.get("/stocks/{symbol}/history", response_model=PriceHistoryOut)
def stock_history(symbol: str, period: str = "6mo", interval: str = "1d",
                  _user=Depends(get_current_user)) -> PriceHistoryOut:
    return service.price_history(symbol, period, interval)
