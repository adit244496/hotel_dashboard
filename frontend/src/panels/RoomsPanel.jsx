import { Bar } from 'react-chartjs-2'
import { ChartCard, Delta, Kpi, TableCard } from '../components/common'
import { BAR_MARK, barOptions, tokensOr } from '../components/charts'
import { useTheme } from '../theme/ThemeContext'
import { aggregate, averageRates, mergeSegments } from '../lib/aggregate'
import { axisNumber, money, num, percent, rupees, toUnit, unitLabel, unitValue } from '../lib/format'

export default function RoomsPanel({ hotels, currency }) {
  const { tokens } = useTheme()
  const t = tokensOr(tokens)

  const tA = aggregate(hotels, 'a')
  const tB = aggregate(hotels, 'b')
  const tL = aggregate(hotels, 'ly')
  const rA = averageRates(hotels, 'a')
  const rB = averageRates(hotels, 'b')
  const rL = averageRates(hotels, 'ly')

  const labels = hotels.map((h) => h.code)
  const fmt = (v) => money(v, currency)

  /*
   * Occupancy and ARR were one dual-axis plot in the original. Two y-scales on
   * one chart imply a relationship that the arbitrary scale alignment invents,
   * so they are separate single-measure charts here.
   */
  const occupancyData = {
    labels,
    datasets: [
      {
        label: 'Occupancy',
        data: hotels.map((h) => h.a.occ),
        backgroundColor: t.series[0],
        ...BAR_MARK,
      },
    ],
  }

  const arrData = {
    labels,
    datasets: [
      {
        label: 'ARR',
        data: hotels.map((h) => h.a.arr),
        backgroundColor: t.series[1],
        ...BAR_MARK,
      },
    ],
  }

  const roomRevData = {
    labels,
    datasets: [
      { label: 'Actual', data: hotels.map((h) => toUnit(h.a.room, currency)), backgroundColor: t.series[0], ...BAR_MARK },
      { label: 'Budget', data: hotels.map((h) => toUnit(h.b.room, currency)), backgroundColor: t.series[1], ...BAR_MARK },
      { label: 'Last year', data: hotels.map((h) => toUnit(h.ly.room, currency)), backgroundColor: t.series[2], ...BAR_MARK },
    ],
  }

  const segments = mergeSegments(hotels)
  const segTotals = segments.reduce(
    (acc, seg) => {
      acc.rooms += seg.rooms
      acc.roomsPerDay += seg.roomsPerDay
      acc.rev += seg.rev
      return acc
    },
    { rooms: 0, roomsPerDay: 0, rev: 0 }
  )
  const segTotalArr = segTotals.rooms ? (segTotals.rev * 100000) / segTotals.rooms : 0
  const segTotalOcc = tA.inv ? (segTotals.roomsPerDay / tA.inv) * 100 : 0

  return (
    <section>
      <div className="kpis">
        <Kpi
          title="Room Revenue"
          value={fmt(tA.room)}
          budget={fmt(tB.room)}
          ly={fmt(tL.room)}
          delta={<Delta actual={tA.room} base={tB.room} />}
        />
        <Kpi title="Room Inventory" value={num(tA.inv)} />
        <Kpi title="Avg Occupancy" value={percent(rA.occ)} budget={percent(rB.occ)} ly={percent(rL.occ)} />
        <Kpi title="Avg ARR" value={rupees(rA.arr)} budget={rupees(rB.arr)} ly={rupees(rL.arr)} />
        <Kpi title="Avg RevPAR" value={rupees(rA.revpar)} budget={rupees(rB.revpar)} ly={rupees(rL.revpar)} />
      </div>

      <div className="charts">
        <ChartCard title="Occupancy by hotel" subtitle="Actual, % of room inventory">
          <Bar
            data={occupancyData}
            options={barOptions(tokens, {
              percent: true,
              max: 100,
              format: (v) => percent(v),
            })}
          />
        </ChartCard>
        <ChartCard title="ARR by hotel" subtitle="Actual average room rate">
          <Bar
            data={arrData}
            options={barOptions(tokens, {
              format: (v) => rupees(v),
              labelFormat: axisNumber,
            })}
          />
        </ChartCard>
      </div>

      <div className="charts">
        <ChartCard title="Room revenue" subtitle={`Actual vs budget vs last year, ${unitLabel(currency)}`}>
          <Bar
            data={roomRevData}
            options={barOptions(tokens, {
              showLegend: true,
              format: (v) => unitValue(v, currency),
              labelFormat: axisNumber,
            })}
          />
        </ChartCard>
      </div>

      <TableCard title="Room performance">
        <table>
          <thead>
            <tr>
              <th rowSpan={2}>Hotel</th>
              <th rowSpan={2} className="num">Inv</th>
              <th colSpan={3} className="num">Room revenue</th>
              <th colSpan={3} className="num">Occupancy %</th>
              <th colSpan={3} className="num">ARR</th>
              <th rowSpan={2} className="num">RevPAR</th>
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
                <td className="num">{h.inv}</td>
                <td className="num">{fmt(h.a.room)}</td>
                <td className="num muted">{fmt(h.b.room)}</td>
                <td className="num muted">{fmt(h.ly.room)}</td>
                <td className="num">{percent(h.a.occ)}</td>
                <td className="num muted">{percent(h.b.occ)}</td>
                <td className="num muted">{percent(h.ly.occ)}</td>
                <td className="num">{rupees(h.a.arr)}</td>
                <td className="num muted">{rupees(h.b.arr)}</td>
                <td className="num muted">{rupees(h.ly.arr)}</td>
                <td className="num">{rupees(h.a.revpar)}</td>
                <td className="num">
                  <Delta actual={h.a.room} base={h.b.room} />
                </td>
                <td className="num">
                  <Delta actual={h.a.room} base={h.ly.room} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>

      <TableCard title="Market segment performance" note="Rooms are room-nights for the selected period">
        <table>
          <thead>
            <tr>
              <th>Segment</th>
              <th className="num">Room nights</th>
              <th className="num">Occupancy %</th>
              <th className="num">ARR</th>
              <th className="num">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((seg) => (
              <tr key={seg.key}>
                <td>{seg.label}</td>
                <td className="num">{num(seg.rooms)}</td>
                <td className="num">{percent(seg.occ)}</td>
                <td className="num">{rupees(seg.arr)}</td>
                <td className="num">{fmt(seg.rev)}</td>
              </tr>
            ))}
            <tr className="total-row">
              <td>
                <b>TOTAL</b>
              </td>
              <td className="num">{num(segTotals.rooms)}</td>
              <td className="num">{percent(segTotalOcc)}</td>
              <td className="num">{rupees(segTotalArr)}</td>
              <td className="num">{fmt(segTotals.rev)}</td>
            </tr>
          </tbody>
        </table>
      </TableCard>
    </section>
  )
}
