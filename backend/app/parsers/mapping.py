"""Line-item label -> canonical metric mapping.

Exact matches win. Only when a label is unknown do we fall back to the prefix
rules, which are ordered longest-first so that 'payroll cost to turnover (%)'
can never be mistaken for 'payroll cost'.
"""

from __future__ import annotations

import re

from app.parsers.utils import norm

_TRAILING_QUALIFIER = re.compile(r"\s*[\(\[][^)\]]*[\)\]]\s*$")

# Metrics that legitimately appear on several rows and must be summed
# (e.g. Repairs & Maintenance is split Variable / Fixed).
ACCUMULATING = {
    "repairs_maintenance",
    "admin_expenses",
    "advertising_promotion",
}

EXACT: dict[str, str] = {
    # revenue
    "room income": "room_income",
    "room revenue": "room_income",
    "food & beverage income": "fnb_income",
    "food and beverage income": "fnb_income",
    "food & beverage - others": "fnb_other_income",
    "food & beverage -others": "fnb_other_income",
    "other income - f&b": "fnb_other_income",
    "other operating income": "other_operating_income",
    "other income -misc": "other_operating_income",
    "other income - misc": "other_operating_income",
    "non operating income": "non_operating_income",
    "turnover": "turnover",
    "total revenue": "turnover",
    # costs
    "raw material cost (excluding complimentaries)": "raw_material_cost",
    "raw material cost": "raw_material_cost",
    "complimentary cost ( guest + staff )": "complimentary_cost",
    "complimentary cost": "complimentary_cost",
    "payroll cost": "payroll_cost",
    "stores & supplies": "stores_supplies",
    "fuel, power & light": "fuel_power_light",
    "repairs & maintenance - variable": "repairs_maintenance",
    "repairs & maintenance - fixed": "repairs_maintenance",
    "renovation write off": "renovation_write_off",
    "rent, rates, taxes & insurance": "rent_rates_taxes",
    "operating / licence fees - ihcl": "operating_licence_fees",
    "operating / incentive fees": "operating_licence_fees",
    "licence fees": "licence_fees",
    "licence fees - others": "licence_fees",
    "administration expenses - variable": "admin_expenses",
    "administration expenses - fixed": "admin_expenses",
    "admin & general expenses - variable": "admin_expenses",
    "admin & general expenses - fixed": "admin_expenses",
    "advertising & promotion (local)": "advertising_promotion",
    "advertising & promotion (loyalty)": "advertising_promotion",
    "advertising & promotion-corp office recoveries": "advertising_promotion",
    "a & p expenses : local": "advertising_promotion",
    "a & p expenses : corporate": "advertising_promotion",
    "corporate services cost": "corporate_services",
    "brand common cost": "corporate_services",
    "crs / cis expenses": "crs_cis_expenses",
    "crs/cis costs": "crs_cis_expenses",
    "operating expenses": "operating_expenses",
    "total operating expenses": "operating_expenses",
    "total operating expenditure": "operating_expenses",
    # profit
    "ebitda": "ebitda",
    # Some books print EBITDA under the GOP caption; the bracketed form is the
    # EBITDA line, while a bare 'Gross Operating Profit' is the separate GOP row.
    "gross operating profit [ebitda]": "ebitda",
    "gross operating profit": "gross_operating_profit",
    "controllable gop": "gross_operating_profit",
    "depreciation & amortisation": "depreciation",
    "depreciation": "depreciation",
    "finance cost": "finance_cost",
    "profit before taxes": "pbt",
    # statistics
    "room inventory": "room_inventory",
    "rooms inventory": "room_inventory",
    "rpd": "rpd",
    "average cover per day": "fnb_covers_per_day",
    "rooms occupied per day": "rpd",
    "room occupancy (%)": "occupancy_pct",
    "occupancy (%)": "occupancy_pct",
    "arr": "arr",
    "arr (rs.)": "arr",
    "revpar (rs)": "revpar",
    "revpar": "revpar",
    "f&b covers per day": "fnb_covers_per_day",
    "apc (rs.)": "apc",
    "apc": "apc",
}

