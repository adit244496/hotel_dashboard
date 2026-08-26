"""Hotel (project) administration."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete as sa_delete
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.core.config import settings
from app.db.session import get_db
from app.models import Hotel, OutletFact, PeriodFact, SegmentFact, Upload, User
from app.schemas import HotelCreate, HotelOut, HotelUpdate, HotelUsage

router = APIRouter(prefix="/api/hotels", tags=["hotels"])


def _get_or_404(db: Session, hotel_id: int) -> Hotel:
    hotel = db.get(Hotel, hotel_id)
    if hotel is None:
        raise HTTPException(status_code=404, detail="Hotel not found")
    return hotel


def _usage(db: Session, hotel: Hotel) -> HotelUsage:
    uploads = db.scalar(
        select(func.count()).select_from(Upload).where(Upload.hotel_id == hotel.id)
    )
    facts = db.scalar(
        select(func.count()).select_from(PeriodFact).where(PeriodFact.hotel_id == hotel.id)
    )
    months = db.scalar(
        select(func.count(func.distinct(PeriodFact.month))).where(
            PeriodFact.hotel_id == hotel.id
        )
    )
    return HotelUsage(
        hotel_id=hotel.id,
        code=hotel.code,
        uploads=uploads or 0,
        months=months or 0,
        period_facts=facts or 0,
        can_delete_cleanly=not (uploads or facts),
    )


@router.get("", response_model=list[HotelOut])
def list_hotels(
    include_inactive: bool = False,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(Hotel).order_by(Hotel.sort_order, Hotel.code)
    if not include_inactive:
        stmt = stmt.where(Hotel.is_active.is_(True))
    return [HotelOut.model_validate(h) for h in db.scalars(stmt).all()]


@router.post("", response_model=HotelOut, status_code=status.HTTP_201_CREATED)
def create_hotel(
    payload: HotelCreate,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    code = payload.code.strip().upper()
    if db.scalar(select(Hotel).where(Hotel.code == code)):
        raise HTTPException(status_code=409, detail=f"Hotel '{code}' already exists")
    entity = (payload.entity_code or "").strip().upper() or None
    _assert_entity_free(db, entity, None)
    hotel = Hotel(
        code=code,
        name=payload.name.strip(),
        entity_code=entity,
        room_inventory=payload.room_inventory,
        sort_order=payload.sort_order,
    )
    db.add(hotel)
    db.commit()
    return HotelOut.model_validate(hotel)


def _assert_entity_free(db: Session, entity: str | None, hotel_id: int | None) -> None:
    """Entity codes drive upload matching, so they must stay unique."""
    if not entity:
        return
    clash = db.scalar(select(Hotel).where(Hotel.entity_code == entity))
    if clash and clash.id != hotel_id:
        raise HTTPException(
            status_code=409,
            detail=f"Entity code {entity} is already used by {clash.code} — {clash.name}.",
        )


@router.patch("/{hotel_id}", response_model=HotelOut)
def update_hotel(
    hotel_id: int,
    payload: HotelUpdate,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    hotel = _get_or_404(db, hotel_id)
    fields = payload.model_dump(exclude_unset=True)

    if "code" in fields and fields["code"]:
        code = fields["code"].strip().upper()
        clash = db.scalar(select(Hotel).where(Hotel.code == code))
        if clash and clash.id != hotel.id:
            raise HTTPException(status_code=409, detail=f"Hotel '{code}' already exists")
        fields["code"] = code

    if "entity_code" in fields:
        entity = (fields["entity_code"] or "").strip().upper() or None
        _assert_entity_free(db, entity, hotel.id)
        fields["entity_code"] = entity

    if "name" in fields and fields["name"] is not None:
        fields["name"] = fields["name"].strip()

    for field, value in fields.items():
        setattr(hotel, field, value)
    db.commit()
    return HotelOut.model_validate(hotel)


@router.get("/{hotel_id}/usage", response_model=HotelUsage)
def hotel_usage(
    hotel_id: int,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return _usage(db, _get_or_404(db, hotel_id))


@router.delete("/{hotel_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_hotel(
    hotel_id: int,
    cascade: bool = Query(
        False,
        description="Also delete this hotel's uploads and reported figures.",
    ),
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Remove a hotel.

    A hotel that has reported data is refused unless ``cascade`` is set, so a
    stray click cannot wipe months of history. Deactivating the hotel instead
    (PATCH ``is_active=false``) hides it from the dashboard while keeping the
    data intact.
    """
    hotel = _get_or_404(db, hotel_id)
    usage = _usage(db, hotel)

    if not usage.can_delete_cleanly and not cascade:
        raise HTTPException(
            status_code=409,
            detail=(
                f"{hotel.code} has {usage.uploads} upload(s) and figures for "
                f"{usage.months} month(s). Delete those too by confirming, or "
                f"deactivate the hotel to hide it while keeping its history."
            ),
        )

    if cascade:
        uploads = db.scalars(select(Upload).where(Upload.hotel_id == hotel.id)).all()
        storage_root = settings.storage_path.resolve()
        for upload in uploads:
            path = Path(upload.stored_path)
            # Only remove copies we manage; bulk-seeded rows point at originals.
            try:
                managed = path.resolve().is_relative_to(storage_root)
            except (OSError, ValueError):
                managed = False
            if managed and path.exists():
                path.unlink()
        for model in (PeriodFact, SegmentFact, OutletFact, Upload):
            db.execute(sa_delete(model).where(model.hotel_id == hotel.id))

    db.delete(hotel)
    db.commit()
