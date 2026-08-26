"""Bulk-load the workbooks sitting in a folder.

Convenience for first-run setup and for back-filling history: it walks a folder
of MIS workbooks, matches each to a hotel by the entity code inside the file,
and commits it for the month you give.

    python seed_from_folder.py --dir .. --month 12 --fiscal-year 2025-26

Add --dry-run to see the matching without writing anything.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")
sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy import select  # noqa: E402

from app.db.init_db import init_db  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.models import Hotel, Upload, User  # noqa: E402
from app.parsers.base import ParserError  # noqa: E402
from app.parsers.registry import parse_workbook  # noqa: E402
from app.services.ingest import commit_upload, supersede_previous  # noqa: E402

# Fallback matching for books that carry no entity code, keyed on a distinctive
# phrase in the hotel name printed inside the file.
NAME_HINTS = {
    "ganga kutir": "TGKRS",
    "chia kutir": "TCK",
    "guras": "TGK",
    "taal kutir": "TTK",
    "raajkutir": "RK",
}


def resolve_hotel(db, result, filename: str) -> Hotel | None:
    if result.entity_code:
        hotel = db.scalar(select(Hotel).where(Hotel.entity_code == result.entity_code))
        if hotel:
            return hotel
    haystack = f"{result.hotel_hint or ''} {filename}".lower()
    for phrase, code in NAME_HINTS.items():
        if phrase in haystack:
            return db.scalar(select(Hotel).where(Hotel.code == code))
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", default="..", help="folder holding the .xlsx files")
    parser.add_argument("--month", type=int, required=True, help="calendar month 1-12")
    parser.add_argument("--fiscal-year", required=True, help="e.g. 2025-26")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    init_db()
    folder = Path(args.dir).resolve()
    files = sorted(p for p in folder.glob("*.xlsx") if not p.name.startswith("~$"))
    if not files:
        print(f"No .xlsx files found in {folder}")
        return 1

    print(f"Scanning {len(files)} workbook(s) in {folder}\n")
    loaded = skipped = 0

    with SessionLocal() as db:
        admin = db.scalar(select(User).where(User.role == "admin"))
        for path in files:
            try:
                result = parse_workbook(
                    path, target_month=args.month, target_fiscal_year=args.fiscal_year
                )
            except ParserError as exc:
                print(f"  SKIP  {path.name}\n        {exc}")
                skipped += 1
                continue

            hotel = resolve_hotel(db, result, path.name)
            if hotel is None:
                print(
                    f"  SKIP  {path.name}\n"
                    f"        Could not tell which hotel this belongs to "
                    f"(entity {result.entity_code or 'n/a'})."
                )
                skipped += 1
                continue

            revenue = result.metrics.get("MTD", {}).get("ACT", {}).get("turnover")
            print(
                f"  {hotel.code:<6} {path.name}\n"
                f"         parser={result.parser} revenue={revenue:,.1f}L"
                if revenue
                else f"  {hotel.code:<6} {path.name}\n         parser={result.parser}"
            )
            for warning in result.warnings:
                print(f"         ! {warning}")

            if args.dry_run:
                loaded += 1
                continue

            content = path.read_bytes()
            upload = Upload(
                hotel_id=hotel.id,
                fiscal_year=args.fiscal_year,
                month=args.month,
                original_filename=path.name,
                stored_path=str(path),
                file_hash=hashlib.sha256(content).hexdigest(),
                file_size=len(content),
                parser=result.parser,
                warnings=result.warnings,
                payload=result.to_payload(),
                uploaded_by_id=admin.id if admin else None,
                status="pending",
            )
            db.add(upload)
            db.commit()
            commit_upload(db, upload, result)
            supersede_previous(db, upload)
            loaded += 1

    verb = "would load" if args.dry_run else "loaded"
    print(f"\n{verb} {loaded} workbook(s); skipped {skipped}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
