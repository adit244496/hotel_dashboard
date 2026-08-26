import { useEffect, useState } from 'react'
import { Bar } from 'react-chartjs-2'
import { Alert, ChartCard, EmptyState, Hint, Kpi, TableCard } from '../components/common'
import { BAR_MARK, barOptions, tokensOr } from '../components/charts'
import { useTheme } from '../theme/ThemeContext'
import { api } from '../api/client'
import {
  money,
  monthYearLabel,
  percent,
  rupees,
  toUnit,
  unitLabel,
  unitValue,
} from '../lib/format'

const METRICS = [
  { value: 'turnover', label: 'Total Revenue', kind: 'money' },
  { value: 'room_income', label: 'Room Revenue', kind: 'money' },
  { value: 'fnb_income', label: 'F&B Revenue', kind: 'money' },
  { value: 'ebitda', label: 'EBITDA', kind: 'money' },
  { value: 'payroll_cost', label: 'Payroll Cost', kind: 'money' },
  { value: 'occupancy_pct', label: 'Occupancy %', kind: 'percent' },
  { value: 'arr', label: 'ARR', kind: 'rupees' },
  { value: 'revpar', label: 'RevPAR', kind: 'rupees' },
]

const BASES = [
  { value: 'mom', label: 'MoM', full: 'Month on month' },
  { value: 'qoq', label: 'QoQ', full: 'Quarter on quarter' },
  { value: 'yoy', label: 'YoY', full: 'Year on year' },
]

/** Signed percentage with an arrow, so direction is not colour-only. */
function Change({ value }) {
  if (value === null || value === undefined) return <span className="muted">—</span>
  const kind = value > 0.05 ? 'up' : value < -0.05 ? 'down' : 'flat'
  const arrow = kind === 'up' ? '▲' : kind === 'down' ? '▼' : '—'
  return (
    <span className={`delta ${kind}`}>
      <span aria-hidden="true">{arrow}</span>
      {Math.abs(value).toFixed(1)}%
    </span>
  )
}

