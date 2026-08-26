"""Dashboard read models.

The API hands the frontend one object per hotel holding Actual / Budget / Last
Year blocks with the short field names the dashboard renders directly, so the
UI does no financial arithmetic of its own.
"""

from __future__ import annotations

from sqlalchemy import distinct, select
from sqlalchemy.orm import Session

from app.models import Hotel, OutletFact, PeriodFact, SegmentFact
from app.parsers.mapping import SEGMENT_LABELS, SEGMENT_ORDER

SCENARIO_KEYS = {"ACT": "a", "BUD": "b", "LY": "ly"}


def _sum(*values) -> float:
    return sum(v for v in values if v is not None)


BLOCK_FIELDS = (
    "rev",
    "room",
    "fnb",
    "other",
    "ebitda",
    "gop",
    "occ",
    "arr",
    "revpar",
    "rm",
    "food",
    "bw",
    "smoke",
    "pay",
    "flp",
    "admin",
    "rmnt",
    "fees",
    "ap",
    "stores",
    "rent",
    "covers",
    "apc",
)


def _block(fact: PeriodFact | None) -> dict:
    """Shape one scenario into the field names the dashboard uses."""
    if fact is None:
        return dict.fromkeys(BLOCK_FIELDS, 0)
    return {
        "rev": fact.turnover or 0,
        "room": fact.room_income or 0,
        "fnb": fact.fnb_income or 0,
        "other": _sum(
            fact.fnb_other_income,
            fact.other_operating_income,
            fact.non_operating_income,
        ),
        "ebitda": fact.ebitda or 0,
        "gop": fact.gross_operating_profit or 0,
        "occ": fact.occupancy_pct or 0,
        "arr": fact.arr or 0,
        "revpar": fact.revpar or 0,
        # cost heads
        "rm": fact.raw_material_cost or 0,
        "food": fact.food_cost or 0,
        # 'B&W' on the dashboard is beverages: soft drinks, beer and liquor.
        "bw": _sum(fact.soft_drink_cost, fact.beer_cost, fact.liquor_cost),
        "smoke": fact.smoke_cost or 0,
        "pay": fact.payroll_cost or 0,
        "flp": fact.fuel_power_light or 0,
        "admin": fact.admin_expenses or 0,
        "rmnt": fact.repairs_maintenance or 0,
        "fees": _sum(
            fact.operating_licence_fees,
            fact.licence_fees,
            fact.crs_cis_expenses,
            fact.corporate_services,
        ),
        "ap": fact.advertising_promotion or 0,
        "stores": fact.stores_supplies or 0,
        "rent": fact.rent_rates_taxes or 0,
        "covers": fact.fnb_covers_per_day or 0,
        "apc": fact.apc or 0,
    }


def available_periods(db: Session) -> list[dict]:
    """Fiscal year / month combinations that hold committed data."""
    rows = db.execute(
        select(distinct(PeriodFact.fiscal_year), PeriodFact.month).order_by(
            PeriodFact.fiscal_year.desc(), PeriodFact.month
        )
    ).all()
    seen: dict[str, list[int]] = {}
    for fiscal_year, month in rows:
        seen.setdefault(fiscal_year, []).append(month)
    return [
        {"fiscal_year": fy, "months": sorted(set(months))}
        for fy, months in sorted(seen.items(), reverse=True)
    ]


