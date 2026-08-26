"""SQLAlchemy models for users, hotels, uploads and the fact tables."""

from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

JsonType = JSON().with_variant(JSONB(), "postgresql")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------- #
# Users
# --------------------------------------------------------------------------- #
class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(255), default="")
    hashed_password: Mapped[str] = mapped_column(String(255))
    # "admin" can upload and manage data; "user" is read-only.
    role: Mapped[str] = mapped_column(String(16), default="user")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# --------------------------------------------------------------------------- #
# Hotels ("projects")
# --------------------------------------------------------------------------- #
class Hotel(Base):
    __tablename__ = "hotels"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    # Entity code as printed in the workbooks, e.g. "E_4013". Used to auto-detect
    # which hotel an uploaded file belongs to.
    entity_code: Mapped[str | None] = mapped_column(String(32), index=True, default=None)
    room_inventory: Mapped[int] = mapped_column(Integer, default=0)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    uploads: Mapped[list["Upload"]] = relationship(back_populates="hotel")


# --------------------------------------------------------------------------- #
# Uploads
# --------------------------------------------------------------------------- #
class Upload(Base):
    """One uploaded workbook for a hotel / fiscal-year / month.

    Rows sit in ``pending`` until an admin confirms the parse preview, then move
    to ``committed`` and their values are written into the fact tables.
    """

    __tablename__ = "uploads"

    id: Mapped[int] = mapped_column(primary_key=True)
    hotel_id: Mapped[int] = mapped_column(ForeignKey("hotels.id"), index=True)
    fiscal_year: Mapped[str] = mapped_column(String(9), index=True)  # "2025-26"
    month: Mapped[int] = mapped_column(Integer, index=True)  # calendar month 1-12

    original_filename: Mapped[str] = mapped_column(String(512))
    stored_path: Mapped[str] = mapped_column(String(1024))
    file_hash: Mapped[str] = mapped_column(String(64), index=True)
    file_size: Mapped[int] = mapped_column(Integer, default=0)

    parser: Mapped[str] = mapped_column(String(64), default="")
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    warnings: Mapped[list] = mapped_column(JsonType, default=list)
    # Full normalised parse output, kept so a commit can be replayed or audited.
    payload: Mapped[dict] = mapped_column(JsonType, default=dict)
    error: Mapped[str | None] = mapped_column(Text, default=None)

    uploaded_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), default=None
    )
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )
    committed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )

    hotel: Mapped[Hotel] = relationship(back_populates="uploads")
    uploaded_by: Mapped[User | None] = relationship()


