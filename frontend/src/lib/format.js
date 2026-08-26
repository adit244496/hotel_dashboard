/** Formatting helpers, matching the original dashboard's conventions. */

export const MONTHS = [
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
]

export const MONTH_LABEL = Object.fromEntries(MONTHS.map((m) => [m.value, m.label]))
export const MONTH_SHORT = Object.fromEntries(
  MONTHS.map((m) => [m.value, m.label.slice(0, 3)])
)

const ONE_DP = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

/** Money, in lakhs or crores, with Indian digit grouping. */
export function money(value, currency) {
  if (!value) return '-'
  return currency === 'Cr'
    ? `₹${ONE_DP.format(value / 100)}Cr`
    : `₹${ONE_DP.format(value)}L`
}

/**
 * Format a value that has ALREADY been converted to the display unit.
 *
 * Chart datasets are pre-scaled with toUnit(), so passing them through money()
 * would divide by 100 a second time in crores mode.
 */
export function unitValue(value, currency) {
  if (!value) return '-'
  return `₹${ONE_DP.format(value)}${currency === 'Cr' ? 'Cr' : 'L'}`
}

/** Compact axis-tick label: grouped, no decimals. */
export function axisNumber(value) {
  if (value === 0) return '0'
  return Math.abs(value) >= 1000
    ? Math.round(value).toLocaleString('en-IN')
    : String(Math.round(value * 10) / 10)
}

/** Convert a lakh figure into the selected chart unit. */
export function toUnit(value, currency) {
  return currency === 'Cr' ? (value || 0) / 100 : value || 0
}

export function unitLabel(currency) {
  return currency === 'Cr' ? '₹Cr' : '₹L'
}

export function percent(value) {
  if (value === undefined || value === null || Number.isNaN(value)) return '-'
  return `${value.toFixed(1)}%`
}

export function num(value) {
  if (!value || Number.isNaN(value)) return '-'
  return Math.round(value).toLocaleString('en-IN')
}

export function rupees(value) {
  if (!value || Number.isNaN(value)) return '-'
  return `₹${Math.round(value).toLocaleString('en-IN')}`
}

/** Percentage variance of a against b. */
export function variance(a, b) {
  if (!b) return '0'
  return (((a - b) / b) * 100).toFixed(1)
}

export function varianceClass(a, b) {
  if (!b) return ''
  return a >= b ? 'pos' : 'neg'
}

/** Safe ratio as a percentage; returns null when the denominator is empty. */
export function ratio(numerator, denominator) {
  if (!denominator) return null
  return (numerator / denominator) * 100
}

export function ratioText(numerator, denominator, digits = 1) {
  if (!denominator) return '-'
  return ((numerator / denominator) * 100).toFixed(digits)
}

/** Fiscal year label: '2025-26' -> 'FY 2025-26'. */
export function fyLabel(fy) {
  return `FY ${fy}`
}

/**
 * Calendar year a month falls in within a fiscal year.
 * April–December sit in the first year, January–March in the next.
 */
export function calendarYearOf(month, fiscalYear) {
  const start = Number(String(fiscalYear).split('-')[0])
  if (Number.isNaN(start)) return null
  return month >= 4 ? start : start + 1
}

/** 'Dec-25' — the compact month label used in the pickers. */
export function monthYearLabel(month, fiscalYear) {
  const year = calendarYearOf(month, fiscalYear)
  if (year === null) return MONTH_SHORT[month]
  return `${MONTH_SHORT[month]}-${String(year % 100).padStart(2, '0')}`
}

/** 'Dec 2025' — the fuller form, for headings and confirmations. */
export function monthYearLong(month, fiscalYear) {
  const year = calendarYearOf(month, fiscalYear)
  if (year === null) return MONTH_LABEL[month]
  return `${MONTH_SHORT[month]} ${year}`
}

/* Chart colours live in the stylesheet as --s1..--s3 and are sampled by
   ThemeContext, so that one palette definition serves both themes. */
