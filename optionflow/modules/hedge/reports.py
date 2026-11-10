"""optionflow/modules/hedge/reports.py — /reports: the daily report pages (morning, evening, weekend).

A scheduled task builds each report as one HTML page, publishes it as an artifact and POSTs the same HTML
here (same token as the broker sync). The app shows the latest page per slug in a sandboxed frame, so the
page's own scripts can't reach the app or its login.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from optionflow.core.db import get_session
from optionflow.core.deps import get_current_user
from optionflow.modules.auth import service as auth_service
from optionflow.modules.hedge import service

MAX_HTML = 4_000_000          # characters; the weekend report with charts is ~1 MB

router = APIRouter(prefix="/reports", tags=["reports"])


class ReportIngest(BaseModel):
    username: str = Field(..., max_length=64)
    slug: str = Field(..., pattern=r"^[a-z0-9][a-z0-9-]{0,31}$", description='"morning", "evening", "weekend"')
    title: str = Field(..., min_length=1, max_length=200)
    html: str = Field(..., min_length=1, max_length=MAX_HTML)
    source_url: Optional[str] = Field(None, max_length=500, pattern=r"^https://")


class ReportMeta(BaseModel):
    slug: str
    title: str
    published_at: str
    source_url: Optional[str] = None
    size: int = Field(..., description="Characters of HTML")


class ReportOut(ReportMeta):
    html: str


def _meta(r) -> dict:
    return {"slug": r.slug, "title": r.title, "published_at": r.published_at, "source_url": r.source_url,
            "size": len(r.html or "")}


@router.post("/ingest", response_model=ReportMeta)
def ingest(body: ReportIngest, x_hedge_ingest_token: Optional[str] = Header(None)) -> ReportMeta:
    """Publish (replace) one report page. Auth: X-Hedge-Ingest-Token, bound to one user."""
    from database.models import Report
    if not service.check_ingest_token(x_hedge_ingest_token):
        raise HTTPException(status_code=401, detail="Bad or missing ingest token")
    user = auth_service.get_user_by_username(body.username) if service.ingest_username_allowed(body.username) else None
    if user is None:
        raise HTTPException(status_code=403, detail="This token can't write for that user")
    session = get_session()
    try:
        row = session.query(Report).filter(Report.user_id == int(user.id), Report.slug == body.slug).first()
        if row is None:
            row = Report(user_id=int(user.id), slug=body.slug)
            session.add(row)
        row.title, row.html, row.source_url, row.published_at = body.title.strip(), body.html, body.source_url, service.now_iso()
        session.commit()
        return ReportMeta(**_meta(row))
    finally:
        session.close()


@router.get("", response_model=List[ReportMeta])
def list_reports(user=Depends(get_current_user)) -> List[ReportMeta]:
    """The user's report pages, newest first (without the HTML)."""
    from database.models import Report
    session = get_session()
    try:
        rows = session.query(Report).filter(Report.user_id == int(user["sub"])).order_by(Report.published_at.desc()).all()
        return [ReportMeta(**_meta(r)) for r in rows]
    finally:
        session.close()


@router.get("/{slug}", response_model=ReportOut)
def get_report(slug: str, user=Depends(get_current_user)) -> ReportOut:
    from database.models import Report
    session = get_session()
    try:
        row = session.query(Report).filter(Report.user_id == int(user["sub"]), Report.slug == slug).first()
        if row is None:
            raise HTTPException(status_code=404, detail="No such report yet")
        return ReportOut(**_meta(row), html=row.html)
    finally:
        session.close()
