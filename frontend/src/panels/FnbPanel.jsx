import { Bar } from 'react-chartjs-2'
import { ChartCard, Delta, Kpi, TableCard } from '../components/common'
import { BAR_MARK, barOptions, segmentGap, stackedPercentOptions, tokensOr } from '../components/charts'
import { useTheme } from '../theme/ThemeContext'
import { aggregate, mergeOutlets } from '../lib/aggregate'
import {
  axisNumber,
  money,
  num,
  percent,
  ratio,
  ratioText,
  rupees,
  toUnit,
  unitLabel,
  unitValue,
} from '../lib/format'

export default function FnbPanel({ hotels, currency }) {
  const { tokens } = useTheme()
  const t = tokensOr(tokens)

  const tA = aggregate(hotels, 'a')
  const tB = aggregate(hotels, 'b')
  const tL = aggregate(hotels, 'ly')

  const labels = hotels.map((h) => h.code)
  const fmt = (v) => money(v, currency)

  const fnbData = {
    labels,
    datasets: [
      { label: 'Actual', data: hotels.map((h) => toUnit(h.a.fnb, currency)), backgroundColor: t.series[0], ...BAR_MARK },
      { label: 'Budget', data: hotels.map((h) => toUnit(h.b.fnb, currency)), backgroundColor: t.series[1], ...BAR_MARK },
      { label: 'Last year', data: hotels.map((h) => toUnit(h.ly.fnb, currency)), backgroundColor: t.series[2], ...BAR_MARK },
    ],
  }

  const shareOf = (hotel, key) => {
    const total = (hotel.a.room || 0) + (hotel.a.fnb || 0)
    return total > 0 ? (hotel.a[key] / total) * 100 : 0
  }
  const mixData = {
    labels,
    datasets: [
      {
        label: 'Rooms',
        data: hotels.map((h) => shareOf(h, 'room')),
        backgroundColor: t.series[0],
        ...segmentGap(tokens),
        borderRadius: 4,
      },
      {
        label: 'F&B',
        data: hotels.map((h) => shareOf(h, 'fnb')),
        backgroundColor: t.series[1],
        ...segmentGap(tokens),
        borderRadius: 4,
      },
    ],
  }

  const outlets = mergeOutlets(hotels)
  const reporting = hotels.filter((h) => (h.out || []).length > 0).length
  const outletNote = outlets.length
    ? `${outlets.length} outlets · ${reporting} of ${hotels.length} hotels reported outlet detail`
    : undefined

  return (
    <section>
      <div className="kpis">
        <Kpi
          title="F&B Revenue"
          value={fmt(tA.fnb)}
          budget={fmt(tB.fnb)}
          ly={fmt(tL.fnb)}
          delta={<Delta actual={tA.fnb} base={tB.fnb} />}
        />
        <Kpi
          title="Food Cost %"
          value={percent(ratio(tA.food, tA.fnb) ?? 0)}
          budget={percent(ratio(tB.food, tB.fnb) ?? 0)}
          ly={percent(ratio(tL.food, tL.fnb) ?? 0)}
        />
        <Kpi
          title="Beverage Cost %"
          value={percent(ratio(tA.bw, tA.fnb) ?? 0)}
          budget={percent(ratio(tB.bw, tB.fnb) ?? 0)}
          ly={percent(ratio(tL.bw, tL.fnb) ?? 0)}
        />
        <Kpi
          title="Smoke Cost %"
          value={percent(ratio(tA.smoke, tA.fnb) ?? 0)}
          budget={percent(ratio(tB.smoke, tB.fnb) ?? 0)}
          ly={percent(ratio(tL.smoke, tL.fnb) ?? 0)}
        />
      </div>

      <div className="charts">
        <ChartCard title="F&B revenue" subtitle={`Actual vs budget vs last year, ${unitLabel(currency)}`}>
          <Bar
            data={fnbData}
            options={barOptions(tokens, {
              showLegend: true,
              format: (v) => unitValue(v, currency),
              labelFormat: axisNumber,
            })}
          />
        </ChartCard>
        <ChartCard title="Rooms vs F&B mix" subtitle="Share of rooms + F&B revenue, actual">
          <Bar
            data={mixData}
            options={stackedPercentOptions(tokens, { format: (v) => `${v.toFixed(1)}%` })}
          />
        </ChartCard>
      </div>

      <TableCard title="F&B performance">
        <table>
          <thead>
            <tr>
              <th rowSpan={2}>Hotel</th>
              <th colSpan={3} className="num">F&B revenue</th>
              <th colSpan={3} className="num">Food cost %</th>
              <th rowSpan={2} className="num">Bev %</th>
              <th rowSpan={2} className="num">Smoke %</th>
              <th rowSpan={2} className="num">vs Bud</th>
              <th rowSpan={2} className="num">vs LY</th>
            </tr>
            <tr>
              <th className="num">Act</th>
              <th className="num">Bud</th>
              <th className="num">LY</th>
              <th className="num">Act</th>
              <th className="num">Bud</th>
              <th className="num">LY</th>
            </tr>
          </thead>
          <tbody>
            {hotels.map((h) => (
              <tr key={h.code}>
                <td>
                  <b>{h.code}</b>
                </td>
                <td className="num">{fmt(h.a.fnb)}</td>
                <td className="num muted">{fmt(h.b.fnb)}</td>
                <td className="num muted">{fmt(h.ly.fnb)}</td>
                <td className="num">{ratioText(h.a.food, h.a.fnb)}</td>
                <td className="num muted">{ratioText(h.b.food, h.b.fnb)}</td>
                <td className="num muted">{ratioText(h.ly.food, h.ly.fnb)}</td>
                <td className="num">{ratioText(h.a.bw, h.a.fnb)}</td>
                <td className="num">{ratioText(h.a.smoke, h.a.fnb)}</td>
                <td className="num">
                  <Delta actual={h.a.fnb} base={h.b.fnb} />
                </td>
                <td className="num">
                  <Delta actual={h.a.fnb} base={h.ly.fnb} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>

      <TableCard title="Outlet performance" note={outletNote}>
        <table>
          <thead>
            <tr>
              <th>Outlet</th>
              <th className="num">Revenue</th>
              <th className="num">Covers</th>
              <th className="num">In-house</th>
              <th className="num">Walk-in</th>
              <th className="num">Avg per cover</th>
            </tr>
          </thead>
          <tbody>
            {outlets.map((outlet) => (
              <tr key={outlet.name}>
                <td>{outlet.name}</td>
                <td className="num">{fmt(outlet.rev)}</td>
                <td className="num">{num(outlet.cov)}</td>
                <td className="num muted">{num(outlet.ih)}</td>
                <td className="num muted">{num(outlet.wi)}</td>
                <td className="num">{rupees(outlet.apc)}</td>
              </tr>
            ))}
            {outlets.length === 0 && (
              <tr>
                <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: '20px' }}>
                  No outlet detail in the uploaded books for this period. Most MIS
                  books publish the outlet statement for the month only — switch the
                  Period filter to Monthly to see it.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableCard>
    </section>
  )
}
