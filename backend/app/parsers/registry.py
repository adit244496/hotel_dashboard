"""Parser selection.

Parsers are tried in order of how specific their signature is. The wide MIS
layout is checked first because its detector is narrow (a row of month captions
repeated across the sheet), whereas the financial-book detector matches any
sheet with Turnover and Room Income rows and would otherwise claim stale
comparison tabs that some bespoke books carry.
"""

from __future__ import annotations

from pathlib import Path

from app.parsers import financial_book, wide_mis
from app.parsers.base import ParseResult, ParserError

PARSERS = [wide_mis, financial_book]

PARSER_LABELS = {
    wide_mis.PARSER_NAME: "Wide MIS (month-block layout)",
    financial_book.PARSER_NAME: "IHCL MIS Financial Book",
}


def parse_workbook(
    path: Path, target_month: int | None = None, target_fiscal_year: str | None = None
) -> ParseResult:
    """Parse ``path`` with the first parser that recognises it.

    ``target_month`` selects the month for layouts that hold a whole year and
    is validated against the file for layouts that hold a single month.
    """
    errors: list[str] = []
    for module in PARSERS:
        try:
            if not module.detect(path):
                continue
        except Exception as exc:  # a malformed file should not mask other parsers
            errors.append(f"{module.PARSER_NAME}: {exc}")
            continue
        try:
            if module is wide_mis:
                result = module.parse(path, target_month=target_month)
            else:
                result = module.parse(path)
        except ParserError as exc:
            errors.append(f"{module.PARSER_NAME}: {exc}")
            continue

        _validate(result, target_month, target_fiscal_year)
        return result

    detail = " | ".join(errors) if errors else "no parser recognised the layout"
    raise ParserError(
        "This workbook does not match any known MIS format. "
        f"Details: {detail}"
    )


def _validate(
    result: ParseResult, target_month: int | None, target_fiscal_year: str | None
) -> None:
    """Cross-check the parse against what the uploader said the file is."""
    actual = result.metrics.get("MTD", {}).get("ACT", {})
    if not actual.get("turnover"):
        result.warnings.append(
            "No monthly actual turnover was found — check this is the right file."
        )

    if target_month and result.month and result.month != target_month:
        result.warnings.append(
            f"The workbook reports month {result.month} but you selected month "
            f"{target_month}. The values shown below are the file's."
        )
    if (
        target_fiscal_year
        and result.fiscal_year
        and result.fiscal_year != target_fiscal_year
    ):
        result.warnings.append(
            f"The workbook reports fiscal year {result.fiscal_year} but you "
            f"selected {target_fiscal_year}."
        )

    # A P&L that does not add up usually means a mis-read column.
    for period_type in ("MTD", "YTD"):
        bucket = result.metrics.get(period_type, {}).get("ACT", {})
        turnover, ebitda = bucket.get("turnover"), bucket.get("ebitda")
        opex = bucket.get("operating_expenses")
        if turnover and ebitda and opex:
            gap = abs(turnover - opex - ebitda)
            if gap > max(1.0, 0.02 * abs(turnover)):
                result.warnings.append(
                    f"{period_type}: turnover - operating expenses does not equal "
                    f"EBITDA (off by {gap:,.1f}L)."
                )


__all__ = ["parse_workbook", "PARSERS", "PARSER_LABELS", "ParserError"]
