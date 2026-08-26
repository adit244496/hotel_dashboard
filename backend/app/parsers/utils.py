"""Low-level helpers shared by the workbook parsers.

The MIS books that hotels send are structurally similar but never identical:
sheet names differ, header rows sit at different offsets, and line-item labels
wrap across two rows. Everything here is therefore driven by *content* — we
locate the header by finding the "Particulars" cell and match line items by
their text, never by fixed row/column coordinates.
"""

from __future__ import annotations

import calendar
import re
from dataclasses import dataclass, field

MONTHS = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "sept": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}

MONTH_ABBR = {
    1: "Jan",
    2: "Feb",
    3: "Mar",
    4: "Apr",
    5: "May",
    6: "Jun",
    7: "Jul",
    8: "Aug",
    9: "Sep",
    10: "Oct",
    11: "Nov",
    12: "Dec",
}

# Indian hotel fiscal year runs April -> March.
FISCAL_MONTH_ORDER = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]

_YEAR_PAIR = re.compile(r"(20\d{2})\s*[/\-]\s*(\d{2})")
_WS = re.compile(r"\s+")


def norm(value) -> str:
    """Normalise a label for matching: lowercase, single-spaced, trimmed."""
    if value is None:
        return ""
    text = str(value).replace("\xa0", " ")
    return _WS.sub(" ", text).strip().lower()


def to_float(value) -> float | None:
    """Coerce a cell value to a float, tolerating strings, blanks and errors."""
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        f = float(value)
        # Excel error values sometimes survive as huge sentinels.
        return None if f != f else f
    text = str(value).strip()
    if not text or text.startswith("#"):
        return None
    text = text.replace(",", "").replace("₹", "").replace("%", "").strip()
    negative = text.startswith("(") and text.endswith(")")
    if negative:
        text = text[1:-1]
    try:
        f = float(text)
    except ValueError:
        return None
    return -f if negative else f


def parse_fiscal_year(text: str) -> str | None:
    """'2025/26' or '2025-26' -> '2025-26'."""
    m = _YEAR_PAIR.search(text or "")
    if not m:
        return None
    return f"{m.group(1)}-{m.group(2)}"


def fiscal_year_start(fiscal_year: str) -> int:
    return int(fiscal_year.split("-")[0])


def calendar_year_for(fiscal_year: str, month: int) -> int:
    """April..December fall in the first calendar year, January..March the next."""
    start = fiscal_year_start(fiscal_year)
    return start if month >= 4 else start + 1


def fiscal_year_of(calendar_year: int, month: int) -> str:
    """Fiscal year label containing a calendar month, e.g. (2026, 2) -> '2025-26'."""
    start = calendar_year if month >= 4 else calendar_year - 1
    return f"{start}-{(start + 1) % 100:02d}"


def walk_back_months(calendar_year: int, month: int, count: int):
    """Yield (fiscal_year, month, calendar_year) going back from a start point."""
    year, m = calendar_year, month
    for _ in range(count):
        yield fiscal_year_of(year, m), m, year
        m -= 1
        if m == 0:
            m = 12
            year -= 1


def days_in_period(fiscal_year: str, month: int, period_type: str) -> int:
    """Days in the month (MTD) or from 1 April to month end (YTD)."""
    if period_type == "MTD":
        year = calendar_year_for(fiscal_year, month)
        return calendar.monthrange(year, month)[1]
    total = 0
    for m in FISCAL_MONTH_ORDER:
        year = calendar_year_for(fiscal_year, m)
        total += calendar.monthrange(year, m)[1]
        if m == month:
            break
    return total


def month_from_label(label: str) -> int | None:
    """Pull a month out of a header label such as 'Dec' or 'YTD Dec'."""
    tokens = re.split(r"[^a-z]+", norm(label))
    for token in tokens:
        if token in MONTHS:
            return MONTHS[token]
    return None


# --------------------------------------------------------------------------- #
# Header decoding
# --------------------------------------------------------------------------- #
@dataclass
class ColumnGroup:
    """A header group (e.g. 'Dec', 'YTD Dec', 'Covers/Day') and its columns."""

    label: str
    start_col: int
    end_col: int
    columns: dict[str, int] = field(default_factory=dict)  # scenario -> column


def find_header_row(ws, max_row: int = 20) -> int | None:
    """Row containing the 'Particulars' cell in the first column."""
    limit = min(ws.max_row, max_row)
    for r in range(1, limit + 1):
        for c in range(1, min(ws.max_column, 3) + 1):
            if norm(ws.cell(r, c).value) == "particulars":
                return r
    return None