# (prefix, metric) — consulted only when the exact table misses.
PREFIX: list[tuple[str, str]] = sorted(
    [
        ("raw material cost", "raw_material_cost"),
        ("complimentary cost", "complimentary_cost"),
        ("repairs & maintenance", "repairs_maintenance"),
        ("rent, rates, taxes", "rent_rates_taxes"),
        ("operating / licence fees", "operating_licence_fees"),
        ("operating / incentive fees", "operating_licence_fees"),
        ("licence fees", "licence_fees"),
        ("administration expenses", "admin_expenses"),
        ("admin & general exp", "admin_expenses"),
        ("advertising & promotion", "advertising_promotion"),
        ("a & p expenses", "advertising_promotion"),
        ("corporate services", "corporate_services"),
        ("brand common cost", "corporate_services"),
        ("depreciation", "depreciation"),
        ("room occupancy", "occupancy_pct"),
    ],
    key=lambda item: -len(item[0]),
)

# Rows that look like the metrics above but are ratios or derived figures.
IGNORE_MARKERS = (
    "to turnover",
    "per cover",
    "cost to",
    "%)",
    "% )",
    "units/",
    "before exceptional",
    "exceptional item",
    "statistical data",
    "profit & loss",
    "profit and loss",
)

# Ratio rows we do want, despite carrying '(%)'.
IGNORE_EXCEPTIONS = {"room occupancy (%)", "occupancy (%)"}


def strip_qualifier(label: str) -> str:
    """Drop a trailing unit/qualifier such as 'ARR (Rs.)' -> 'arr'."""
    return _TRAILING_QUALIFIER.sub("", norm(label)).strip()


def match_metric(label: str) -> str | None:
    """Resolve a line-item label to a canonical metric name, or None."""
    key = norm(label)
    if not key:
        return None
    if key in EXACT:
        return EXACT[key]
    if key not in IGNORE_EXCEPTIONS and any(m in key for m in IGNORE_MARKERS):
        return None
    # Books differ on units printed after the label — 'ARR', 'ARR (Rs.)',
    # 'ARR (`)' are all the same line.
    bare = strip_qualifier(key)
    if bare != key and bare in EXACT:
        return EXACT[bare]
    for prefix, metric in PREFIX:
        if key.startswith(prefix):
            return metric
    return None


# --------------------------------------------------------------------------- #
# F&B category sheet (sheet 1.5)
# --------------------------------------------------------------------------- #
FNB_SALES = {
    "food sales": "food_sales",
    "soft drinks & mineral water sales": "soft_drink_sales",
    "soft drink & mineral water sales": "soft_drink_sales",
    "beer sales": "beer_sales",
    "spirits & wines sales": "spirits_wines_sales",
    "smoke sales": "smoke_sales",
}

FNB_COSTS = {
    "food": "food_cost",
    "soft drink & mineral water": "soft_drink_cost",
    "soft drinks & mineral water": "soft_drink_cost",
    "beer": "beer_cost",
    "liquor": "liquor_cost",
    "spirits & wines": "liquor_cost",
    "smoke": "smoke_cost",
}


# --------------------------------------------------------------------------- #
# Market segments (sheet 1.2)
# --------------------------------------------------------------------------- #
SEGMENTS = {
    "corporate": "corporate",
    "leisure": "leisure",
    "transient": "transient",
    "long stay": "long_stay",
    "groups": "groups",
    "group": "groups",
    "events": "events",
    "conferences": "conferences",
    "conference": "conferences",
    "airlines": "airlines",
    "airline": "airlines",
    "others": "others",
    "other": "others",
}

# Prefixes for books that qualify the segment caption, e.g.
# 'TRANSIENT (NON-NEGOTIATED/PROMOTIONAL)' or 'CREW, LAYOVERS & STOPOVERS'.
SEGMENT_PREFIXES: list[tuple[str, str]] = sorted(
    [
        ("corporates", "corporate"),
        ("corporate", "corporate"),
        ("leisure", "leisure"),
        ("transient", "transient"),
        ("long stay", "long_stay"),
        ("groups", "groups"),
        ("events", "events"),
        ("conferences", "conferences"),
        ("airlines", "airlines"),
        ("crew", "airlines"),
        ("others", "others"),
    ],
    key=lambda item: -len(item[0]),
)