def dashboard(
    db: Session,
    fiscal_year: str,
    month: int,
    period_type: str,
    hotel_codes: list[str] | None = None,
) -> dict:
    hotels_stmt = select(Hotel).where(Hotel.is_active.is_(True)).order_by(
        Hotel.sort_order, Hotel.code
    )
    if hotel_codes:
        hotels_stmt = hotels_stmt.where(Hotel.code.in_(hotel_codes))
    hotels = db.scalars(hotels_stmt).all()
    if not hotels:
        return {"fiscal_year": fiscal_year, "month": month, "period": period_type, "hotels": []}

    hotel_ids = [h.id for h in hotels]
    base = dict(fiscal_year=fiscal_year, month=month, period_type=period_type)

    facts = db.scalars(
        select(PeriodFact).where(
            PeriodFact.hotel_id.in_(hotel_ids),
            PeriodFact.fiscal_year == base["fiscal_year"],
            PeriodFact.month == base["month"],
            PeriodFact.period_type == base["period_type"],
        )
    ).all()
    by_hotel: dict[int, dict[str, PeriodFact]] = {}
    for fact in facts:
        by_hotel.setdefault(fact.hotel_id, {})[fact.scenario] = fact

    segments = db.scalars(
        select(SegmentFact).where(
            SegmentFact.hotel_id.in_(hotel_ids),
            SegmentFact.fiscal_year == base["fiscal_year"],
            SegmentFact.month == base["month"],
            SegmentFact.period_type == base["period_type"],
            SegmentFact.scenario == "ACT",
        )
    ).all()
    seg_by_hotel: dict[int, dict[str, SegmentFact]] = {}
    for row in segments:
        seg_by_hotel.setdefault(row.hotel_id, {})[row.segment] = row

    outlets = db.scalars(
        select(OutletFact).where(
            OutletFact.hotel_id.in_(hotel_ids),
            OutletFact.fiscal_year == base["fiscal_year"],
            OutletFact.month == base["month"],
            OutletFact.period_type == base["period_type"],
            OutletFact.scenario == "ACT",
        )
    ).all()
    out_by_hotel: dict[int, list[OutletFact]] = {}
    for row in outlets:
        out_by_hotel.setdefault(row.hotel_id, []).append(row)

    payload = []
    for hotel in hotels:
        scenarios = by_hotel.get(hotel.id, {})
        if not scenarios:
            continue
        entry = {
            "code": hotel.code,
            "name": hotel.name,
            "inv": hotel.room_inventory,
            "hasData": True,
        }
        for scenario, key in SCENARIO_KEYS.items():
            entry[key] = _block(scenarios.get(scenario))
        # Prefer the inventory the book itself reported for this period.
        act = scenarios.get("ACT")
        if act and act.room_inventory:
            entry["inv"] = int(act.room_inventory)

        entry["seg"] = [
            {
                "key": key,
                "label": SEGMENT_LABELS.get(key, key.title()),
                "rooms": row.rooms_total or 0,
                "roomsPerDay": row.rooms_per_day or 0,
                "arr": row.arr or 0,
                "rev": row.room_income or 0,
                "occ": row.occupancy_pct or 0,
            }
            for key in SEGMENT_ORDER
            if (row := seg_by_hotel.get(hotel.id, {}).get(key)) is not None
        ]
        entry["out"] = [
            {
                "name": row.outlet,
                "rev": row.revenue or 0,
                "cov": row.covers_total or 0,
                "ih": row.covers_resident or 0,
                "wi": row.covers_non_resident or 0,
                "apc": row.apc or 0,
            }
            for row in sorted(
                out_by_hotel.get(hotel.id, []),
                key=lambda r: -(r.revenue or 0),
            )
        ]
        payload.append(entry)

    return {
        "fiscal_year": fiscal_year,
        "month": month,
        "period": period_type,
        "hotels": payload,
    }


def trend(
    db: Session,
    metric: str,
    period_type: str = "MTD",
    hotel_codes: list[str] | None = None,
    fiscal_years: list[str] | None = None,
) -> dict:
    """Month-by-month history of one metric, for the trend charts."""
    column = getattr(PeriodFact, metric, None)
    if column is None:
        raise ValueError(f"Unknown metric '{metric}'")

    hotels_stmt = select(Hotel).where(Hotel.is_active.is_(True))
    if hotel_codes:
        hotels_stmt = hotels_stmt.where(Hotel.code.in_(hotel_codes))
    hotels = {h.id: h for h in db.scalars(hotels_stmt).all()}
    if not hotels:
        return {"metric": metric, "points": []}

    stmt = select(PeriodFact).where(
        PeriodFact.hotel_id.in_(list(hotels)),
        PeriodFact.period_type == period_type,
        PeriodFact.scenario.in_(("ACT", "BUD", "LY")),
    )
    if fiscal_years:
        stmt = stmt.where(PeriodFact.fiscal_year.in_(fiscal_years))
    rows = db.scalars(stmt.order_by(PeriodFact.fiscal_year, PeriodFact.month)).all()

    points: dict[tuple[str, int], dict] = {}
    for row in rows:
        key = (row.fiscal_year, row.month)
        entry = points.setdefault(
            key,
            {"fiscal_year": row.fiscal_year, "month": row.month, "ACT": 0, "BUD": 0, "LY": 0},
        )
        entry[row.scenario] = entry[row.scenario] + (getattr(row, metric) or 0)

    ordered = sorted(points.values(), key=lambda p: (p["fiscal_year"], _fiscal_index(p["month"])))
    return {"metric": metric, "period": period_type, "points": ordered}


def _fiscal_index(month: int) -> int:
    return [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3].index(month)


# --------------------------------------------------------------------------- #
# Growth: month-on-month, quarter-on-quarter and year-on-year
# --------------------------------------------------------------------------- #
FISCAL_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]

# Rates are averaged across hotels and months; everything else is summed.
RATE_METRICS = {
    "occupancy_pct",
    "arr",
    "revpar",
    "apc",
    "rpd",
    "fnb_covers_per_day",
}


def _prev_fiscal_year(fiscal_year: str) -> str:
    start = int(fiscal_year.split("-")[0]) - 1
    return f"{start}-{(start + 1) % 100:02d}"


def _prev_month(fiscal_year: str, month: int) -> tuple[str, int]:
    """The month before, stepping back into the previous fiscal year at April."""
    index = FISCAL_MONTHS.index(month)
    if index == 0:
        return _prev_fiscal_year(fiscal_year), 3
    return fiscal_year, FISCAL_MONTHS[index - 1]


def _quarter_of(month: int) -> int:
    """Fiscal quarter: Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar."""
    return FISCAL_MONTHS.index(month) // 3 + 1


def _quarter_months(quarter: int) -> list[int]:
    return FISCAL_MONTHS[(quarter - 1) * 3 : quarter * 3]


