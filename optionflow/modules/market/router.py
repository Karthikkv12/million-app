"""optionflow/modules/market/router.py — search, quotes, company data, price history (HTTP only)."""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.concurrency import run_in_threadpool

from optionflow.core.deps import get_current_user
from optionflow.modules.market import logos, service
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
def stock_history(symbol: str, period: str = "6mo", interval: str = "1d", prepost: bool = False,
                  _user=Depends(get_current_user)) -> PriceHistoryOut:
    return service.price_history(symbol, period, interval, prepost)


@router.get("/logos/{symbol}", response_class=Response, responses={200: {"content": {"image/png": {}}}, 404: {}})
async def logo(symbol: str) -> Response:
    """A 64×64 PNG tile of the company / fund logo (404 when there is none). No auth: <img> tags can't send a token,
    and logos are public. Cached on disk server-side; browsers may keep it for a week."""
    sym = logos.clean(symbol)
    if sym is None:
        raise HTTPException(status_code=404, detail="Not a ticker")
    data = await run_in_threadpool(logos.get, sym)
    if data is None:
        raise HTTPException(status_code=404, detail="No logo", headers={"Cache-Control": "public, max-age=86400"})
    return Response(data, media_type="image/png", headers={"Cache-Control": "public, max-age=604800"})