def match_segment(label: str) -> str | None:
    key = norm(label)
    if key in SEGMENTS:
        return SEGMENTS[key]
    for prefix, segment in SEGMENT_PREFIXES:
        if key.startswith(prefix):
            return segment
    return None

SEGMENT_LABELS = {
    "corporate": "Corporate",
    "leisure": "Leisure",
    "transient": "Transient",
    "long_stay": "Long Stay",
    "groups": "Groups",
    "events": "Events",
    "conferences": "Conferences",
    "airlines": "Airlines",
    "others": "Others",
}

SEGMENT_ORDER = [
    "corporate",
    "leisure",
    "transient",
    "long_stay",
    "groups",
    "events",
    "conferences",
    "airlines",
    "others",
]

SEGMENT_ROW_METRICS = {
    "rooms occupied per day": "rooms_per_day",
    "rooms occupied per day (rpd)": "rooms_per_day",
    "arr (rs.)": "arr",
    "arr": "arr",
    "room income (rs. lakhs)": "room_income",
    "room income (rs. lakh)": "room_income",
    "room income": "room_income",
}


# --------------------------------------------------------------------------- #
# Outlets (sheet 1.3)
# --------------------------------------------------------------------------- #
OUTLET_METRIC_GROUPS = {
    "food & beverage income": "revenue",
    "food and beverage income": "revenue",
    "covers-resident": "covers_resident",
    "covers - resident": "covers_resident",
    "covers-non resident": "covers_non_resident",
    "covers - non resident": "covers_non_resident",
    "total covers (tc)": "covers_total",
    "total covers": "covers_total",
    "covers/day": "covers_per_day",
    "covers per day": "covers_per_day",
    "average price per cover (apc)": "apc",
    "average price per cover": "apc",
    "apc": "apc",
}

def match_outlet_group(label: str) -> str | None:
    """Resolve an outlet-sheet header group, ignoring any trailing unit.

    Books label the same group 'Average Price per Cover (APC)' or
    'Average  Price per Cover (In Rs.)' depending on the property.
    """
    key = norm(label)
    if key in OUTLET_METRIC_GROUPS:
        return OUTLET_METRIC_GROUPS[key]
    return OUTLET_METRIC_GROUPS.get(strip_qualifier(key))


# Grand-total rows in the outlet sheet, which we must not store as an outlet.
OUTLET_TOTAL_LABELS = {"food & beverages", "total", "grand total", "f&b total"}


# --------------------------------------------------------------------------- #
# Row-oriented outlet / workings blocks (bespoke MIS layout)
# --------------------------------------------------------------------------- #
def squash(label: str) -> str:
    """Reduce a label to letters only.

    Defensive against the punctuation drift and stray characters seen in
    hand-maintained sheets ('Non-R20.54esident Covers' -> 'nonresidentcovers').
    """
    return re.sub(r"[^a-z]", "", strip_qualifier(label))


OUTLET_ROW_METRICS = {
    "fbincome": "revenue",
    "fandbincome": "revenue",
    "avgcheck": "apc",
    "averagecheck": "apc",
    "avgdailynoofcovers": "covers_per_day",
    "averagedailynoofcovers": "covers_per_day",
    "totalnoofcovers": "covers_total",
    "totalcovers": "covers_total",
    "residentcovers": "covers_resident",
    "nonresidentcovers": "covers_non_resident",
}

SEGMENT_ROW_METRICS_SQUASHED = {
    "roomsperday": "rooms_per_day",
    "roomsoccupiedperday": "rooms_per_day",
    "arr": "arr",
    "monthlyincome": "room_income",
    "roomincome": "room_income",
}

WORKINGS_METRICS = {
    "foodcost": "food_cost",
    "foodsale": "food_sales",
    "softdrinkcost": "soft_drink_cost",
    "softdrinksale": "soft_drink_sales",
    "beercost": "beer_cost",
    "beersale": "beer_sales",
    "liquorcost": "liquor_cost",
    "liquorsale": "spirits_wines_sales",
    "smokecost": "smoke_cost",
    "smokesale": "smoke_sales",
}
