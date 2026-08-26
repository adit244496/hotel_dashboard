"""End-to-end smoke test: login -> upload all books -> commit -> read dashboard.

Run against a throwaway database so it never touches real data:

    python smoke_test.py
"""

from __future__ import annotations

import os
import sys
import tempfile
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")

DB_PATH = Path(tempfile.gettempdir()) / "hotel_dashboard_smoke.db"
if DB_PATH.exists():
    DB_PATH.unlink()
os.environ.setdefault("DATABASE_URL", f"sqlite:///{DB_PATH.as_posix()}")
os.environ.setdefault("STORAGE_DIR", str(Path(tempfile.gettempdir()) / "hotel_smoke_uploads"))
os.environ.setdefault("FIRST_ADMIN_EMAIL", "admin@hotelgroup.in")
os.environ.setdefault("FIRST_ADMIN_PASSWORD", "admin123")

sys.path.insert(0, str(Path(__file__).parent))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

SOURCE_DIR = Path(__file__).resolve().parents[1]

# Which workbook belongs to which hotel.
FILES = {
    "CCNT": "CCNT MIS Financial Book - Actual - Dec 2025 (1).xlsx",
    "CCPT": "00 Financial Book - Actual (1) (1).xlsx",
    "TCK": "Chia MIS Dec 2025 (1).xlsx",
    "TGK": "MIS - Dec 2025 Taj Guras (1).xlsx",
    "TTK": "Financial Book - Actual Final Dec'25 (1).xlsx",
    "RK": "Raaj Dec 2025 (1).xlsx",
    "TGKRS": "Mis_Dec_2025 TGKRS.xlsx",
}

FISCAL_YEAR = "2025-26"
MONTH = 12

# Figures taken from the reference dashboard, to prove the pipeline is faithful.
EXPECTED_REVENUE = {
    "CCNT": 870.8,
    "CCPT": 523.2,
    "TCK": 548.9,
    "TGK": 365.7,
    "TTK": 891.3,
    "RK": 568.9,
    "TGKRS": 594.4,
}

failures: list[str] = []


def check(condition: bool, message: str) -> None:
    status = "ok  " if condition else "FAIL"
    print(f"  [{status}] {message}")
    if not condition:
        failures.append(message)


def main() -> int:
    # As a context manager so the lifespan hook runs and creates the schema.
    with TestClient(app) as client:
        return run(client)


