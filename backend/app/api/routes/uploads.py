"""File upload: parse, preview, then commit on confirmation."""

from __future__ import annotations

import hashlib
import re
import uuid
from datetime import date
from pathlib import Path

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.core.config import settings
from app.db.session import get_db
from app.models import Hotel, OutletFact, PeriodFact, SegmentFact, Upload, User
from app.parsers.base import ParseResult, ParserError
from app.parsers.registry import PARSER_LABELS, parse_workbook
from app.parsers.utils import MONTH_ABBR, walk_back_months
from app.schemas import (
    CommitResponse,
    CoverageCell,
    CoverageColumn,
    CoverageMatrix,
    CoverageRow,
    PreviewMetric,
    UploadListItem,
    UploadOut,
    UploadPreview,
)
from app.services.ingest import commit_upload, supersede_previous

router = APIRouter(prefix="/api/uploads", tags=["uploads"])

ALLOWED_SUFFIXES = {".xlsx", ".xlsm"}
MAX_BYTES = 40 * 1024 * 1024
FISCAL_YEAR_RE = re.compile(r"^20\d{2}-\d{2}$")

# Headline figures shown on the confirmation screen, in display order.
PREVIEW_ROWS: list[tuple[str, str, str]] = [
    ("turnover", "Total Revenue", "L"),
    ("room_income", "Room Revenue", "L"),
    ("fnb_income", "F&B Revenue", "L"),
    ("ebitda", "EBITDA", "L"),
    ("payroll_cost", "Payroll Cost", "L"),
    ("raw_material_cost", "Raw Material Cost", "L"),
    ("fuel_power_light", "Fuel, Power & Light", "L"),
    ("occupancy_pct", "Occupancy", "%"),
    ("arr", "ARR", "Rs"),
    ("revpar", "RevPAR", "Rs"),
    ("room_inventory", "Room Inventory", "n"),
]


def _fiscal_year_of(month: int, fiscal_year: str) -> None:
    if not FISCAL_YEAR_RE.match(fiscal_year):
        raise HTTPException(
            status_code=422,
            detail="fiscal_year must look like '2025-26'",
        )
    if not 1 <= month <= 12:
        raise HTTPException(status_code=422, detail="month must be between 1 and 12")


def _store_file(content: bytes, hotel: Hotel, fiscal_year: str, month: int, name: str) -> Path:
    folder = settings.storage_path / hotel.code / fiscal_year / f"{month:02d}"
    folder.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", Path(name).name)[-120:]
    target = folder / f"{uuid.uuid4().hex[:12]}_{safe}"
    target.write_bytes(content)
    return target


def _metric_rows(result: ParseResult, period_type: str) -> list[PreviewMetric]:
    scenarios = result.metrics.get(period_type, {})
    rows = []
    for key, label, unit in PREVIEW_ROWS:
        act = scenarios.get("ACT", {}).get(key)
        bud = scenarios.get("BUD", {}).get(key)
        ly = scenarios.get("LY", {}).get(key)
        if act is None and bud is None and ly is None:
            continue
        rows.append(PreviewMetric(key=key, label=label, unit=unit, act=act, bud=bud, ly=ly))
    return rows


def _build_preview(db: Session, upload: Upload, hotel: Hotel, result: ParseResult) -> UploadPreview:
    existing = db.scalar(
        select(PeriodFact).where(
            PeriodFact.hotel_id == hotel.id,
            PeriodFact.fiscal_year == upload.fiscal_year,
            PeriodFact.month == upload.month,
        )
    )
    act_segments = [
        {
            "segment": s.segment,
            "roomsPerDay": s.rooms_per_day,
            "arr": s.arr,
            "revenue": s.room_income,
        }
        for s in result.segments
        if s.period_type == "MTD" and s.scenario == "ACT"
    ]
    act_outlets = [
        {
            "outlet": o.outlet,
            "revenue": o.revenue,
            "covers": o.covers_total,
            "apc": o.apc,
        }
        for o in result.outlets
        if o.period_type == "MTD" and o.scenario == "ACT"
    ]
    return UploadPreview(
        upload_id=upload.id,
        hotel_code=hotel.code,
        hotel_name=hotel.name,
        fiscal_year=upload.fiscal_year,
        month=upload.month,
        month_label=MONTH_ABBR[upload.month],
        parser=result.parser,
        parser_label=PARSER_LABELS.get(result.parser, result.parser),
        detected_fiscal_year=result.fiscal_year,
        detected_month=result.month,
        warnings=result.warnings,
        replaces_existing=existing is not None,
        mtd=_metric_rows(result, "MTD"),
        ytd=_metric_rows(result, "YTD"),
        segment_count=len(act_segments),
        outlet_count=len(act_outlets),
        segments=act_segments,
        outlets=act_outlets,
    )


