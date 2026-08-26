import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { EmptyState, MultiSelect } from '../components/common'
import { MONTHS, monthYearLabel, monthYearLong } from '../lib/format'
import ExecutivePanel from '../panels/ExecutivePanel'
import RoomsPanel from '../panels/RoomsPanel'
import FnbPanel from '../panels/FnbPanel'
import CostsPanel from '../panels/CostsPanel'
import ComparePanel from '../panels/ComparePanel'
import TrendsPanel from '../panels/TrendsPanel'
import GrowthPanel from '../panels/GrowthPanel'

const TABS = [
  { id: 'exec', label: 'Executive' },
  { id: 'rooms', label: 'Rooms' },
  { id: 'fnb', label: 'F&B' },
  { id: 'costs', label: 'Costs' },
  { id: 'compare', label: 'Compare' },
  { id: 'trends', label: 'Trends' },
  { id: 'growth', label: 'Growth' },
]

export default function Dashboard({ currency }) {
  const [hotels, setHotels] = useState([])
  const [selected, setSelected] = useState([])
  const [periods, setPeriods] = useState([])
  const [fiscalYear, setFiscalYear] = useState('')
  const [month, setMonth] = useState(12)
  const [period, setPeriod] = useState('YTD')
  const [tab, setTab] = useState('exec')
  const [filtersOpen, setFiltersOpen] = useState(
    () => localStorage.getItem('hotel_dashboard_filters_open') !== 'false'
  )

  const toggleFilters = () => {
    setFiltersOpen((open) => {
      localStorage.setItem('hotel_dashboard_filters_open', String(!open))
      return !open
    })
  }

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Bootstrap: hotel list plus the periods that actually hold data.
  useEffect(() => {
    Promise.all([api.hotels(), api.periods()])
      .then(([hotelList, periodRes]) => {
        setHotels(hotelList)
        setSelected(hotelList.map((h) => h.code))
        const available = periodRes.periods || []
        setPeriods(available)
        if (available.length > 0) {
          const latest = available[0]
          setFiscalYear(latest.fiscal_year)
          setMonth(latest.months[latest.months.length - 1])
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!fiscalYear || selected.length === 0) {
      setData(null)
      return undefined
    }
    let cancelled = false
    setLoading(true)
    api
      .dashboard({
        fiscal_year: fiscalYear,
        month,
        period,
        hotels: selected.join(','),
      })
      .then((res) => {
        if (!cancelled) {
          setData(res)
          setError('')
        }
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
  }, [fiscalYear, month, period, selected])

  const monthOptions = useMemo(() => {
    const entry = periods.find((p) => p.fiscal_year === fiscalYear)
    const withData = new Set(entry?.months || [])
    return MONTHS.map((m) => ({ ...m, hasData: withData.has(m.value) }))
  }, [periods, fiscalYear])

  const hotelOptions = hotels.map((h) => ({ value: h.code, label: `${h.code} — ${h.name}` }))

  const hotelSummary =
    selected.length === hotels.length && hotels.length > 0
      ? `All hotels (${hotels.length})`
      : selected.length <= 3
        ? selected.join(', ') || 'None'
        : `${selected.length} of ${hotels.length} hotels`
  const filterSummary = [
    hotelSummary,
    monthYearLabel(month, fiscalYear),
    `FY ${fiscalYear}`,
    period === 'YTD' ? 'Year to date' : 'Monthly',
  ].join('  ·  ')
  const rows = data?.hotels || []

  return (
    <>
      <div className={`filters ${filtersOpen ? '' : 'collapsed'}`}>
        <div className="filters-bar">
          <button
            className="filters-toggle"
            onClick={toggleFilters}
            aria-expanded={filtersOpen}
            title={filtersOpen ? 'Hide filters' : 'Show filters'}
          >
            <span className="caret" aria-hidden="true">
              {filtersOpen ? '▾' : '▸'}
            </span>
            Filters
          </button>
          {!filtersOpen && <span className="filters-summary">{filterSummary}</span>}
        </div>

        <div className="filters-inner">
          <MultiSelect
            label="Hotels"
            options={hotelOptions}
            selected={selected}
            onChange={setSelected}
          />
          <div className="filter">
            <label>Month</label>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {monthOptions.map((m) => (
                <option key={m.value} value={m.value}>
                  {monthYearLabel(m.value, fiscalYear)}
                  {m.hasData ? '' : ' — no data'}
                </option>
              ))}
            </select>
          </div>
          <div className="filter">
            <label>Year</label>
            <select value={fiscalYear} onChange={(e) => setFiscalYear(e.target.value)}>
              {periods.length === 0 && <option value="">—</option>}
              {periods.map((p) => (
                <option key={p.fiscal_year} value={p.fiscal_year}>
                  FY {p.fiscal_year}
                </option>
              ))}
            </select>
          </div>
          <div className="filter">
            <label>Period</label>
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="MTD">Monthly</option>
              <option value="YTD">YTD</option>
            </select>
          </div>
        </div>
      </div>

      <main className="main">
        <nav className="tabs">
          {TABS.map((item) => (
            <button
              key={item.id}
              className={`tab ${tab === item.id ? 'active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {error && <div className="alert error">{error}</div>}

        {loading && !data && <div className="spinner-wrap">Loading…</div>}

        {!loading && periods.length === 0 && (
          <EmptyState title="No data has been uploaded yet">
            An administrator can add months from the Upload page.
          </EmptyState>
        )}

        {!loading && periods.length > 0 && selected.length === 0 && (
          <EmptyState title="No hotels selected">
            Choose at least one hotel from the Hotels filter above.
          </EmptyState>
        )}

        {!loading && periods.length > 0 && selected.length > 0 && rows.length === 0 && (
          <EmptyState title="Nothing recorded for this period">
            No data for {monthYearLong(month, fiscalYear)}. Pick another month,
            or upload it.
          </EmptyState>
        )}

        {rows.length > 0 && (
          /* Hold the previous render at reduced opacity while refetching,
             rather than flashing a skeleton and jumping the layout. */
          <div className={loading ? 'refetching' : undefined}>
            {tab === 'exec' && <ExecutivePanel hotels={rows} currency={currency} />}
            {tab === 'rooms' && <RoomsPanel hotels={rows} currency={currency} />}
            {tab === 'fnb' && <FnbPanel hotels={rows} currency={currency} />}
            {tab === 'costs' && <CostsPanel hotels={rows} currency={currency} />}
            {tab === 'compare' && <ComparePanel hotels={rows} currency={currency} />}
            {tab === 'trends' && (
              <TrendsPanel hotelCodes={selected} currency={currency} period={period} />
            )}
            {tab === 'growth' && (
              <GrowthPanel
                hotelCodes={selected}
                currency={currency}
                fiscalYear={fiscalYear}
                month={month}
              />
            )}
          </div>
        )}
      </main>
    </>
  )
}
