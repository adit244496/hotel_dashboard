"""Pydantic request/response models."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


# --------------------------------------------------------------------------- #
# Auth
# --------------------------------------------------------------------------- #
class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    full_name: str
    role: str
    is_active: bool


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    full_name: str = ""
    role: str = Field(default="user", pattern="^(user|admin)$")


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6)


# --------------------------------------------------------------------------- #
# Hotels
# --------------------------------------------------------------------------- #
class HotelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    entity_code: str | None
    room_inventory: int
    sort_order: int
    is_active: bool


class HotelCreate(BaseModel):
    code: str = Field(min_length=1, max_length=16)
    name: str
    entity_code: str | None = None
    room_inventory: int = 0
    sort_order: int = 0


class HotelUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=16)
    name: str | None = None
    entity_code: str | None = None
    room_inventory: int | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class HotelUsage(BaseModel):
    """What a hotel currently has attached, for delete confirmation."""

    hotel_id: int
    code: str
    uploads: int
    months: int
    period_facts: int
    can_delete_cleanly: bool


# --------------------------------------------------------------------------- #
# Uploads
# --------------------------------------------------------------------------- #
class UploadOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    hotel_id: int
    fiscal_year: str
    month: int
    original_filename: str
    file_size: int
    parser: str
    status: str
    warnings: list[str] = []
    error: str | None = None
    uploaded_at: datetime
    committed_at: datetime | None = None


class UploadListItem(UploadOut):
    hotel_code: str = ""
    hotel_name: str = ""
    # Named apart from the ORM relationship of the same purpose so that
    # from_attributes validation cannot pick up the User object itself.
    uploaded_by_email: str | None = None


class CoverageCell(BaseModel):
    upload_id: int
    status: str
    original_filename: str
    file_size: int
    parser: str
    uploaded_at: datetime
    uploaded_by_email: str | None = None
    has_file: bool = True
    warnings: list[str] = []
    revenue: float | None = None


class CoverageColumn(BaseModel):
    key: str
    fiscal_year: str
    month: int
    label: str
    is_current: bool = False


class CoverageRow(BaseModel):
    hotel_id: int
    code: str
    name: str
    cells: dict[str, CoverageCell | None] = {}


class CoverageMatrix(BaseModel):
    columns: list[CoverageColumn]
    rows: list[CoverageRow]


class PreviewMetric(BaseModel):
    key: str
    label: str
    unit: str
    act: float | None = None
    bud: float | None = None
    ly: float | None = None


class UploadPreview(BaseModel):
    upload_id: int
    hotel_code: str
    hotel_name: str
    fiscal_year: str
    month: int
    month_label: str
    parser: str
    parser_label: str
    detected_fiscal_year: str | None = None
    detected_month: int | None = None
    warnings: list[str] = []
    replaces_existing: bool = False
    mtd: list[PreviewMetric] = []
    ytd: list[PreviewMetric] = []
    segment_count: int = 0
    outlet_count: int = 0
    segments: list[dict] = []
    outlets: list[dict] = []


class CommitResponse(BaseModel):
    upload_id: int
    status: str
    periods: int
    segments: int
    outlets: int
    superseded: int = 0