@router.post("", response_model=UploadPreview, status_code=status.HTTP_201_CREATED)
async def upload_file(
    file: UploadFile = File(...),
    hotel_id: int = Form(...),
    fiscal_year: str = Form(...),
    month: int = Form(...),
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Accept a workbook, parse it and return a preview awaiting confirmation.

    Nothing reaches the fact tables here — the upload sits in ``pending`` until
    the admin confirms the figures on the preview screen.
    """
    _fiscal_year_of(month, fiscal_year)

    hotel = db.get(Hotel, hotel_id)
    if hotel is None:
        raise HTTPException(status_code=404, detail="Hotel not found")

    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(
            status_code=415,
            detail=f"Only Excel workbooks are supported ({', '.join(sorted(ALLOWED_SUFFIXES))}).",
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=422, detail="The uploaded file is empty.")
    if len(content) > MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File is larger than {MAX_BYTES // (1024 * 1024)} MB.",
        )

    stored = _store_file(content, hotel, fiscal_year, month, file.filename or "upload.xlsx")
    upload = Upload(
        hotel_id=hotel.id,
        fiscal_year=fiscal_year,
        month=month,
        original_filename=file.filename or stored.name,
        stored_path=str(stored),
        file_hash=hashlib.sha256(content).hexdigest(),
        file_size=len(content),
        uploaded_by_id=user.id,
        status="pending",
    )
    db.add(upload)
    db.commit()

    try:
        result = parse_workbook(
            stored, target_month=month, target_fiscal_year=fiscal_year
        )
    except ParserError as exc:
        upload.status = "failed"
        upload.error = str(exc)
        db.commit()
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:  # unexpected: keep the record for diagnosis
        upload.status = "failed"
        upload.error = f"{type(exc).__name__}: {exc}"
        db.commit()
        raise HTTPException(
            status_code=500, detail=f"Could not read the workbook: {exc}"
        )

    if (
        result.entity_code
        and hotel.entity_code
        and result.entity_code != hotel.entity_code
    ):
        other = db.scalar(select(Hotel).where(Hotel.entity_code == result.entity_code))
        named = f" which belongs to {other.code} - {other.name}" if other else ""
        result.warnings.insert(
            0,
            f"This file carries entity code {result.entity_code}{named}, but you "
            f"selected {hotel.code} ({hotel.entity_code}). Check the hotel before "
            "confirming.",
        )

    upload.parser = result.parser
    upload.warnings = result.warnings
    upload.payload = result.to_payload()
    db.commit()

    return _build_preview(db, upload, hotel, result)


@router.get("/{upload_id}/preview", response_model=UploadPreview)
def get_preview(
    upload_id: int,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    upload = db.get(Upload, upload_id)
    if upload is None:
        raise HTTPException(status_code=404, detail="Upload not found")
    if not upload.payload:
        raise HTTPException(status_code=409, detail="This upload has no parsed data")
    hotel = db.get(Hotel, upload.hotel_id)
    return _build_preview(db, upload, hotel, _result_from_payload(upload.payload))


@router.post("/{upload_id}/commit", response_model=CommitResponse)
def commit(
    upload_id: int,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    upload = db.get(Upload, upload_id)
    if upload is None:
        raise HTTPException(status_code=404, detail="Upload not found")
    if upload.status == "committed":
        raise HTTPException(status_code=409, detail="This upload is already committed")
    if not upload.payload:
        raise HTTPException(status_code=409, detail="This upload has no parsed data")

    result = _result_from_payload(upload.payload)
    counts = commit_upload(db, upload, result)
    superseded = supersede_previous(db, upload)
    _enforce_retention(db)
    return CommitResponse(
        upload_id=upload.id,
        status=upload.status,
        superseded=superseded,
        **counts,
    )


@router.delete("/{upload_id}", status_code=status.HTTP_204_NO_CONTENT)
def discard(
    upload_id: int,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Delete an upload, its stored file and any figures it published.

    Deleting a committed upload removes the fact rows it produced, so that month
    goes back to showing no data rather than leaving orphaned figures behind.
    """
    upload = db.get(Upload, upload_id)
    if upload is None:
        raise HTTPException(status_code=404, detail="Upload not found")

    for model in (PeriodFact, SegmentFact, OutletFact):
        db.execute(sa_delete(model).where(model.upload_id == upload.id))

    path = Path(upload.stored_path)
    # Bulk-seeded rows point at the original workbook rather than a managed
    # copy, so only remove files that live inside our own storage folder.
    try:
        managed = path.resolve().is_relative_to(settings.storage_path.resolve())
    except (OSError, ValueError):
        managed = False
    if managed and path.exists():
        path.unlink()

    db.delete(upload)
    db.commit()


@router.get("/{upload_id}/download")
def download(
    upload_id: int,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    upload = db.get(Upload, upload_id)
    if upload is None:
        raise HTTPException(status_code=404, detail="Upload not found")
    path = Path(upload.stored_path)
    if not path.exists():
        raise HTTPException(
            status_code=410,
            detail="The stored copy of this workbook is no longer on disk.",
        )
    return FileResponse(
        path,
        filename=upload.original_filename,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@router.get("/coverage", response_model=CoverageMatrix)
def coverage(
    months: int = Query(12, ge=1, le=24),
    end_year: int | None = None,
    end_month: int | None = None,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Which hotel/month combinations already have a workbook loaded.

    Columns run backwards from the most recent month, crossing fiscal-year
    boundaries as needed, so the grid always starts at 'this month'.
    """
    today = date.today()
    year = end_year or today.year
    month = end_month or today.month

    columns = [
        CoverageColumn(
            key=f"{fy}:{m}",
            fiscal_year=fy,
            month=m,
            label=f"{MONTH_ABBR[m]} {cal_year}",
            is_current=(index == 0),
        )
        for index, (fy, m, cal_year) in enumerate(walk_back_months(year, month, months))
    ]
    wanted = {(c.fiscal_year, c.month) for c in columns}

    hotels = db.scalars(
        select(Hotel).where(Hotel.is_active.is_(True)).order_by(Hotel.sort_order, Hotel.code)
    ).all()

    uploads = db.scalars(
        select(Upload)
        .where(Upload.status.in_(("committed", "pending")))
        .order_by(Upload.uploaded_at)
    ).all()

    # Latest upload wins for each hotel/period.
    latest: dict[tuple[int, str, int], Upload] = {}
    for upload in uploads:
        if (upload.fiscal_year, upload.month) not in wanted:
            continue
        latest[(upload.hotel_id, upload.fiscal_year, upload.month)] = upload

    revenue = {
        (fact.hotel_id, fact.fiscal_year, fact.month): fact.turnover
        for fact in db.scalars(
            select(PeriodFact).where(
                PeriodFact.period_type == "MTD", PeriodFact.scenario == "ACT"
            )
        ).all()
    }

    rows = []
    for hotel in hotels:
        cells: dict[str, CoverageCell | None] = {}
        for column in columns:
            upload = latest.get((hotel.id, column.fiscal_year, column.month))
            if upload is None:
                cells[column.key] = None
                continue
            cells[column.key] = CoverageCell(
                upload_id=upload.id,
                status=upload.status,
                original_filename=upload.original_filename,
                file_size=upload.file_size,
                parser=upload.parser,
                uploaded_at=upload.uploaded_at,
                uploaded_by_email=upload.uploaded_by.email if upload.uploaded_by else None,
                has_file=Path(upload.stored_path).exists(),
                warnings=upload.warnings or [],
                revenue=revenue.get((hotel.id, column.fiscal_year, column.month)),
            )
        rows.append(
            CoverageRow(hotel_id=hotel.id, code=hotel.code, name=hotel.name, cells=cells)
        )

    return CoverageMatrix(columns=columns, rows=rows)


@router.get("", response_model=list[UploadListItem])
def list_uploads(
    hotel_id: int | None = None,
    fiscal_year: str | None = None,
    limit: int = 100,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(Upload).order_by(Upload.uploaded_at.desc()).limit(min(limit, 500))
    if hotel_id:
        stmt = stmt.where(Upload.hotel_id == hotel_id)
    if fiscal_year:
        stmt = stmt.where(Upload.fiscal_year == fiscal_year)

    items = []
    for upload in db.scalars(stmt).all():
        hotel = db.get(Hotel, upload.hotel_id)
        items.append(
            UploadListItem(
                **{
                    field: getattr(upload, field)
                    for field in UploadOut.model_fields
                },
                hotel_code=hotel.code if hotel else "",
                hotel_name=hotel.name if hotel else "",
                uploaded_by_email=upload.uploaded_by.email if upload.uploaded_by else None,
            )
        )
    return items


def _result_from_payload(payload: dict) -> ParseResult:
    from app.parsers.base import OutletRow, SegmentRow

    result = ParseResult(parser=payload.get("parser", ""))
    result.fiscal_year = payload.get("fiscal_year")
    result.month = payload.get("month")
    result.entity_code = payload.get("entity_code")
    result.hotel_hint = payload.get("hotel_hint")
    result.room_inventory = payload.get("room_inventory")
    result.metrics = payload.get("metrics", {})
    result.warnings = payload.get("warnings", [])
    result.sheets_used = payload.get("sheets_used", [])
    result.segments = [SegmentRow(**row) for row in payload.get("segments", [])]
    result.outlets = [OutletRow(**row) for row in payload.get("outlets", [])]
    return result


def _enforce_retention(db: Session) -> None:
    """Keep only the most recent N fiscal years of facts."""
    years = sorted(
        {fy for (fy,) in db.execute(select(PeriodFact.fiscal_year).distinct()).all()},
        reverse=True,
    )
    stale = years[settings.retention_years :]
    if not stale:
        return
    for model in (PeriodFact, SegmentFact, OutletFact):
        db.execute(sa_delete(model).where(model.fiscal_year.in_(stale)))
    db.commit()