# --------------------------------------------------------------------------- #
# Facts
# --------------------------------------------------------------------------- #
class PeriodFact(Base):
    """P&L + statistics for one hotel / period / scenario.

    ``period_type`` is MTD or YTD; ``scenario`` is ACT, BUD or LY. All money
    values are in INR lakhs, matching the source workbooks.
    """

    __tablename__ = "period_facts"
    __table_args__ = (
        UniqueConstraint(
            "hotel_id",
            "fiscal_year",
            "month",
            "period_type",
            "scenario",
            name="uq_period_fact",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    hotel_id: Mapped[int] = mapped_column(ForeignKey("hotels.id"), index=True)
    fiscal_year: Mapped[str] = mapped_column(String(9), index=True)
    month: Mapped[int] = mapped_column(Integer, index=True)
    period_type: Mapped[str] = mapped_column(String(4), index=True)
    scenario: Mapped[str] = mapped_column(String(4), index=True)
    upload_id: Mapped[int | None] = mapped_column(
        ForeignKey("uploads.id", ondelete="SET NULL"), default=None
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    # -- revenue ----------------------------------------------------------- #
    room_income: Mapped[float | None] = mapped_column(Float, default=None)
    fnb_income: Mapped[float | None] = mapped_column(Float, default=None)
    fnb_other_income: Mapped[float | None] = mapped_column(Float, default=None)
    other_operating_income: Mapped[float | None] = mapped_column(Float, default=None)
    non_operating_income: Mapped[float | None] = mapped_column(Float, default=None)
    turnover: Mapped[float | None] = mapped_column(Float, default=None)

    # -- costs ------------------------------------------------------------- #
    raw_material_cost: Mapped[float | None] = mapped_column(Float, default=None)
    complimentary_cost: Mapped[float | None] = mapped_column(Float, default=None)
    payroll_cost: Mapped[float | None] = mapped_column(Float, default=None)
    stores_supplies: Mapped[float | None] = mapped_column(Float, default=None)
    fuel_power_light: Mapped[float | None] = mapped_column(Float, default=None)
    repairs_maintenance: Mapped[float | None] = mapped_column(Float, default=None)
    renovation_write_off: Mapped[float | None] = mapped_column(Float, default=None)
    rent_rates_taxes: Mapped[float | None] = mapped_column(Float, default=None)
    operating_licence_fees: Mapped[float | None] = mapped_column(Float, default=None)
    licence_fees: Mapped[float | None] = mapped_column(Float, default=None)
    admin_expenses: Mapped[float | None] = mapped_column(Float, default=None)
    advertising_promotion: Mapped[float | None] = mapped_column(Float, default=None)
    corporate_services: Mapped[float | None] = mapped_column(Float, default=None)
    crs_cis_expenses: Mapped[float | None] = mapped_column(Float, default=None)
    operating_expenses: Mapped[float | None] = mapped_column(Float, default=None)

    # -- profit ------------------------------------------------------------ #
    ebitda: Mapped[float | None] = mapped_column(Float, default=None)
    gross_operating_profit: Mapped[float | None] = mapped_column(Float, default=None)
    depreciation: Mapped[float | None] = mapped_column(Float, default=None)
    finance_cost: Mapped[float | None] = mapped_column(Float, default=None)
    pbt: Mapped[float | None] = mapped_column(Float, default=None)

    # -- statistics -------------------------------------------------------- #
    room_inventory: Mapped[float | None] = mapped_column(Float, default=None)
    rpd: Mapped[float | None] = mapped_column(Float, default=None)
    occupancy_pct: Mapped[float | None] = mapped_column(Float, default=None)
    arr: Mapped[float | None] = mapped_column(Float, default=None)
    revpar: Mapped[float | None] = mapped_column(Float, default=None)
    fnb_covers_per_day: Mapped[float | None] = mapped_column(Float, default=None)
    apc: Mapped[float | None] = mapped_column(Float, default=None)

    # -- F&B category split ------------------------------------------------ #
    food_sales: Mapped[float | None] = mapped_column(Float, default=None)
    soft_drink_sales: Mapped[float | None] = mapped_column(Float, default=None)
    beer_sales: Mapped[float | None] = mapped_column(Float, default=None)
    spirits_wines_sales: Mapped[float | None] = mapped_column(Float, default=None)
    smoke_sales: Mapped[float | None] = mapped_column(Float, default=None)
    food_cost: Mapped[float | None] = mapped_column(Float, default=None)
    soft_drink_cost: Mapped[float | None] = mapped_column(Float, default=None)
    beer_cost: Mapped[float | None] = mapped_column(Float, default=None)
    liquor_cost: Mapped[float | None] = mapped_column(Float, default=None)
    smoke_cost: Mapped[float | None] = mapped_column(Float, default=None)


class SegmentFact(Base):
    """Room revenue by market segment (Corporate, Leisure, Transient, ...)."""

    __tablename__ = "segment_facts"
    __table_args__ = (
        UniqueConstraint(
            "hotel_id",
            "fiscal_year",
            "month",
            "period_type",
            "scenario",
            "segment",
            name="uq_segment_fact",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    hotel_id: Mapped[int] = mapped_column(ForeignKey("hotels.id"), index=True)
    fiscal_year: Mapped[str] = mapped_column(String(9), index=True)
    month: Mapped[int] = mapped_column(Integer, index=True)
    period_type: Mapped[str] = mapped_column(String(4), index=True)
    scenario: Mapped[str] = mapped_column(String(4), index=True)
    segment: Mapped[str] = mapped_column(String(32), index=True)
    upload_id: Mapped[int | None] = mapped_column(
        ForeignKey("uploads.id", ondelete="SET NULL"), default=None
    )

    rooms_per_day: Mapped[float | None] = mapped_column(Float, default=None)
    rooms_total: Mapped[float | None] = mapped_column(Float, default=None)
    arr: Mapped[float | None] = mapped_column(Float, default=None)
    room_income: Mapped[float | None] = mapped_column(Float, default=None)
    occupancy_pct: Mapped[float | None] = mapped_column(Float, default=None)


class OutletFact(Base):
    """F&B performance by outlet, with resident / non-resident cover split."""

    __tablename__ = "outlet_facts"
    __table_args__ = (
        UniqueConstraint(
            "hotel_id",
            "fiscal_year",
            "month",
            "period_type",
            "scenario",
            "outlet",
            name="uq_outlet_fact",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    hotel_id: Mapped[int] = mapped_column(ForeignKey("hotels.id"), index=True)
    fiscal_year: Mapped[str] = mapped_column(String(9), index=True)
    month: Mapped[int] = mapped_column(Integer, index=True)
    period_type: Mapped[str] = mapped_column(String(4), index=True)
    scenario: Mapped[str] = mapped_column(String(4), index=True)
    outlet: Mapped[str] = mapped_column(String(128), index=True)
    upload_id: Mapped[int | None] = mapped_column(
        ForeignKey("uploads.id", ondelete="SET NULL"), default=None
    )

    revenue: Mapped[float | None] = mapped_column(Float, default=None)
    covers_resident: Mapped[float | None] = mapped_column(Float, default=None)
    covers_non_resident: Mapped[float | None] = mapped_column(Float, default=None)
    covers_total: Mapped[float | None] = mapped_column(Float, default=None)
    covers_per_day: Mapped[float | None] = mapped_column(Float, default=None)
    apc: Mapped[float | None] = mapped_column(Float, default=None)


PERIOD_METRIC_COLUMNS = [
    c.name
    for c in PeriodFact.__table__.columns
    if c.name
    not in {
        "id",
        "hotel_id",
        "fiscal_year",
        "month",
        "period_type",
        "scenario",
        "upload_id",
        "updated_at",
    }
]
