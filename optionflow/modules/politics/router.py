"""optionflow/modules/politics/router.py — political influence: per stock, per basket, and the latest feed."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool

from optionflow.core.deps import get_current_user
from optionflow.modules.politics import service
from optionflow.modules.politics.names import norm
from optionflow.modules.politics.schemas import PoliticalFeed, PoliticalProfile, PoliticalSummary

router = APIRouter(prefix="/politics", tags=["politics"])


def _symbols(raw: Optional[str], cap: int) -> list[str]:
    syms = [s.strip().upper() for s in (raw or "").split(",") if s.strip()]
    if len(syms) > cap:
        raise HTTPException(status_code=400, detail=f"At most {cap} symbols")
    return syms


@router.get("/summary", response_model=PoliticalSummary)
def summary(symbols: str = Query(..., description="Comma-separated tickers (max 200)"),
            _user=Depends(get_current_user)) -> PoliticalSummary:
    """Compact political figures for many tickers (sector rows). Never waits on the sources: tickers without
    a cached profile come back in `pending` and are fetched in the background."""
    return PoliticalSummary(**service.summary(_symbols(symbols, 200)))


@router.get("/feed", response_model=PoliticalFeed)
async def feed(symbols: Optional[str] = Query(None, description="Only these tickers (comma-separated, max 200)"),
               days: int = Query(30, ge=1, le=365), _user=Depends(get_current_user)) -> PoliticalFeed:
    """The newest congressional trade disclosures and, for `symbols`, their latest lobbying quarter."""
    return PoliticalFeed(**await run_in_threadpool(service.feed, _symbols(symbols, 200), days))


@router.get("/{symbol}", response_model=PoliticalProfile)
async def political_profile(symbol: str, refresh: bool = False, _user=Depends(get_current_user)) -> PoliticalProfile:
    """Congressional trades, lobbying and federal contracts for one ticker (cached 12 h)."""
    sym = symbol.strip().upper()
    if not sym or len(sym) > 12 or not norm(sym.replace(".", "").replace("-", "")):
        raise HTTPException(status_code=404, detail="Not a ticker")
    return PoliticalProfile(**service.public(await run_in_threadpool(service.profile, sym, refresh)))
