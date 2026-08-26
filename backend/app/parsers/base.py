"""Shared result types for all workbook parsers."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

PERIOD_TYPES = ("MTD", "YTD")
SCENARIOS = ("ACT", "BUD", "LY")


@dataclass
class SegmentRow:
    period_type: str
    scenario: str
    segment: str
    rooms_per_day: float | None = None
    arr: float | None = None
    room_income: float | None = None


@dataclass
class OutletRow:
    period_type: str
    scenario: str
    outlet: str
    revenue: float | None = None
    covers_resident: float | None = None
    covers_non_resident: float | None = None
    covers_total: float | None = None
    covers_per_day: float | None = None
    apc: float | None = None


@dataclass
class ParseResult:
    parser: str
    fiscal_year: str | None = None
    month: int | None = None
    entity_code: str | None = None
    hotel_hint: str | None = None
    room_inventory: float | None = None
    # metrics[period_type][scenario][metric] = value
    metrics: dict[str, dict[str, dict[str, float]]] = field(default_factory=dict)
    segments: list[SegmentRow] = field(default_factory=list)
    outlets: list[OutletRow] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    sheets_used: list[str] = field(default_factory=list)

    def bucket(self, period_type: str, scenario: str) -> dict[str, float]:
        return self.metrics.setdefault(period_type, {}).setdefault(scenario, {})

    def add(
        self, period_type: str, scenario: str, metric: str, value: float, accumulate: bool
    ) -> None:
        bucket = self.bucket(period_type, scenario)
        if accumulate:
            bucket[metric] = bucket.get(metric, 0.0) + value
        else:
            bucket.setdefault(metric, value)

    def to_payload(self) -> dict:
        return {
            "parser": self.parser,
            "fiscal_year": self.fiscal_year,
            "month": self.month,
            "entity_code": self.entity_code,
            "hotel_hint": self.hotel_hint,
            "room_inventory": self.room_inventory,
            "metrics": self.metrics,
            "segments": [asdict(s) for s in self.segments],
            "outlets": [asdict(o) for o in self.outlets],
            "warnings": self.warnings,
            "sheets_used": self.sheets_used,
        }


class ParserError(Exception):
    """Raised when a workbook cannot be understood by any parser."""