def _prev_quarter(fiscal_year: str, quarter: int) -> tuple[str, int]:
    if quarter == 1:
        return _prev_fiscal_year(fiscal_year), 4
    return fiscal_year, quarter - 1


def _combine(values: list[float], metric: str) -> float | None:
    """Sum additive metrics; average rates. None when nothing is available."""
    present = [v for v in values if v is not None]
    if not present:
        return None
    if metric in RATE_METRICS:
        return sum(present) / len(present)
    return sum(present)


def _comparison(current, previous, metric: str, **extra) -> dict:
    """One current-vs-previous pair with its change, or a flag saying why not."""
    available = current is not None and previous not in (None, 0)
    change = (current - previous) if (current is not None and previous is not None) else None
    return {
        "current": current,
        "previous": previous,
        "change": change,
        # Percentage change is meaningless against a zero or absent base.
        "change_pct": (change / abs(previous) * 100) if available else None,
        "available": available,
        **extra,
    }


def growth(
    db: Session,
    metric: str,
    fiscal_year: str,
    month: int,
    hotel_codes: list[str] | None = None,
) -> dict:
    """MoM, QoQ and YoY for one metric, per hotel and for the portfolio.

    Year-on-year uses the prior-year column the workbook itself carries, so it
    is available from a single upload. Month- and quarter-on-quarter need the
    neighbouring months to have been uploaded, and say so when they have not.
    """
    if getattr(PeriodFact, metric, None) is None:
        raise ValueError(f"Unknown metric '{metric}'")

    hotels_stmt = select(Hotel).where(Hotel.is_active.is_(True))
    if hotel_codes:
        hotels_stmt = hotels_stmt.where(Hotel.code.in_(hotel_codes))
    hotels = db.scalars(hotels_stmt.order_by(Hotel.sort_order, Hotel.code)).all()
    if not hotels:
        return {"metric": metric, "rows": [], "totals": None, "periods": {}}

    prev_m_fy, prev_m = _prev_month(fiscal_year, month)
    quarter = _quarter_of(month)
    prev_q_fy, prev_q = _prev_quarter(fiscal_year, quarter)
    cur_q_keys = [(fiscal_year, m) for m in _quarter_months(quarter)]
    prev_q_keys = [(prev_q_fy, m) for m in _quarter_months(prev_q)]

    wanted = {(fiscal_year, month), (prev_m_fy, prev_m), *cur_q_keys, *prev_q_keys}
    years = {fy for fy, _ in wanted}
    months = {m for _, m in wanted}

    rows = db.scalars(
        select(PeriodFact).where(
            PeriodFact.hotel_id.in_([h.id for h in hotels]),
            PeriodFact.period_type == "MTD",
            PeriodFact.scenario.in_(("ACT", "LY")),
            PeriodFact.fiscal_year.in_(years),
            PeriodFact.month.in_(months),
        )
    ).all()

    # (hotel_id, fiscal_year, month, scenario) -> value
    values: dict[tuple, float | None] = {}
    for row in rows:
        if (row.fiscal_year, row.month) not in wanted:
            continue
        values[(row.hotel_id, row.fiscal_year, row.month, row.scenario)] = getattr(
            row, metric
        )

    def pick(hotel_id, fy, m, scenario="ACT"):
        return values.get((hotel_id, fy, m, scenario))

    def quarter_value(hotel_id, keys):
        found = [pick(hotel_id, fy, m) for fy, m in keys]
        present = [v for v in found if v is not None]
        return _combine(found, metric), len(present)

    payload = []
    for hotel in hotels:
        current = pick(hotel.id, fiscal_year, month)
        cur_q, cur_q_n = quarter_value(hotel.id, cur_q_keys)
        prev_q_value, prev_q_n = quarter_value(hotel.id, prev_q_keys)
        payload.append(
            {
                "code": hotel.code,
                "name": hotel.name,
                "mom": _comparison(current, pick(hotel.id, prev_m_fy, prev_m), metric),
                "qoq": _comparison(
                    cur_q,
                    prev_q_value,
                    metric,
                    current_months=cur_q_n,
                    previous_months=prev_q_n,
                ),
                # The LY scenario is the same month one year earlier.
                "yoy": _comparison(
                    current, pick(hotel.id, fiscal_year, month, "LY"), metric
                ),
            }
        )

    def totals_for(key: str) -> dict:
        current = _combine([r[key]["current"] for r in payload], metric)
        previous = _combine([r[key]["previous"] for r in payload], metric)
        return _comparison(current, previous, metric)

    totals = {k: totals_for(k) for k in ("mom", "qoq", "yoy")}

    return {
        "metric": metric,
        "is_rate": metric in RATE_METRICS,
        "periods": {
            "current": {"fiscal_year": fiscal_year, "month": month},
            "mom": {"fiscal_year": prev_m_fy, "month": prev_m},
            "qoq": {
                "current": {"fiscal_year": fiscal_year, "quarter": quarter},
                "previous": {"fiscal_year": prev_q_fy, "quarter": prev_q},
            },
            "yoy": {"fiscal_year": _prev_fiscal_year(fiscal_year), "month": month},
        },
        "rows": payload,
        "totals": totals,
    }
