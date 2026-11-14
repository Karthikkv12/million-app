"""optionflow/modules/hedge/router.py — /hedge: synced positions, live books, 1-second stream, ingest."""
from __future__ import annotations

import asyncio
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse

from optionflow.core.deps import get_current_user, get_current_user_for_stream
from optionflow.modules.auth import service as auth_service
from optionflow.modules.hedge import portfolio as pf
from optionflow.modules.hedge import service
from optionflow.modules.hedge.schemas import (BrokerActivityOut, BooksOut, BrokerPositionOut, BrokerHistoryPoint, BrokerIncomeOut,
                                              IngestOut, IngestRequest, BrokerPortfolioOut, SignalLogOut, SignalScanOut, StockSignalOut)

router = APIRouter(prefix="/hedge", tags=["hedge"])
stream_router = APIRouter(prefix="/hedge", tags=["hedge"])
broker_router = APIRouter(prefix="/broker", tags=["broker"])


@router.post("/ingest", response_model=IngestOut)
def ingest(body: IngestRequest, x_hedge_ingest_token: Optional[str] = Header(None)) -> IngestOut:
    """Daily broker sync. Replaces positions; upserts today's account values and the activity history.

    Auth: X-Hedge-Ingest-Token (not a user login)."""
    if not service.check_ingest_token(x_hedge_ingest_token):
        raise HTTPException(status_code=401, detail="Bad or missing ingest token")
    user = auth_service.get_user_by_username(body.username) if service.ingest_username_allowed(body.username) else None
    if user is None:                     # same answer for "not the bound user" and "no such user"
        raise HTTPException(status_code=403, detail="This token can't write for that user")
    for p in body.positions:
        if p.kind == "option" and (p.option_type is None or p.strike is None or p.expiry is None):
            raise HTTPException(status_code=422, detail=f"{p.symbol}: options need option_type, strike and expiry")
    rows = [p.model_dump() for p in body.positions]
    for r in rows:
        r["symbol"] = r["symbol"].strip().upper()
    uid = int(user.id)
    count, synced = service.replace_positions(uid, body.source, rows)
    n_acct = pf.upsert_accounts(uid, body.source, [a.model_dump() for a in body.accounts], synced)
    new, total = pf.upsert_activity(uid, body.source, [a.model_dump() for a in body.activity])
    return IngestOut(count=count, synced_at=synced, accounts=n_acct, activity_new=new, activity_total=total)


@router.get("/positions", response_model=List[BrokerPositionOut])
def positions(user=Depends(get_current_user)) -> List[BrokerPositionOut]:
    """Positions from the last broker sync."""
    return [BrokerPositionOut(**p) for p in service.list_positions(int(user["sub"]))]


@router.get("/books", response_model=BooksOut)
def books(user=Depends(get_current_user)) -> BooksOut:
    """Net delta / gamma, IV vs HV and the delta-neutral suggestion for every holding."""
    return BooksOut(**service.books_for(int(user["sub"])))


@router.get("/scan", response_model=SignalScanOut)
def scan(universe: Literal["popular", "sp500"] = Query("popular", description="popular: 100 popular stocks and ETFs; sp500: the S&P 500"),
         user=Depends(get_current_user)) -> SignalScanOut:
    """The backtested signal across a universe, ranked by fear score (Buy / Wait / Don't buy yet, with the close or VIX
    level that would make it Buy). Shared per universe, refreshed every 15 minutes in the background; your holdings are
    marked."""
    from optionflow.modules.hedge import scan as sc
    try:
        held = {p["symbol"].upper() for p in service.list_positions(int(user["sub"]))}
    except Exception:
        held = set()
    return SignalScanOut(**sc.get(held, wait=0.0, universe=universe))   # never block: the page polls while it builds


@router.get("/signal-log", response_model=SignalLogOut)
def signal_log_report(days: int = Query(365, ge=1, le=3650), trigger: Optional[Literal["close", "intraday"]] = Query(None),
                      _user=Depends(get_current_user)) -> SignalLogOut:
    """The live track record: every Signal-scanner Buy / Swing buy / Strong swing buy since it was logged, with what
    the stock did after (entry at the next open, after 0.2% costs), and a summary per kind beside the backtest."""
    from optionflow.modules.hedge import signal_log, swing
    out = signal_log.report(days=days, trigger=trigger)
    out["backtest"] = {"SWING": swing.STATS["oos"], "SWING_STRONG": swing.STATS.get("strong_oos")}
    return SignalLogOut(**out)


@router.get("/signal/{symbol}", response_model=StockSignalOut)
def signal(symbol: str, user=Depends(get_current_user)) -> StockSignalOut:
    """The desk's backtested signal for any ticker: Buy / Wait / Don't buy yet when you don't hold it, Add / Hold /
    Don't add / Roll when you do (any form: it is the Hedge desk's own book signal), with the prices behind it."""
    sym = symbol.strip().upper()
    if not sym or len(sym) > 12 or not all(c.isalnum() or c in ".-^" for c in sym):
        raise HTTPException(status_code=400, detail="Bad symbol")
    return StockSignalOut(**service.signal_for(int(user["sub"]), sym))


@stream_router.get("/stream", response_class=StreamingResponse)
async def stream(
    request: Request,
    interval: float = Query(default=1.0, ge=1.0, le=60.0, description="Seconds between updates"),
    limit: int = Query(default=0, ge=0, description="Stop after this many events (0 = until the client leaves)"),
    user=Depends(get_current_user_for_stream),
) -> StreamingResponse:
    """Server-Sent Events: a `books` event (same body as GET /hedge/books) every `interval` seconds."""
    uid = int(user["sub"])

    async def events():
        yield "retry: 3000\n\n"
        sent = 0
        while not await request.is_disconnected():
            data = await run_in_threadpool(service.books_for, uid)
            yield f"event: books\ndata: {BooksOut(**data).model_dump_json()}\n\n"
            sent += 1
            if limit and sent >= limit:
                return
            await asyncio.sleep(interval)

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ── Portfolio (everything from the broker sync) ──────────────────────────────
@broker_router.get("/portfolio", response_model=BrokerPortfolioOut)
def broker_portfolio(account: Optional[str] = Query(None, description="Masked account label; all if empty"),
                     user=Depends(get_current_user)) -> BrokerPortfolioOut:
    """Account values, holdings with live prices and unrealized P&L, open options."""
    return BrokerPortfolioOut(**pf.portfolio(int(user["sub"]), account))


@broker_router.get("/history", response_model=List[BrokerHistoryPoint])
def broker_history(account: Optional[str] = None, days: int = Query(365, ge=7, le=3650),
                   user=Depends(get_current_user)) -> List[BrokerHistoryPoint]:
    """Daily account value (sum of accounts) from each sync."""
    return [BrokerHistoryPoint(**p) for p in pf.history(int(user["sub"]), account, days)]


@broker_router.get("/income", response_model=BrokerIncomeOut)
def broker_income(account: Optional[str] = None, user=Depends(get_current_user)) -> BrokerIncomeOut:
    """Option premium (net cash from fills) and realized P&L by week, month and symbol."""
    return BrokerIncomeOut(**pf.income(int(user["sub"]), account))


@broker_router.get("/activity", response_model=List[BrokerActivityOut])
def broker_activity(account: Optional[str] = None, limit: int = Query(200, ge=1, le=2000),
                    user=Depends(get_current_user)) -> List[BrokerActivityOut]:
    """Option fills and realized trades, newest first."""
    return [BrokerActivityOut(**a) for a in pf.activity(int(user["sub"]), account, limit)]