def run(client: TestClient) -> int:
    print("\n1. Authentication")
    res = client.post(
        "/api/auth/login",
        json={"email": "admin@hotelgroup.in", "password": "admin123"},
    )
    check(res.status_code == 200, f"admin login -> {res.status_code}")
    token = res.json()["access_token"]
    auth = {"Authorization": f"Bearer {token}"}
    check(res.json()["user"]["role"] == "admin", "admin role returned")

    bad = client.post(
        "/api/auth/login", json={"email": "admin@hotelgroup.in", "password": "wrong"}
    )
    check(bad.status_code == 401, f"wrong password rejected -> {bad.status_code}")
    check(client.get("/api/hotels").status_code == 401, "unauthenticated read blocked")

    print("\n2. Read-only user cannot upload")
    client.post(
        "/api/auth/users",
        headers=auth,
        json={"email": "viewer@hotelgroup.in", "password": "viewer123", "role": "user"},
    )
    viewer = client.post(
        "/api/auth/login",
        json={"email": "viewer@hotelgroup.in", "password": "viewer123"},
    ).json()
    viewer_auth = {"Authorization": f"Bearer {viewer['access_token']}"}
    res = client.post(
        "/api/uploads",
        headers=viewer_auth,
        files={"file": ("x.xlsx", b"not-a-workbook", "application/vnd.ms-excel")},
        data={"hotel_id": 1, "fiscal_year": FISCAL_YEAR, "month": MONTH},
    )
    check(res.status_code == 403, f"viewer upload forbidden -> {res.status_code}")

    print("\n3. Hotels")
    hotels = client.get("/api/hotels", headers=auth).json()
    check(len(hotels) == 7, f"7 hotels seeded (got {len(hotels)})")
    by_code = {h["code"]: h for h in hotels}

    print("\n4. Upload + preview + commit")
    for code, filename in FILES.items():
        path = SOURCE_DIR / filename
        if not path.exists():
            check(False, f"{code}: source file missing ({filename})")
            continue
        with path.open("rb") as fh:
            res = client.post(
                "/api/uploads",
                headers=auth,
                files={
                    "file": (
                        path.name,
                        fh,
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    )
                },
                data={
                    "hotel_id": by_code[code]["id"],
                    "fiscal_year": FISCAL_YEAR,
                    "month": MONTH,
                },
            )
        if res.status_code != 201:
            check(False, f"{code}: upload -> {res.status_code} {res.text[:180]}")
            continue

        preview = res.json()
        revenue = next(
            (m["act"] for m in preview["mtd"] if m["key"] == "turnover"), None
        )
        expected = EXPECTED_REVENUE[code]
        close = revenue is not None and abs(revenue - expected) < 0.2
        check(close, f"{code}: preview revenue {revenue} ~= {expected} ({preview['parser']})")

        commit = client.post(
            f"/api/uploads/{preview['upload_id']}/commit", headers=auth
        )
        check(commit.status_code == 200, f"{code}: commit -> {commit.status_code}")
        if commit.status_code == 200:
            body = commit.json()
            check(body["periods"] >= 4, f"{code}: {body['periods']} period rows written")

    print("\n5. Rejecting a file that is not an MIS book")
    junk = Path(tempfile.gettempdir()) / "junk.xlsx"
    from openpyxl import Workbook

    wb = Workbook()
    wb.active["A1"] = "hello"
    wb.save(junk)
    with junk.open("rb") as fh:
        res = client.post(
            "/api/uploads",
            headers=auth,
            files={"file": ("junk.xlsx", fh, "application/vnd.ms-excel")},
            data={"hotel_id": by_code["CCNT"]["id"], "fiscal_year": FISCAL_YEAR, "month": MONTH},
        )
    check(res.status_code == 422, f"unrecognised workbook rejected -> {res.status_code}")

    res = client.post(
        "/api/uploads",
        headers=auth,
        files={"file": ("notes.txt", b"hello", "text/plain")},
        data={"hotel_id": by_code["CCNT"]["id"], "fiscal_year": FISCAL_YEAR, "month": MONTH},
    )
    check(res.status_code == 415, f"non-Excel file rejected -> {res.status_code}")

    print("\n6. Dashboard")
    res = client.get(
        "/api/dashboard",
        headers=auth,
        params={"fiscal_year": FISCAL_YEAR, "month": MONTH, "period": "MTD"},
    )
    check(res.status_code == 200, f"dashboard -> {res.status_code}")
    data = res.json()
    check(len(data["hotels"]) == 7, f"7 hotels with data (got {len(data['hotels'])})")

    total = sum(h["a"]["rev"] for h in data["hotels"])
    check(abs(total - 4363.2) < 2, f"portfolio MTD revenue {total:,.1f}L (expected ~4,363L)")

    for hotel in data["hotels"]:
        code = hotel["code"]
        act = hotel["a"]
        ok = abs(act["rev"] - EXPECTED_REVENUE[code]) < 0.2
        check(ok, f"{code}: dashboard revenue {act['rev']:.1f}")
        parts = act["room"] + act["fnb"] + act["other"]
        check(
            abs(parts - act["rev"]) < 0.6,
            f"{code}: room+F&B+other {parts:.1f} ties to revenue {act['rev']:.1f}",
        )
        split = act["food"] + act["bw"] + act["smoke"]
        check(
            abs(split - act["rm"]) < 0.2,
            f"{code}: F&B cost split {split:.1f} ties to raw material {act['rm']:.1f}",
        )
        check(bool(hotel["seg"]), f"{code}: {len(hotel['seg'])} segments")
        check(bool(hotel["out"]), f"{code}: {len(hotel['out'])} outlets")

    print("\n7. YTD and filtering")
    ytd = client.get(
        "/api/dashboard",
        headers=auth,
        params={"fiscal_year": FISCAL_YEAR, "month": MONTH, "period": "YTD"},
    ).json()
    ytd_total = sum(h["a"]["rev"] for h in ytd["hotels"])
    check(ytd_total > total * 5, f"YTD revenue {ytd_total:,.1f}L exceeds one month")

    subset = client.get(
        "/api/dashboard",
        headers=auth,
        params={
            "fiscal_year": FISCAL_YEAR,
            "month": MONTH,
            "period": "MTD",
            "hotels": "CCNT,RK",
        },
    ).json()
    check(len(subset["hotels"]) == 2, "hotel filter returns 2 hotels")

    periods = client.get("/api/dashboard/periods", headers=auth).json()
    check(periods["periods"][0]["months"] == [12], f"periods endpoint: {periods['periods']}")

    trend = client.get(
        "/api/dashboard/trend", headers=auth, params={"metric": "turnover"}
    ).json()
    check(len(trend["points"]) == 1, f"trend has {len(trend['points'])} point(s)")

    print("\n8. Re-uploading a month replaces it rather than duplicating")
    path = SOURCE_DIR / FILES["CCNT"]
    with path.open("rb") as fh:
        again = client.post(
            "/api/uploads",
            headers=auth,
            files={"file": (path.name, fh, "application/vnd.ms-excel")},
            data={"hotel_id": by_code["CCNT"]["id"], "fiscal_year": FISCAL_YEAR, "month": MONTH},
        ).json()
    check(again["replaces_existing"] is True, "preview flags that it replaces existing data")
    client.post(f"/api/uploads/{again['upload_id']}/commit", headers=auth)
    after = client.get(
        "/api/dashboard",
        headers=auth,
        params={"fiscal_year": FISCAL_YEAR, "month": MONTH, "period": "MTD"},
    ).json()
    check(len(after["hotels"]) == 7, "still 7 hotels after re-upload")
    ccnt = next(h for h in after["hotels"] if h["code"] == "CCNT")
    check(abs(ccnt["a"]["rev"] - 870.8) < 0.2, f"CCNT revenue unchanged: {ccnt['a']['rev']:.1f}")

    print("\n9. Coverage grid, download and delete")
    listing = client.get("/api/uploads", headers=auth)
    check(listing.status_code == 200, f"upload history -> {listing.status_code}")
    if listing.status_code == 200:
        rows = listing.json()
        check(len(rows) > 0, f"history lists {len(rows)} upload(s)")
        check(
            all(r["hotel_code"] for r in rows),
            "every history row carries its hotel code",
        )

    grid = client.get(
        "/api/uploads/coverage",
        headers=auth,
        params={"months": 12, "end_year": 2025, "end_month": 12},
    )
    check(grid.status_code == 200, f"coverage grid -> {grid.status_code}")
    matrix = grid.json()
    check(len(matrix["columns"]) == 12, f"{len(matrix['columns'])} month columns")
    check(
        matrix["columns"][0]["label"] == "Dec 2025",
        f"newest column first: {matrix['columns'][0]['label']}",
    )
    check(len(matrix["rows"]) == 7, f"{len(matrix['rows'])} project rows")

    key = "2025-26:12"
    filled = [r for r in matrix["rows"] if r["cells"].get(key)]
    check(len(filled) == 7, f"{len(filled)} hotels show a file for Dec 2025")
    ccnt_cell = next(r["cells"][key] for r in matrix["rows"] if r["code"] == "CCNT")
    check(ccnt_cell["status"] == "committed", "cell reports committed status")
    check(
        abs((ccnt_cell["revenue"] or 0) - 870.8) < 0.2,
        f"cell shows revenue {ccnt_cell['revenue']}",
    )
    check(ccnt_cell["has_file"] is True, "cell reports the stored file is present")
    empty = [r for r in matrix["rows"] if not r["cells"].get("2025-26:11")]
    check(len(empty) == 7, "November shows as empty and uploadable")

    dl = client.get(f"/api/uploads/{ccnt_cell['upload_id']}/download", headers=auth)
    check(dl.status_code == 200, f"download -> {dl.status_code}")
    check(
        len(dl.content) == ccnt_cell["file_size"],
        f"downloaded {len(dl.content)} bytes, expected {ccnt_cell['file_size']}",
    )
    check(dl.content[:2] == b"PK", "downloaded bytes are a real xlsx archive")

    rk_cell = next(r["cells"][key] for r in matrix["rows"] if r["code"] == "RK")
    gone = client.delete(f"/api/uploads/{rk_cell['upload_id']}", headers=auth)
    check(gone.status_code == 204, f"delete committed upload -> {gone.status_code}")
    after = client.get(
        "/api/dashboard",
        headers=auth,
        params={"fiscal_year": FISCAL_YEAR, "month": MONTH, "period": "MTD"},
    ).json()
    codes = [h["code"] for h in after["hotels"]]
    check("RK" not in codes, f"deleted hotel dropped from dashboard: {codes}")
    regrid = client.get(
        "/api/uploads/coverage",
        headers=auth,
        params={"months": 12, "end_year": 2025, "end_month": 12},
    ).json()
    rk_after = next(r["cells"].get(key) for r in regrid["rows"] if r["code"] == "RK")
    check(rk_after is None, "deleted cell is empty again")

    check(
        client.get(f"/api/uploads/{rk_cell['upload_id']}/download", headers=auth).status_code
        == 404,
        "download of a deleted upload 404s",
    )
    check(
        client.delete(f"/api/uploads/{ccnt_cell['upload_id']}", headers=viewer_auth).status_code
        == 403,
        "viewer cannot delete",
    )

    print("\n10. Hotel management")
    ccnt = by_code["CCNT"]

    res = client.patch(
        f"/api/hotels/{ccnt['id']}",
        headers=auth,
        json={"name": "Taj City Centre New Town (Kolkata)", "room_inventory": 148},
    )
    check(res.status_code == 200, f"edit hotel -> {res.status_code}")
    if res.status_code == 200:
        check(res.json()["room_inventory"] == 148, "inventory updated")
        check("Kolkata" in res.json()["name"], "name updated")

    res = client.patch(
        f"/api/hotels/{ccnt['id']}", headers=auth, json={"code": "RK"}
    )
    check(res.status_code == 409, f"duplicate code rejected -> {res.status_code}")

    res = client.patch(
        f"/api/hotels/{ccnt['id']}", headers=auth, json={"entity_code": "E_4010"}
    )
    check(res.status_code == 409, f"duplicate entity code rejected -> {res.status_code}")

    res = client.patch(
        f"/api/hotels/{ccnt['id']}", headers=auth, json={"is_active": False}
    )
    check(res.status_code == 200, "deactivate hotel")
    visible = [h["code"] for h in client.get("/api/hotels", headers=auth).json()]
    check("CCNT" not in visible, f"inactive hotel hidden by default: {visible}")
    all_hotels = client.get(
        "/api/hotels", headers=auth, params={"include_inactive": True}
    ).json()
    check(len(all_hotels) == 7, "include_inactive still lists it")
    client.patch(f"/api/hotels/{ccnt['id']}", headers=auth, json={"is_active": True})

    usage = client.get(f"/api/hotels/{ccnt['id']}/usage", headers=auth)
    check(usage.status_code == 200, f"usage -> {usage.status_code}")
    body = usage.json()
    check(body["uploads"] >= 1 and body["period_facts"] > 0, f"usage reports {body}")
    check(body["can_delete_cleanly"] is False, "hotel with data is not cleanly deletable")

    blocked = client.delete(f"/api/hotels/{ccnt['id']}", headers=auth)
    check(blocked.status_code == 409, f"delete without cascade blocked -> {blocked.status_code}")

    made = client.post(
        "/api/hotels",
        headers=auth,
        json={"code": "TMP", "name": "Temporary Property", "room_inventory": 10},
    )
    check(made.status_code == 201, f"create hotel -> {made.status_code}")
    tmp_id = made.json()["id"]
    clean = client.get(f"/api/hotels/{tmp_id}/usage", headers=auth).json()
    check(clean["can_delete_cleanly"] is True, "fresh hotel is cleanly deletable")
    gone = client.delete(f"/api/hotels/{tmp_id}", headers=auth)
    check(gone.status_code == 204, f"delete empty hotel -> {gone.status_code}")

    tgk = by_code["TGK"]
    cascaded = client.delete(
        f"/api/hotels/{tgk['id']}", headers=auth, params={"cascade": True}
    )
    check(cascaded.status_code == 204, f"cascade delete -> {cascaded.status_code}")
    after = client.get(
        "/api/dashboard",
        headers=auth,
        params={"fiscal_year": FISCAL_YEAR, "month": MONTH, "period": "MTD"},
    ).json()
    codes = [h["code"] for h in after["hotels"]]
    check("TGK" not in codes, f"cascade removed its figures: {codes}")
    remaining = [h["code"] for h in client.get("/api/hotels", headers=auth).json()]
    check("TGK" not in remaining, "hotel gone from the list")

    check(
        client.delete(f"/api/hotels/{ccnt['id']}", headers=viewer_auth).status_code == 403,
        "viewer cannot delete a hotel",
    )
    check(
        client.patch(
            f"/api/hotels/{ccnt['id']}", headers=viewer_auth, json={"name": "x"}
        ).status_code
        == 403,
        "viewer cannot edit a hotel",
    )

    print("\n11. Growth: YoY / MoM / QoQ")
    g = client.get(
        "/api/dashboard/growth",
        headers=auth,
        params={"metric": "turnover", "fiscal_year": FISCAL_YEAR, "month": MONTH},
    )
    check(g.status_code == 200, f"growth -> {g.status_code}")
    body = g.json()
    check(
        body["periods"]["yoy"]["fiscal_year"] == "2024-25",
        f"YoY compares against {body['periods']['yoy']['fiscal_year']}",
    )
    check(
        body["periods"]["qoq"]["current"]["quarter"] == 3
        and body["periods"]["qoq"]["previous"]["quarter"] == 2,
        "December sits in fiscal Q3, compared with Q2",
    )
    ccnt_g = next(r for r in body["rows"] if r["code"] == "CCNT")
    check(
        abs(ccnt_g["yoy"]["current"] - 870.83) < 0.1
        and abs(ccnt_g["yoy"]["previous"] - 877.3) < 0.1,
        f"CCNT YoY {ccnt_g['yoy']['current']} vs {ccnt_g['yoy']['previous']}",
    )
    check(
        abs(ccnt_g["yoy"]["change_pct"] - (-0.74)) < 0.05,
        f"CCNT YoY change {ccnt_g['yoy']['change_pct']:.2f}%",
    )
    check(
        ccnt_g["mom"]["available"] is False and ccnt_g["qoq"]["available"] is False,
        "MoM/QoQ report unavailable with only one month loaded",
    )

    # Seed earlier months so the MoM and QoQ arithmetic can be checked.
    from sqlalchemy import select as _select

    from app.db.session import SessionLocal
    from app.models import Hotel as _Hotel
    from app.models import PeriodFact as _PeriodFact

    with SessionLocal() as _db:
        _hotel = _db.scalar(_select(_Hotel).where(_Hotel.code == "CCNT"))
        # Q2 = Jul/Aug/Sep, Q3 = Oct/Nov/Dec. July is deliberately left out.
        for _m, _v in [(11, 800.0), (10, 700.0), (9, 600.0), (8, 500.0)]:
            _db.add(
                _PeriodFact(
                    hotel_id=_hotel.id,
                    fiscal_year=FISCAL_YEAR,
                    month=_m,
                    period_type="MTD",
                    scenario="ACT",
                    turnover=_v,
                    occupancy_pct=60.0,
                )
            )
        _db.commit()

    g2 = client.get(
        "/api/dashboard/growth",
        headers=auth,
        params={
            "metric": "turnover",
            "fiscal_year": FISCAL_YEAR,
            "month": MONTH,
            "hotels": "CCNT",
        },
    ).json()
    row = g2["rows"][0]
    check(row["mom"]["available"] is True, "MoM available once November exists")
    check(
        abs(row["mom"]["previous"] - 800.0) < 0.01,
        f"MoM base is November: {row['mom']['previous']}",
    )
    check(
        abs(row["mom"]["change_pct"] - 8.854) < 0.02,
        f"MoM change {row['mom']['change_pct']:.3f}% (870.83 vs 800)",
    )
    check(
        abs(row["qoq"]["current"] - 2370.83) < 0.05,
        f"Q3 sums Oct+Nov+Dec to {row['qoq']['current']}",
    )
    check(row["qoq"]["current_months"] == 3, "Q3 covers 3 months")
    check(
        abs(row["qoq"]["previous"] - 1100.0) < 0.01,
        f"Q2 sums Aug+Sep to {row['qoq']['previous']}",
    )
    check(
        row["qoq"]["previous_months"] == 2,
        f"Q2 covers {row['qoq']['previous_months']} months, flagged as partial",
    )

    rate = client.get(
        "/api/dashboard/growth",
        headers=auth,
        params={
            "metric": "occupancy_pct",
            "fiscal_year": FISCAL_YEAR,
            "month": MONTH,
            "hotels": "CCNT",
        },
    ).json()
    check(rate["is_rate"] is True, "occupancy is flagged as a rate")
    occ_q = rate["rows"][0]["qoq"]["current"]
    check(
        occ_q is not None and occ_q <= 100,
        f"quarter occupancy averaged not summed: {occ_q:.1f}",
    )

    bad = client.get(
        "/api/dashboard/growth",
        headers=auth,
        params={"metric": "not_a_metric", "fiscal_year": FISCAL_YEAR, "month": MONTH},
    )
    check(bad.status_code == 422, f"unknown metric -> {bad.status_code}")


    print("\n" + "=" * 62)
    if failures:
        print(f"{len(failures)} CHECK(S) FAILED:")
        for item in failures:
            print(f"  - {item}")
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
