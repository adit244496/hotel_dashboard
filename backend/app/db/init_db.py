"""Schema creation and first-run seeding."""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.db.session import Base, SessionLocal, engine
from app.models import Hotel, User  # noqa: F401  (registers the tables)

log = logging.getLogger(__name__)

# The seven properties in the reporting pack, with the entity code printed in
# each workbook so uploads can be matched to the right hotel automatically.
DEFAULT_HOTELS = [
    ("CCNT", "Taj City Centre New Town", "E_4013", 147, 1),
    ("CCPT", "Taj City Centre Patna", "E_4019", 124, 2),
    ("TCK", "Taj Chia Kutir", "E_4005", 73, 3),
    ("TGK", "Taj Guras Kutir", "E_4016", 69, 4),
    ("TTK", "Taj Taal Kutir", "E_4009", 75, 5),
    ("RK", "Taj Raajkutir", "E_4010", 48, 6),
    ("TGKRS", "Taj Ganga Kutir Raichak", None, 110, 7),
]


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        _seed_admin(db)
        _seed_hotels(db)


def _seed_admin(db: Session) -> None:
    if db.scalar(select(User).limit(1)):
        return
    email = settings.first_admin_email.lower()
    db.add(
        User(
            email=email,
            full_name="Administrator",
            role="admin",
            hashed_password=hash_password(settings.first_admin_password),
        )
    )
    db.commit()
    log.info("Created the initial administrator account: %s", email)


def _seed_hotels(db: Session) -> None:
    if db.scalar(select(Hotel).limit(1)):
        return
    for code, name, entity, inventory, order in DEFAULT_HOTELS:
        db.add(
            Hotel(
                code=code,
                name=name,
                entity_code=entity,
                room_inventory=inventory,
                sort_order=order,
            )
        )
    db.commit()
    log.info("Seeded %d hotels", len(DEFAULT_HOTELS))
