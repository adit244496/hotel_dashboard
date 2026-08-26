"""Write a confirmed parse into the fact tables."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import (
    PERIOD_METRIC_COLUMNS,
    Hotel,
    OutletFact,
    PeriodFact,
    SegmentFact,
    Upload,
)
from app.parsers.base import ParseResult
from app.parsers.utils import days_in_period


def commit_upload(db: Session, upload: Upload, result: ParseResult) -> dict:
    """Replace this hotel/period's facts with the values from ``result``.

    Re-uploading a month is expected — a corrected book supersedes the earlier
    one — so existing rows for the same hotel, fiscal year and month are removed
    before the new ones are written.
    """
    hotel = db.get(Hotel, upload.hotel_id)
    scope = {
        "hotel_id": upload.hotel_id,
        "fiscal_year": upload.fiscal_year,
        "month": upload.month,
    }
    for model in (PeriodFact, SegmentFact, OutletFact):
        db.execute(
            delete(model).where(
                model.hotel_id == scope["hotel_id"],
                model.fiscal_year == scope["fiscal_year"],
                model.month == scope["month"],
            )
        )

    counts = {"periods": 0, "segments": 0, "outlets": 0}

    for period_type, scenarios in result.metrics.items():
        for scenario, metrics in scenarios.items():
            values = {k: v for k, v in metrics.items() if k in PERIOD_METRIC_COLUMNS}
            if not values:
                continue
            db.add(
                PeriodFact(
                    **scope,
                    period_type=period_type,
                    scenario=scenario,
                    upload_id=upload.id,
                    **values,
                )
            )
            counts["periods"] += 1

    inventory = result.room_inventory or hotel.room_inventory or 0

    for row in result.segments:
        days = days_in_period(upload.fiscal_year, upload.month, row.period_type)
        rooms_total = row.rooms_per_day * days if row.rooms_per_day is not None else None
        occupancy = (
            (row.rooms_per_day / inventory * 100)
            if row.rooms_per_day is not None and inventory
            else None
        )
        db.add(
            SegmentFact(
                **scope,
                period_type=row.period_type,
                scenario=row.scenario,
                segment=row.segment,
                upload_id=upload.id,
                rooms_per_day=row.rooms_per_day,
                rooms_total=rooms_total,
                arr=row.arr,
                room_income=row.room_income,
                occupancy_pct=occupancy,
            )
        )
        counts["segments"] += 1

    for row in result.outlets:
        db.add(
            OutletFact(
                **scope,
                period_type=row.period_type,
                scenario=row.scenario,
                outlet=row.outlet,
                upload_id=upload.id,
                revenue=row.revenue,
                covers_resident=row.covers_resident,
                covers_non_resident=row.covers_non_resident,
                covers_total=row.covers_total,
                covers_per_day=row.covers_per_day,
                apc=row.apc,
            )
        )
        counts["outlets"] += 1

    # Keep the hotel's headline inventory in step with the latest book.
    if result.room_inventory and hotel and not hotel.room_inventory:
        hotel.room_inventory = int(result.room_inventory)

    upload.status = "committed"
    upload.committed_at = datetime.now(timezone.utc)
    db.commit()
    return counts


def supersede_previous(db: Session, upload: Upload) -> int:
    """Mark earlier committed uploads for the same period as superseded."""
    stmt = select(Upload).where(
        Upload.hotel_id == upload.hotel_id,
        Upload.fiscal_year == upload.fiscal_year,
        Upload.month == upload.month,
        Upload.id != upload.id,
        Upload.status == "committed",
    )
    rows = db.scalars(stmt).all()
    for row in rows:
        row.status = "superseded"
    db.commit()
    return len(rows)
