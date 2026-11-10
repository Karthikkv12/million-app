"""optionflow/modules/hedge/reports.py — /reports: the daily report pages (morning, evening, weekend).

A scheduled task builds each report as one HTML page, publishes it as an artifact and POSTs the same HTML
here (same token as the broker sync). One page is kept per report per day, so the app can go back by date.
The app shows a page in a sandboxed frame, so the page's own scripts can't reach the app or its login.
"""
from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field

from optionflow.core.db import get_session
from optionflow.core.deps import get_current_user
from optionflow.modules.auth import service as auth_service
from optionflow.modules.hedge import service

MAX_HTML = 4_000_000          # characters; the weekend report with charts is ~1 MB
DAY = r"^\d{4}-\d{2}-\d{2}$"
ET = ZoneInfo("America/New_York")

router = APIRouter(prefix="/reports", tags=["reports"])


def today_et() -> str:
    return datetime.now(ET).date().isoformat()


class ReportIngest(BaseModel):
    username: str = Field(..., max_length=64)
    slug: str = Field(..., pattern=r"^[a-z0-9][a-z0-9-]{0,31}$", description='"morning", "evening", "weekend"')
    title: str = Field(..., min_length=1, max_length=200)
    html: str = Field(..., min_length=1, max_length=MAX_HTML)
    source_url: Optional[str] = Field(None, max_length=500, pattern=r"^https://")
    day: Optional[str] = Field(None, pattern=DAY, description="Date the report is for; default: today in US Eastern")


class ReportMeta(BaseModel):
    slug: str
    day: str = Field(..., description="YYYY-MM-DD the report is for (US Eastern)")
    title: str
    published_at: str
    source_url: Optional[str] = None
    size: int = Field(..., description="Characters of HTML")


class ReportSummary(ReportMeta):
    """The latest page of one report, plus every day it has a page for (newest first)."""
    days: List[str] = []


class ReportOut(ReportMeta):
    html: str


def _meta(r) -> dict:
    return {"slug": r.slug, "day": r.day, "title": r.title, "published_at": r.published_at,
            "source_url": r.source_url, "size": len(r.html or "")}


@router.post("/ingest", response_model=ReportMeta)
def ingest(body: ReportIngest, x_hedge_ingest_token: Optional[str] = Header(None)) -> ReportMeta:
    """Publish one report page for one day (replaces that day's page; other days are kept).

    Auth: X-Hedge-Ingest-Token, bound to one user."""
    from database.models import Report
    if not service.check_ingest_token(x_hedge_ingest_token):
        raise HTTPException(status_code=401, detail="Bad or missing ingest token")
    user = auth_service.get_user_by_username(body.username) if service.ingest_username_allowed(body.username) else None
    if user is None:
        raise HTTPException(status_code=403, detail="This token can't write for that user")
    day = body.day or today_et()
    try:
        datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=422, detail="day must be a real date, YYYY-MM-DD")
    session = get_session()
    try:
        row = session.query(Report).filter(Report.user_id == int(user.id), Report.slug == body.slug, Report.day == day).first()
        if row is None:
            row = Report(user_id=int(user.id), slug=body.slug, day=day)
            session.add(row)
        row.title, row.html, row.source_url, row.published_at = body.title.strip(), body.html, body.source_url, service.now_iso()
        session.commit()
        return ReportMeta(**_meta(row))
    finally:
        session.close()


@router.get("", response_model=List[ReportSummary])
def list_reports(user=Depends(get_current_user)) -> List[ReportSummary]:
    """Each report's latest page (without the HTML) and the days it can be opened for."""
    from sqlalchemy import func
    from database.models import Report
    session = get_session()
    try:
        uid = int(user["sub"])
        rows = (session.query(Report.slug, Report.day, Report.title, Report.published_at, Report.source_url,
                              func.length(Report.html))
                .filter(Report.user_id == uid).order_by(Report.day.desc(), Report.published_at.desc()).all())
        out: Dict[str, dict] = {}
        for slug, day, title, published_at, source_url, size in rows:      # newest first: the first row per slug is the latest
            o = out.setdefault(slug, {"slug": slug, "day": day, "title": title, "published_at": published_at,
                                      "source_url": source_url, "size": int(size or 0), "days": []})
            o["days"].append(day)
        return [ReportSummary(**o) for o in out.values()]
    finally:
        session.close()


@router.get("/{slug}", response_model=ReportOut)
def get_report(slug: str, day: Optional[str] = Query(None, pattern=DAY, description="Default: the latest day"),
               user=Depends(get_current_user)) -> ReportOut:
    from database.models import Report
    session = get_session()
    try:
        q = session.query(Report).filter(Report.user_id == int(user["sub"]), Report.slug == slug)
        row = q.filter(Report.day == day).first() if day else q.order_by(Report.day.desc()).first()
        if row is None:
            raise HTTPException(status_code=404, detail="No such report for that day" if day else "No such report yet")
        return ReportOut(**_meta(row), html=row.html)
    finally:
        session.close()
