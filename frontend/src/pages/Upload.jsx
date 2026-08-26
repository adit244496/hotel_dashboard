import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { Alert } from '../components/common'
import CoverageMatrix from '../components/CoverageMatrix'
import { MONTHS, money, monthYearLabel, monthYearLong, num, percent, rupees } from '../lib/format'

const CURRENT_FY = (() => {
  const now = new Date()
  // April starts the Indian fiscal year.
  const startYear = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`
})()

function fiscalYearOptions(selected) {
  const start = Number(CURRENT_FY.split('-')[0])
  const options = [0, 1, 2].map((back) => {
    const year = start - back
    return `${year}-${String((year + 1) % 100).padStart(2, '0')}`
  })
  // Keep whatever is selected present, so targeting an older cell in the
  // coverage grid never leaves the control blank.
  if (selected && !options.includes(selected)) options.push(selected)
  return options.sort().reverse()
}

function MetricTable({ title, rows, currency }) {
  if (!rows || rows.length === 0) return null
  const show = (value, unit) => {
    if (value === null || value === undefined) return '-'
    if (unit === 'L') return money(value, currency)
    if (unit === '%') return percent(value)
    if (unit === 'Rs') return rupees(value)
    return num(value)
  }
  return (
    <div className="tbl-card">
      <div className="tbl-hdr">
        <h3>{title}</h3>
      </div>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Line item</th>
              <th className="num">Actual</th>
              <th className="num">Budget</th>
              <th className="num">Last Year</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>{row.label}</td>
                <td className="num">{show(row.act, row.unit)}</td>
                <td className="num">{show(row.bud, row.unit)}</td>
                <td className="num">{show(row.ly, row.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function Upload({ currency }) {
  const [hotels, setHotels] = useState([])
  const [hotelId, setHotelId] = useState('')
  const [fiscalYear, setFiscalYear] = useState(CURRENT_FY)
  const [month, setMonth] = useState(12)
  const [file, setFile] = useState(null)
  const [dragging, setDragging] = useState(false)

  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [history, setHistory] = useState([])
  // Bumped whenever data changes, to make the coverage grid refetch.
  const [refreshKey, setRefreshKey] = useState(0)
  const inputRef = useRef(null)
  const formRef = useRef(null)

  const loadHistory = useCallback(() => {
    api
      .uploads({ limit: 40 })
      .then(setHistory)
      .catch((err) => setError(err.message))
  }, [])

  /** Point the form at a specific cell of the coverage grid. */
  const targetCell = useCallback(({ hotelId: id, fiscalYear: fy, month: m }) => {
    setHotelId(String(id))
    setFiscalYear(fy)
    setMonth(m)
    setPreview(null)
    setError('')
    setSuccess('')
    setFile(null)
    if (inputRef.current) inputRef.current.value = ''
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  useEffect(() => {
    api
      .hotels()
      .then((list) => {
        setHotels(list)
        if (list.length > 0) setHotelId(String(list[0].id))
      })
      .catch((err) => setError(err.message))
    loadHistory()
  }, [loadHistory])

  const pickFile = (chosen) => {
    setFile(chosen)
    setPreview(null)
    setError('')
    setSuccess('')
  }

  const submit = async (event) => {
    event.preventDefault()
    if (!file || !hotelId) return
    setBusy(true)
    setError('')
    setSuccess('')
    setPreview(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('hotel_id', hotelId)
      form.append('fiscal_year', fiscalYear)
      form.append('month', String(month))
      setPreview(await api.upload(form))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await api.commitUpload(preview.upload_id)
      setSuccess(
        `Saved ${preview.hotel_code} for ${monthYearLong(preview.month, preview.fiscal_year)} ` +
          `(FY ${preview.fiscal_year}): ${res.periods} period rows, ${res.segments} segment rows, ` +
          `${res.outlets} outlet rows. The dashboard now reflects this file.`
      )
      setPreview(null)
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
      loadHistory()
      setRefreshKey((k) => k + 1)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const discard = async () => {
    setBusy(true)
    try {
      await api.discardUpload(preview.upload_id)
      setPreview(null)
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
      loadHistory()
      setRefreshKey((k) => k + 1)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="main">
      <CoverageMatrix
        currency={currency}
        onUploadFor={targetCell}
        refreshKey={refreshKey}
      />

      <div className="panel-card" ref={formRef}>
        <h2>Upload monthly MIS</h2>
        <p className="sub">
          Pick the hotel and the month the workbook reports on, then choose the file.
          Nothing is saved until you review the figures below and confirm — so a
          mis-selected month or hotel can be caught before it reaches the dashboard.
        </p>

        {error && <div className="alert error">{error}</div>}
        {success && <div className="alert ok">{success}</div>}

        <form onSubmit={submit}>
          <div className="form-row">
            <div className="filter">
              <label>Hotel / Project</label>
              <select value={hotelId} onChange={(e) => setHotelId(e.target.value)} required>
                {hotels.map((hotel) => (
                  <option key={hotel.id} value={hotel.id}>
                    {hotel.code} — {hotel.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter">
              <label>Fiscal Year</label>
              <select value={fiscalYear} onChange={(e) => setFiscalYear(e.target.value)}>
                {fiscalYearOptions(fiscalYear).map((fy) => (
                  <option key={fy} value={fy}>
                    FY {fy}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter">
              <label>Month</label>
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {MONTHS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {monthYearLabel(m.value, fiscalYear)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div
            className={`dropzone ${dragging ? 'active' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              if (e.dataTransfer.files?.[0]) pickFile(e.dataTransfer.files[0])
            }}
          >
            <div className="big">Drop the Excel workbook here, or click to browse</div>
            <div className="small">.xlsx or .xlsm, up to 40 MB</div>
            {file && <div className="file">{file.name}</div>}
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xlsm"
              style={{ display: 'none' }}
              onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])}
            />
          </div>

          <div className="actions-row">
            <button className="btn" type="submit" disabled={!file || busy}>
              {busy ? 'Reading workbook…' : 'Read & preview'}
            </button>
            {file && (
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  pickFile(null)
                  if (inputRef.current) inputRef.current.value = ''
                }}
                disabled={busy}
              >
                Clear
              </button>
            )}
          </div>
        </form>
      </div>

      {preview && (
        <div className="panel-card">
          <h2>Review before saving</h2>
          <p className="sub">
            These are the figures read from the file. Check them against the workbook,
            then confirm to publish them to the dashboard.
          </p>

          <div className="meta-list">
            <div>
              <span>Hotel:</span>
              <b>
                {preview.hotel_code} — {preview.hotel_name}
              </b>
            </div>
            <div>
              <span>Period:</span>
              <b>
                {monthYearLong(preview.month, preview.fiscal_year)} · FY {preview.fiscal_year}
              </b>
            </div>
            <div>
              <span>Format:</span>
              <b>{preview.parser_label}</b>
            </div>
            <div>
              <span>Segments:</span>
              <b>{preview.segment_count}</b>
            </div>
            <div>
              <span>Outlets:</span>
              <b>{preview.outlet_count}</b>
            </div>
          </div>

          {preview.replaces_existing && (
            <Alert kind="warn" title="This replaces existing data.">
              {preview.hotel_code} already has figures recorded for this month.
              Confirming will overwrite them with this file.
            </Alert>
          )}

          {preview.warnings.length > 0 && (
            <div className="alert warn">
              <strong>Check these before confirming:</strong>
              <ul>
                {preview.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="preview-grid">
            <MetricTable title="Month (MTD)" rows={preview.mtd} currency={currency} />
            <MetricTable title="Year to date (YTD)" rows={preview.ytd} currency={currency} />
          </div>

          <div className="actions-row">
            <button className="btn" onClick={confirm} disabled={busy}>
              {busy ? 'Saving…' : 'Confirm & save'}
            </button>
            <button className="btn ghost" onClick={discard} disabled={busy}>
              Discard
            </button>
          </div>
        </div>
      )}

      <div className="tbl-card">
        <div className="tbl-hdr">
          <h3>Upload history</h3>
          <span className="note">Most recent first</span>
        </div>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Hotel</th>
                <th>Period</th>
                <th>File</th>
                <th>Format</th>
                <th>Status</th>
                <th>Uploaded by</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {history.map((item) => (
                <tr key={item.id}>
                  <td>
                    <b>{item.hotel_code}</b>
                  </td>
                  <td>
                    {monthYearLong(item.month, item.fiscal_year)}
                  </td>
                  <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.original_filename}
                  </td>
                  <td>{item.parser || '—'}</td>
                  <td>
                    <span className={`status-pill status-${item.status}`}>{item.status}</span>
                  </td>
                  <td>{item.uploaded_by_email || '—'}</td>
                  <td>{new Date(item.uploaded_at).toLocaleString()}</td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: 'var(--txt3)', padding: '1rem' }}>
                    Nothing uploaded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  )
}
