import { useEffect, useState } from 'react'
import { Line } from 'react-chartjs-2'
import { ChartCard, Delta, EmptyState, TableCard } from '../components/common'
import { lineOptions, tokensOr } from '../components/charts'
import { useTheme } from '../theme/ThemeContext'
import { api } from '../api/client'
import {
  axisNumber,
  money,
  monthYearLabel,
  num,
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

export default function TrendsPanel({ hotelCodes, currency, period }) {
  const { tokens } = useTheme()
  const t = tokensOr(tokens)

  const [metric, setMetric] = useState('turnover')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const definition = METRICS.find((m) => m.value === metric)
  const isAdditive = definition.kind === 'money'

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    api
      .trend({ metric, period, hotels: hotelCodes.join(',') })
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [metric, period, hotelCodes])

  if (loading && !data) return <div className="spinner-wrap">Loading history…</div>
  if (error) return <div className="alert error">{error}</div>

  const points = data?.points || []
  if (points.length === 0) {
    return (
      <EmptyState title="No history yet">
        Trends build up as monthly books are uploaded. Upload more months to see
        the series here.
      </EmptyState>
    )
  }

  const show = (value) => {
    if (definition.kind === 'money') return money(value, currency)
    if (definition.kind === 'percent') return percent(value)
    if (definition.kind === 'rupees') return rupees(value)
    return num(value)
  }

  const scale = (value) => (isAdditive ? toUnit(value, currency) : value)
  const labels = points.map((p) => monthYearLabel(p.month, p.fiscal_year))

  const line = (label, key, color, dash) => ({
    label,
    data: points.map((p) => scale(p[key])),
    borderColor: color,
    backgroundColor: color,
    pointBackgroundColor: color,
    pointBorderColor: t.surface,
    borderDash: dash,
  })

  const chartData = {
    labels,
    datasets: [
      line('Actual', 'ACT', t.series[0]),
      line('Budget', 'BUD', t.series[1], [6, 4]),
      line('Last year', 'LY', t.series[2]),
    ],
  }

  const unit = definition.kind === 'money' ? ` · ${unitLabel(currency)}` : ''

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
        <div className="basis-note">
          {isAdditive ? 'Summed' : 'Averaged'} across the selected hotels
        </div>
      </div>

      <div className="charts" style={{ gridTemplateColumns: '1fr' }}>
        <ChartCard
          title={definition.label}
          subtitle={`${period} by month${unit}`}
          tall
        >
          <Line
            data={chartData}
            options={lineOptions(tokens, {
              format: (v) => (isAdditive ? unitValue(v, currency) : show(v)),
              labelFormat: axisNumber,
            })}
          />
        </ChartCard>
      </div>

      <TableCard title={`${definition.label} history`} note={`${points.length} month(s) on record`}>
        <table>
          <thead>
            <tr>
              <th>Period</th>
              <th className="num">Actual</th>
              <th className="num">Budget</th>
              <th className="num">Last year</th>
              <th className="num">vs Budget</th>
              <th className="num">vs LY</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={`${p.fiscal_year}-${p.month}`}>
                <td>{monthYearLabel(p.month, p.fiscal_year)}</td>
                <td className="num">{show(p.ACT)}</td>
                <td className="num muted">{show(p.BUD)}</td>
                <td className="num muted">{show(p.LY)}</td>
                <td className="num">
                  <Delta actual={p.ACT} base={p.BUD} />
                </td>
                <td className="num">
                  <Delta actual={p.ACT} base={p.LY} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
    </section>
  )
}