export default function GrowthPanel({ hotelCodes, currency, fiscalYear, month }) {
  const { tokens } = useTheme()
  const t = tokensOr(tokens)

  const [metric, setMetric] = useState('turnover')
  const [basis, setBasis] = useState('yoy')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const definition = METRICS.find((m) => m.value === metric)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    api
      .growth({
        metric,
        fiscal_year: fiscalYear,
        month,
        hotels: hotelCodes.join(','),
      })
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [metric, fiscalYear, month, hotelCodes])

  if (loading && !data) return <div className="spinner-wrap">Loading comparisons…</div>
  if (error) return <div className="alert error">{error}</div>
  if (!data || data.rows.length === 0) {
    return <EmptyState title="No data for this period">Pick a month that has data.</EmptyState>
  }

  const show = (value) => {
    if (value === null || value === undefined) return '—'
    if (definition.kind === 'money') return money(value, currency)
    if (definition.kind === 'percent') return percent(value)
    return rupees(value)
  }

  const { periods, rows, totals } = data
  const currentLabel = monthYearLabel(periods.current.month, periods.current.fiscal_year)

  const baseLabel = (key) => {
    if (key === 'mom') return monthYearLabel(periods.mom.month, periods.mom.fiscal_year)
    if (key === 'yoy') return monthYearLabel(periods.yoy.month, periods.yoy.fiscal_year)
    return `Q${periods.qoq.previous.quarter} FY${periods.qoq.previous.fiscal_year}`
  }
  const currentFor = (key) =>
    key === 'qoq' ? `Q${periods.qoq.current.quarter} FY${periods.qoq.current.fiscal_year}` : currentLabel

  const active = BASES.find((b) => b.value === basis)
  const activeTotals = totals[basis]

  // Growth is genuinely directional, so the status palette carries meaning
  // here; the signed label repeats it for anyone who cannot use the colour.
  const chartRows = rows.filter((r) => r[basis].change_pct !== null)
  const chartData = {
    labels: chartRows.map((r) => r.code),
    datasets: [
      {
        label: `${active.label} change`,
        data: chartRows.map((r) => r[basis].change_pct),
        backgroundColor: chartRows.map((r) =>
          r[basis].change_pct >= 0 ? t.good : t.critical
        ),
        ...BAR_MARK,
        borderSkipped: false,
      },
    ],
  }

  const scaled = (value) =>
    definition.kind === 'money' ? toUnit(value, currency) : value
  const levelData = {
    labels: rows.map((r) => r.code),
    datasets: [
      {
        label: currentFor(basis),
        data: rows.map((r) => scaled(r[basis].current)),
        backgroundColor: t.series[0],
        ...BAR_MARK,
      },
      {
        label: baseLabel(basis),
        data: rows.map((r) => scaled(r[basis].previous)),
        backgroundColor: t.series[2],
        ...BAR_MARK,
      },
    ],
  }

  const unavailable = !activeTotals.available
  const partialQuarter =
    basis === 'qoq' &&
    rows.some(
      (r) =>
        r.qoq.current_months !== undefined &&
        r.qoq.previous_months !== undefined &&
        r.qoq.current_months !== r.qoq.previous_months
    )

  return (
    <section>
      <div className="form-row">
        <div className="filter">
          <label>Metric</label>
          <select value={metric} onChange={(e) => setMetric(e.target.value)}>
            {METRICS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="filter">
          <label>
            Comparison
            <Hint>
              Fiscal quarters run Apr–Jun (Q1), Jul–Sep (Q2), Oct–Dec (Q3) and
              Jan–Mar (Q4).
              <br />
              <br />
              Year on year works from a single upload, because each workbook
              carries its own prior-year column. Month and quarter comparisons
              need the neighbouring periods uploaded.
              <br />
              <br />
              Rates such as occupancy and ARR are averaged across months; money
              is summed.
            </Hint>
          </label>
          <div className="segmented" role="group" aria-label="Comparison basis">
            {BASES.map((b) => (
              <button
                key={b.value}
                className={basis === b.value ? 'active' : ''}
                onClick={() => setBasis(b.value)}
                aria-pressed={basis === b.value}
                title={b.full}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
        <div className="basis-note">
          <b>{currentFor(basis)}</b> vs <b>{baseLabel(basis)}</b>
        </div>
      </div>

      {unavailable && (
        <Alert kind="warn" title={`${active.full} is not available yet.`}>
          {basis === 'yoy'
            ? 'The uploaded workbooks carry no prior-year figures for this metric.'
            : `Nothing is loaded for ${baseLabel(basis)}. Upload it and this fills in.`}
        </Alert>
      )}

      {partialQuarter && (
        <Alert kind="warn" title="Quarters cover different month counts.">
          Not like for like — the table shows each quarter&apos;s month count.
        </Alert>
      )}

      <div className="kpis">
        <Kpi title={`${currentFor(basis)}`} value={show(activeTotals.current)} />
        <Kpi title={baseLabel(basis)} value={show(activeTotals.previous)} />
        <Kpi
          title={`${active.label} change`}
          value={
            activeTotals.change_pct === null
              ? '—'
              : `${activeTotals.change_pct > 0 ? '+' : ''}${activeTotals.change_pct.toFixed(1)}%`
          }
        />
        <Kpi
          title="Absolute change"
          value={activeTotals.change === null ? '—' : show(activeTotals.change)}
        />
      </div>

      <div className="charts">
        <ChartCard
          title={`${active.label} change by hotel`}
          subtitle={`${definition.label} · ${currentFor(basis)} vs ${baseLabel(basis)}`}
        >
          {chartRows.length > 0 ? (
            <Bar
              data={chartData}
              options={barOptions(tokens, {
                format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`,
                labelFormat: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`,
              })}
            />
          ) : (
            <div className="spinner-wrap">Nothing to compare for this basis.</div>
          )}
        </ChartCard>
        <ChartCard
          title="Levels side by side"
          subtitle={
            definition.kind === 'money'
              ? `${definition.label}, ${unitLabel(currency)}`
              : definition.label
          }
        >
          <Bar
            data={levelData}
            options={barOptions(tokens, {
              showLegend: true,
              format: (v) =>
                definition.kind === 'money' ? unitValue(v, currency) : show(v),
              labelFormat: (v) =>
                definition.kind === 'money'
                  ? Math.round(v).toLocaleString('en-IN')
                  : show(v),
            })}
          />
        </ChartCard>
      </div>

      <TableCard
        title={`${definition.label}: all three comparisons`}
        note={`Current period ${currentLabel}`}
      >
        <table>
          <thead>
            <tr>
              <th rowSpan={2}>Hotel</th>
              <th rowSpan={2} className="num">
                {currentLabel}
              </th>
              <th colSpan={2} className="num">
                MoM vs {baseLabel('mom')}
              </th>
              <th colSpan={3} className="num">
                QoQ · Q{periods.qoq.current.quarter} vs Q{periods.qoq.previous.quarter}
              </th>
              <th colSpan={2} className="num">
                YoY vs {baseLabel('yoy')}
              </th>
            </tr>
            <tr>
              <th className="num">Base</th>
              <th className="num">Change</th>
              <th className="num">Quarter</th>
              <th className="num">Base</th>
              <th className="num">Change</th>
              <th className="num">Base</th>
              <th className="num">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.code}>
                <td>
                  <b>{row.code}</b>
                </td>
                <td className="num">{show(row.mom.current)}</td>
                <td className="num muted">{show(row.mom.previous)}</td>
                <td className="num">
                  <Change value={row.mom.change_pct} />
                </td>
                <td className="num">
                  {show(row.qoq.current)}
                  {row.qoq.current_months ? (
                    <span className="muted"> ({row.qoq.current_months}m)</span>
                  ) : null}
                </td>
                <td className="num muted">
                  {show(row.qoq.previous)}
                  {row.qoq.previous_months ? ` (${row.qoq.previous_months}m)` : ''}
                </td>
                <td className="num">
                  <Change value={row.qoq.change_pct} />
                </td>
                <td className="num muted">{show(row.yoy.previous)}</td>
                <td className="num">
                  <Change value={row.yoy.change_pct} />
                </td>
              </tr>
            ))}
            <tr className="total-row">
              <td>
                <b>TOTAL</b>
              </td>
              <td className="num">{show(totals.mom.current)}</td>
              <td className="num">{show(totals.mom.previous)}</td>
              <td className="num">
                <Change value={totals.mom.change_pct} />
              </td>
              <td className="num">{show(totals.qoq.current)}</td>
              <td className="num">{show(totals.qoq.previous)}</td>
              <td className="num">
                <Change value={totals.qoq.change_pct} />
              </td>
              <td className="num">{show(totals.yoy.previous)}</td>
              <td className="num">
                <Change value={totals.yoy.change_pct} />
              </td>
            </tr>
          </tbody>
        </table>
      </TableCard>

    </section>
  )
}