def _column_signature(ws, header_row: int, col: int, depth: int = 2) -> str:
    """Text of the sub-header cells under a group, joined for classification."""
    parts = []
    for r in range(header_row, header_row + depth + 1):
        value = ws.cell(r, col).value
        if isinstance(value, str) and value.strip():
            parts.append(norm(value))
    return " ".join(parts)


def read_column_groups(ws, header_row: int, max_col: int | None = None) -> list[ColumnGroup]:
    """Decode the two-tier header into groups and ACT / BUD / LY columns.

    The top tier (``header_row``) carries group labels — periods in the P&L
    sheets ('Dec', 'YTD Dec') or metrics in the outlet sheet ('Covers/Day').
    The tiers below carry scenario and fiscal year, which may be merged into a
    single newline-separated cell. Variance and forecast columns are dropped.
    """
    max_col = max_col or ws.max_column
    starts: list[tuple[str, int]] = []
    for c in range(2, max_col + 1):
        value = ws.cell(header_row, c).value
        if isinstance(value, str) and value.strip():
            starts.append((value.strip(), c))
    if not starts:
        return []

    groups: list[ColumnGroup] = []
    for idx, (label, start) in enumerate(starts):
        end = starts[idx + 1][1] - 1 if idx + 1 < len(starts) else max_col
        groups.append(ColumnGroup(label=label, start_col=start, end_col=end))

    # First pass: classify each column, collecting the fiscal years seen.
    raw: list[tuple[ColumnGroup, int, str, str | None]] = []
    years: set[str] = set()
    for group in groups:
        for c in range(group.start_col, group.end_col + 1):
            sig = _column_signature(ws, header_row, c)
            if not sig or "var" in sig or "fcst" in sig or "forecast" in sig:
                continue
            fy = parse_fiscal_year(sig)
            if "bud" in sig:
                kind = "BUD"
            elif "act" in sig:
                kind = "ACT"
            else:
                continue
            if fy:
                years.add(fy)
            raw.append((group, c, kind, fy))

    if not raw:
        return []

    current_fy = max(years) if years else None

    # Second pass: the actual column for the older fiscal year becomes LY.
    for group, col, kind, fy in raw:
        if kind == "BUD":
            scenario = "BUD"
        elif current_fy and fy and fy != current_fy:
            scenario = "LY"
        else:
            scenario = "ACT"
        # Keep the leftmost column for a scenario; later duplicates are extra
        # year columns (ACT 2023/24 etc.) that we do not model.
        group.columns.setdefault(scenario, col)

    return groups


def detect_fiscal_year(ws, header_row: int, max_col: int | None = None) -> str | None:
    max_col = max_col or ws.max_column
    years: set[str] = set()
    for r in range(header_row, min(header_row + 3, ws.max_row) + 1):
        for c in range(2, max_col + 1):
            fy = parse_fiscal_year(str(ws.cell(r, c).value or ""))
            if fy:
                years.add(fy)
    return max(years) if years else None


# --------------------------------------------------------------------------- #
# Row iteration
# --------------------------------------------------------------------------- #
@dataclass
class DataRow:
    row: int
    label: str
    values: dict[int, float]  # column -> value
    has_numbers: bool
    # Text of the nearest preceding row that had a label but no numbers. It is
    # either a section heading ('Raw Material Cost') or the first half of a
    # label that wrapped onto two rows ('Raw Material Cost (excluding').
    section: str = ""

    @property
    def joined_label(self) -> str:
        return f"{self.section} {self.label}".strip() if self.section else self.label

    def candidate_labels(self) -> list[str]:
        """Labels to try when matching, most literal first."""
        if self.section and self.joined_label != self.label:
            return [self.label, self.joined_label]
        return [self.label]


def iter_data_rows(ws, start_row: int, value_cols: list[int], label_col: int = 1):
    """Yield labelled rows together with the heading that precedes them.

    A label-only row is ambiguous: it may be a section heading ('Sales') or the
    first half of a wrapped label ('Raw Material Cost (excluding'). Rather than
    guess, every data row carries the preceding heading in ``section`` and the
    caller tries the plain label before the joined one.
    """
    section = ""
    for r in range(start_row, ws.max_row + 1):
        label = str(ws.cell(r, label_col).value or "").strip()
        values: dict[int, float] = {}
        for c in value_cols:
            v = to_float(ws.cell(r, c).value)
            if v is not None:
                values[c] = v
        has_numbers = bool(values)

        if not label and not has_numbers:
            continue

        if label and not has_numbers:
            section = label
            yield DataRow(row=r, label=label, values={}, has_numbers=False, section="")
            continue

        yield DataRow(
            row=r, label=label, values=values, has_numbers=True, section=section
        )
