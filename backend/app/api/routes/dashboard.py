"""Read endpoints powering the dashboard."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import User
from app.services import query

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/periods")
def periods(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Fiscal years and months that currently hold data."""
    return {"periods": query.available_periods(db)}


@router.get("")
def get_dashboard(
    fiscal_year: str = Query(..., pattern=r"^20\d{2}-\d{2}$"),
    month: int = Query(..., ge=1, le=12),
    period: str = Query("MTD", pattern="^(MTD|YTD)$"),
    hotels: str | None = Query(None, description="Comma-separated hotel codes"),
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    codes = [c.strip().upper() for c in hotels.split(",") if c.strip()] if hotels else None
    return query.dashboard(db, fiscal_year, month, period, codes)


@router.get("/trend")
def get_trend(
    metric: str = Query("turnover"),
    period: str = Query("MTD", pattern="^(MTD|YTD)$"),
    hotels: str | None = Query(None),
    fiscal_years: str | None = Query(None),
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    codes = [c.strip().upper() for c in hotels.split(",") if c.strip()] if hotels else None
    years = [y.strip() for y in fiscal_years.split(",") if y.strip()] if fiscal_years else None
    try:
        return query.trend(db, metric, period, codes, years)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.get("/growth")
def get_growth(
    metric: str = Query("turnover"),
    fiscal_year: str = Query(..., pattern=r"^20\d{2}-\d{2}$"),
    month: int = Query(..., ge=1, le=12),
    hotels: str | None = Query(None),
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Month-on-month, quarter-on-quarter and year-on-year for one metric."""
    codes = [c.strip().upper() for c in hotels.split(",") if c.strip()] if hotels else None
    try:
        return query.growth(db, metric, fiscal_year, month, codes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
