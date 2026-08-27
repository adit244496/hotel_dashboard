import { Bar } from 'react-chartjs-2'
import { ChartCard, Kpi, TableCard } from '../components/common'
import { BAR_MARK, barOptions, horizontalBarOptions, tokensOr } from '../components/charts'
import { useTheme } from '../theme/ThemeContext'
import { aggregate } from '../lib/aggregate'
import { percent, ratio, ratioText } from '../lib/format'

/**
 * Cost heads. Raw material is expressed against F&B revenue (the convention in
 * the MIS books); every other head is against total revenue.
 */
const HEADS = [
  { key: 'rm', label: 'RM % of F&B', short: 'RM (F&B)', base: 'fnb' },
  { key: 'pay', label: 'Payroll %', short: 'Payroll', base: 'rev' },
  { key: 'flp', label: 'Fuel & Power %', short: 'Fuel & Power', base: 'rev' },
  { key: 'admin', label: 'Admin %', short: 'Admin', base: 'rev' },
  { key: 'rmnt', label: 'R&M %', short: 'R&M', base: 'rev' },
  { key: 'fees', label: 'Fees %', short: 'Fees', base: 'rev' },
  { key: 'ap', label: 'A&P %', short: 'A&P', base: 'rev' },
]

export default function CostsPanel({ hotels }) {
  const { tokens } = useTheme()
  const t = tokensOr(tokens)

  const tA = aggregate(hotels, 'a')
  const tB = aggregate(hotels, 'b')
  const tL = aggregate(hotels, 'ly')

  const pct = (totals, head) => ratio(totals[head.key], totals[head.base]) ?? 0

  // One measure across cost heads — a single colour, sorted so the ranking is
  // the message rather than the hues.
  const ordered = [...HEADS].sort((a, b) => pct(tA, b) - pct(tA, a))
  const costStructure = {
    labels: ordered.map((h) => h.short),
    datasets: [
      {
        label: 'Share of revenue',
        data: ordered.map((head) => pct(tA, head)),
        backgroundColor: t.series[0],
        borderRadius: 4,
        borderSkipped: 'start',
        maxBarThickness: 22,
      },
    ],
  }

  const ebitdaData = {
    labels: hotels.map((h) => h.code),
    datasets: [
      {
        label: 'EBITDA margin',
        data: hotels.map((h) => (h.a.rev > 0 ? (h.a.ebitda / h.a.rev) * 100 : 0)),
        backgroundColor: t.series[0],
        ...BAR_MARK,
      },
    ],
  }

  return (
    <section>
      <div className="kpis">
        {HEADS.filter((h) => h.key !== 'fees').map((head) => (
          <Kpi
            key={head.key}
            title={head.label}
            value={percent(pct(tA, head))}
            budget={percent(pct(tB, head))}
            ly={percent(pct(tL, head))}
          />
        ))}
        <Kpi title="EBITDA Margin" value={percent(ratio(tA.ebitda, tA.rev) ?? 0)} />
      </div>

      <div className="charts">
        <ChartCard title="Cost structure" subtitle="Actual, share of revenue (RM against F&B)">
          <Bar
            data={costStructure}
            options={horizontalBarOptions(tokens, { format: (v) => `${v.toFixed(1)}%` })}
          />
        </ChartCard>
        <ChartCard title="EBITDA margin by hotel" subtitle="Actual, % of revenue">
          <Bar data={ebitdaData} options={barOptions(tokens, { percent: true, format: (v) => percent(v) })} />
        </ChartCard>
      </div>

      <TableCard
        title="Cost analysis"
        note="% of the relevant revenue base"
        hint={<>
            <b>Act</b> — actual, as reported in the workbook.
            <br />
            <b>Bud</b> — the budget for the same period.
            <br />
            <b>LY</b> — last year: the same period one year earlier.
          </>}
      >
        <table>
          <thead>
            <tr>
              <th rowSpan={2}>Hotel</th>
              {HEADS.map((head) => (
                <th key={head.key} colSpan={3} className="num">
                  {head.short}
                </th>
              ))}
            </tr>
            <tr>
              {HEADS.flatMap((head) => [
                <th key={`${head.key}-a`} className="num">Act</th>,
                <th key={`${head.key}-b`} className="num">Bud</th>,
                <th key={`${head.key}-l`} className="num">LY</th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {hotels.map((hotel) => (
              <tr key={hotel.code}>
                <td>
                  <b>{hotel.code}</b>
                </td>
                {HEADS.flatMap((head) => [
                  <td key={`${head.key}-a`} className="num">
                    {ratioText(hotel.a[head.key], hotel.a[head.base])}
                  </td>,
                  <td key={`${head.key}-b`} className="num muted">
                    {ratioText(hotel.b[head.key], hotel.b[head.base])}
                  </td>,
                  <td key={`${head.key}-l`} className="num muted">
                    {ratioText(hotel.ly[head.key], hotel.ly[head.base])}
                  </td>,
                ])}
              </tr>
            ))}
            {hotels.length > 1 && (
              <tr className="total-row">
                <td>
                  <b>TOTAL</b>
                </td>
                {HEADS.flatMap((head) => [
                  <td key={`${head.key}-a`} className="num">{pct(tA, head).toFixed(1)}</td>,
                  <td key={`${head.key}-b`} className="num">{pct(tB, head).toFixed(1)}</td>,
                  <td key={`${head.key}-l`} className="num">
                    {tL[head.base] ? pct(tL, head).toFixed(1) : '-'}
                  </td>,
                ])}
              </tr>
            )}
          </tbody>
        </table>
      </TableCard>
    </section>
  )
}
