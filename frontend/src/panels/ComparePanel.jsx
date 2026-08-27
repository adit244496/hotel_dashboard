import { Delta, TableCard } from '../components/common'
import { money, percent, ratio, rupees } from '../lib/format'

const ROWS = [
  { key: 'rev', label: 'Revenue', kind: 'money' },
  { key: 'ebitda', label: 'EBITDA', kind: 'money' },
  { key: 'occ', label: 'Occupancy', kind: 'percent' },
  { key: 'arr', label: 'ARR', kind: 'rupees' },
  { key: 'revpar', label: 'RevPAR', kind: 'rupees' },
]

export default function ComparePanel({ hotels, currency }) {
  const show = (value, kind) => {
    if (kind === 'money') return money(value, currency)
    if (kind === 'percent') return percent(value)
    return rupees(value)
  }

  const ebitdaPct = (block) => ratio(block.ebitda, block.rev) ?? 0

  return (
    <section>
      <div className="hotel-grid">
        {hotels.map((hotel) => (
          <div className="h-card" key={hotel.code}>
            <h3>
              <span className="code">{hotel.code}</span> · {hotel.name}
            </h3>
            <div className="h-card-body">
              {ROWS.map((row) => (
                <div className="h-row" key={row.key}>
                  <span className="h-lbl">{row.label}</span>
                  <div className="h-vals">
                    <span className="v-a">{show(hotel.a[row.key], row.kind)}</span>
                    <span className="v-b">B {show(hotel.b[row.key], row.kind)}</span>
                    <span className="v-l">LY {show(hotel.ly[row.key], row.kind)}</span>
                  </div>
                </div>
              ))}
              <div className="h-row">
                <span className="h-lbl">EBITDA margin</span>
                <div className="h-vals">
                  <span className="v-a">{percent(ebitdaPct(hotel.a))}</span>
                  <span className="v-b">B {percent(ebitdaPct(hotel.b))}</span>
                  <span className="v-l">LY {percent(ebitdaPct(hotel.ly))}</span>
                </div>
              </div>
              <div className="h-row">
                <span className="h-lbl">Revenue vs budget</span>
                <div className="h-vals">
                  <Delta actual={hotel.a.rev} base={hotel.b.rev} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 'var(--sp-4)' }}>
        <TableCard
          title="Comparison: actual vs budget vs last year"
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
                {[...ROWS, { key: 'ebitdaPct', label: 'EBITDA %' }].map((row) => (
                  <th key={row.key} colSpan={3} className="num">
                    {row.label}
                  </th>
                ))}
              </tr>
              <tr>
                {[...ROWS, { key: 'ebitdaPct' }].flatMap((row) => [
                  <th key={`${row.key}-a`} className="num">Act</th>,
                  <th key={`${row.key}-b`} className="num">Bud</th>,
                  <th key={`${row.key}-l`} className="num">LY</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {hotels.map((hotel) => (
                <tr key={hotel.code}>
                  <td>
                    <b>{hotel.code}</b>
                  </td>
                  {ROWS.flatMap((row) => [
                    <td key={`${row.key}-a`} className="num">{show(hotel.a[row.key], row.kind)}</td>,
                    <td key={`${row.key}-b`} className="num muted">{show(hotel.b[row.key], row.kind)}</td>,
                    <td key={`${row.key}-l`} className="num muted">{show(hotel.ly[row.key], row.kind)}</td>,
                  ])}
                  <td className="num">{percent(ebitdaPct(hotel.a))}</td>
                  <td className="num muted">{percent(ebitdaPct(hotel.b))}</td>
                  <td className="num muted">{percent(ebitdaPct(hotel.ly))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      </div>
    </section>
  )
}
