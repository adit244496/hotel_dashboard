import { Bar, Doughnut } from 'react-chartjs-2'
import { ChartCard, Delta, Kpi, TableCard } from '../components/common'
import { BAR_MARK, barOptions, doughnutOptions, segmentGap, tokensOr } from '../components/charts'
import { useTheme } from '../theme/ThemeContext'
import { aggregate } from '../lib/aggregate'
import { axisNumber, money, percent, ratio, toUnit, unitLabel, unitValue } from '../lib/format'

export default function ExecutivePanel({ hotels, currency }) {
  const { tokens } = useTheme()
  const t = tokensOr(tokens)

  const tA = aggregate(hotels, 'a')
  const tB = aggregate(hotels, 'b')
  const tL = aggregate(hotels, 'ly')

  const fmt = (v) => money(v, currency) ?? '-'
  const unit = unitLabel(currency)

  // One series across nominal categories, so one colour for every bar —
  // hotel identity is already carried by the axis label.
  const revenueData = {
    labels: hotels.map((h) => h.code),
    datasets: [
      {
        label: 'Revenue',
        data: hotels.map((h) => toUnit(h.a.rev, currency)),
        backgroundColor: t.series[0],
        ...BAR_MARK,
      },
    ],
  }

  const mix = [tA.room, tA.fnb, tA.other]
  const mixTotal = mix.reduce((a, b) => a + b, 0)
  const share = (value) => (mixTotal > 0 ? ((value / mixTotal) * 100).toFixed(1) : '0.0')
  const mixData = {
    labels: [
      `Rooms ${share(mix[0])}%`,
      `F&B ${share(mix[1])}%`,
      `Other ${share(mix[2])}%`,
    ],
    datasets: [{ data: mix, backgroundColor: t.series, ...segmentGap(tokens) }],
  }

  return (
    <section>
      <div className="kpis">
        <Kpi
          title="Total Revenue"
          value={fmt(tA.rev)}
          budget={fmt(tB.rev)}
          ly={fmt(tL.rev)}
          delta={<Delta actual={tA.rev} base={tB.rev} />}
        />
        <Kpi
          title="EBITDA"
          value={fmt(tA.ebitda)}
          budget={fmt(tB.ebitda)}
          ly={fmt(tL.ebitda)}
          delta={<Delta actual={tA.ebitda} base={tB.ebitda} />}
        />
        <Kpi
          title="EBITDA Margin"
          value={percent(ratio(tA.ebitda, tA.rev) ?? 0)}
          budget={percent(ratio(tB.ebitda, tB.rev) ?? 0)}
          ly={percent(ratio(tL.ebitda, tL.rev) ?? 0)}
        />
        <Kpi
          title="Room Revenue"
          value={fmt(tA.room)}
          budget={fmt(tB.room)}
          ly={fmt(tL.room)}
          delta={<Delta actual={tA.room} base={tB.room} />}
        />
        <Kpi
          title="F&B Revenue"
          value={fmt(tA.fnb)}
          budget={fmt(tB.fnb)}
          ly={fmt(tL.fnb)}
          delta={<Delta actual={tA.fnb} base={tB.fnb} />}
        />
      </div>

      <div className="charts">
        <ChartCard title="Revenue by hotel" subtitle={`Actual, ${unit}`}>
          <Bar
            data={revenueData}
            options={barOptions(tokens, {
              format: (v) => unitValue(v, currency),
              labelFormat: axisNumber,
            })}
          />
        </ChartCard>
        <ChartCard title="Revenue mix" subtitle="Share of total actual revenue">
          <Doughnut data={mixData} options={doughnutOptions(tokens, { format: fmt })} />
        </ChartCard>
      </div>

      <TableCard title="Revenue summary" note="Figures in the selected currency unit">
        <table>
          <thead>
            <tr>
              <th>Hotel</th>
              <th className="num">Actual</th>
              <th className="num">Budget</th>
              <th className="num">Last year</th>
              <th className="num">vs Budget</th>
              <th className="num">vs LY</th>
            </tr>
          </thead>
          <tbody>
            {hotels.map((hotel) => (
              <tr key={hotel.code}>
                <td>
                  <b>{hotel.code}</b>
                </td>
                <td className="num">{fmt(hotel.a.rev)}</td>
                <td className="num">{fmt(hotel.b.rev)}</td>
                <td className="num">{fmt(hotel.ly.rev)}</td>
                <td className="num">
                  <Delta actual={hotel.a.rev} base={hotel.b.rev} />
                </td>
                <td className="num">
                  <Delta actual={hotel.a.rev} base={hotel.ly.rev} />
                </td>
              </tr>
            ))}
            {hotels.length > 1 && (
              <tr className="total-row">
                <td>
                  <b>TOTAL</b>
                </td>
                <td className="num">{fmt(tA.rev)}</td>
                <td className="num">{fmt(tB.rev)}</td>
                <td className="num">{fmt(tL.rev)}</td>
                <td className="num">
                  <Delta actual={tA.rev} base={tB.rev} />
                </td>
                <td className="num">
                  <Delta actual={tA.rev} base={tL.rev} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableCard>
    </section>
  )
}
