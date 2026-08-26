import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { Hint } from './common'
import { money } from '../lib/format'

const WINDOW_OPTIONS = [6, 12, 18, 24]

function fileSize(bytes) {
  if (!bytes) return ''
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

/**
 * Grid of which hotel/month workbooks are loaded.
 *
 * Rows are projects; columns run backwards from the current month so the newest
 * reporting period is always the first column after the name.
 */
export default function CoverageMatrix({ currency, onUploadFor, refreshKey }) {
  const [months, setMonths] = useState(12)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyCell, setBusyCell] = useState(null)
  const [tip, setTip] = useState(null)

  /**
   * Position the detail card against the badge.
   *
   * Rendered fixed at the component root rather than inside the cell, because
   * the table scrolls horizontally and would otherwise clip it.
   */
  const showTip = (event, row, column, cell) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const flip = rect.bottom + 190 > window.innerHeight
    setTip({
      cell,
      code: row.code,
      name: row.name,
      label: column.label,
      x: Math.min(Math.max(rect.left + rect.width / 2, 160), window.innerWidth - 160),
      y: flip ? rect.top - 8 : rect.bottom + 8,
      flip,
    })
  }

  const hideTip = () => setTip(null)

  const load = useCallback(() => {
    setLoading(true)
    api
      .coverage({ months })
      .then((res) => {
        setData(res)
        setError('')
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [months])

  useEffect(load, [load, refreshKey])

  // The card is positioned in viewport coordinates, so any scroll detaches it.
  useEffect(() => {
    if (!tip) return undefined
    const dismiss = () => setTip(null)
    window.addEventListener('scroll', dismiss, true)
    return () => window.removeEventListener('scroll', dismiss, true)
  }, [tip])

  const download = async (cell) => {
    setBusyCell(cell.upload_id)
    setError('')
    try {
      await api.downloadUpload(cell.upload_id, cell.original_filename)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyCell(null)
    }
  }

  const remove = async (row, column, cell) => {
    const confirmed = window.confirm(
      `Delete ${cell.original_filename}?\n\n` +
        `This removes ${row.code}'s figures for ${column.label} from the dashboard. ` +
        `You can upload a replacement afterwards.`
    )
    if (!confirmed) return
    setBusyCell(cell.upload_id)
    setError('')
    try {
      await api.discardUpload(cell.upload_id)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyCell(null)
    }
  }

  const columns = data?.columns || []
  const rows = data?.rows || []
  const loadedCount = rows.reduce(
    (sum, row) => sum + columns.filter((c) => row.cells[c.key]).length,
    0
  )

  return (
    <div className="panel-card">
      <div className="coverage-head">
        <div>
          <h2>Loaded files by project and month</h2>
          <p className="sub">
            One cell per hotel and month.
            <Hint>
              A loaded cell offers <b>download</b>, <b>replace</b> and{' '}
              <b>delete</b>; hover its badge for the file name, who uploaded it
              and when. An empty cell offers <b>+ Upload</b>, which points the
              form below at that hotel and month. Deleting also removes that
              month&apos;s figures from the dashboard.
            </Hint>
          </p>
        </div>
        <div className="filter">
          <label>Months shown</label>
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            {WINDOW_OPTIONS.map((count) => (
              <option key={count} value={count}>
                Last {count} months
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {loading && <div className="spinner-wrap">Loading coverage…</div>}

      {!loading && (
        <>
          <div className="tbl-wrap coverage-wrap">
            <table className="coverage">
              <thead>
                <tr>
                  <th className="sticky-col">Project</th>
                  {columns.map((column) => (
                    <th key={column.key} className={column.is_current ? 'current' : ''}>
                      {column.label}
                      {column.is_current && <span className="tag">now</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.hotel_id}>
                    <td className="sticky-col">
                      <b>{row.code}</b>
                      <div className="hotel-name">{row.name}</div>
                    </td>
                    {columns.map((column) => {
                      const cell = row.cells[column.key]
                      const busy = cell && busyCell === cell.upload_id
                      if (!cell) {
                        return (
                          <td key={column.key} className="cell-empty">
                            <button
                              className="btn small ghost"
                              onClick={() =>
                                onUploadFor({
                                  hotelId: row.hotel_id,
                                  fiscalYear: column.fiscal_year,
                                  month: column.month,
                                })
                              }
                            >
                              + Upload
                            </button>
                          </td>
                        )
                      }
                      return (
                        <td key={column.key} className="cell-filled">
                          <button
                            type="button"
                            className={`uploaded-badge ${
                              cell.warnings.length > 0 ? 'has-warnings' : ''
                            }`}
                            onMouseEnter={(e) => showTip(e, row, column, cell)}
                            onMouseLeave={hideTip}
                            onFocus={(e) => showTip(e, row, column, cell)}
                            onBlur={hideTip}
                          >
                            Uploaded
                          </button>
                          <div className="cell-actions">
                            <button
                              title={
                                cell.has_file
                                  ? 'Download this workbook'
                                  : 'The stored copy is no longer on disk'
                              }
                              disabled={busy || !cell.has_file}
                              onClick={() => download(cell)}
                            >
                              ↓
                            </button>
                            <button
                              title="Replace with a new file"
                              disabled={busy}
                              onClick={() =>
                                onUploadFor({
                                  hotelId: row.hotel_id,
                                  fiscalYear: column.fiscal_year,
                                  month: column.month,
                                })
                              }
                            >
                              ⟳
                            </button>
                            <button
                              className="danger"
                              title="Delete this file and its figures"
                              disabled={busy}
                              onClick={() => remove(row, column, cell)}
                            >
                              ✕
                            </button>
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="coverage-foot">
            {loadedCount} of {rows.length * columns.length} hotel-months loaded
          </div>
        </>
      )}

      {tip && (
        <div
          className={`hover-card ${tip.flip ? 'flip' : ''}`}
          style={{ left: tip.x, top: tip.y }}
        >
          <div className="hc-title">
            {tip.code} · {tip.label}
          </div>
          <div className="hc-file">{tip.cell.original_filename}</div>
          <dl className="hc-rows">
            <div>
              <dt>Uploaded</dt>
              <dd>{new Date(tip.cell.uploaded_at).toLocaleString()}</dd>
            </div>
            <div>
              <dt>By</dt>
              <dd>{tip.cell.uploaded_by_email || 'unknown'}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{tip.cell.status}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>
                {fileSize(tip.cell.file_size)}
                {tip.cell.parser ? ` · ${tip.cell.parser}` : ''}
              </dd>
            </div>
            {tip.cell.revenue ? (
              <div>
                <dt>Revenue</dt>
                <dd>{money(tip.cell.revenue, currency)}</dd>
              </div>
            ) : null}
          </dl>
          {tip.cell.warnings.length > 0 && (
            <div className="hc-warnings">
              <strong>
                {tip.cell.warnings.length} warning
                {tip.cell.warnings.length > 1 ? 's' : ''}
              </strong>
              <ul>
                {tip.cell.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
          {!tip.cell.has_file && (
            <div className="hc-warnings">
              <strong>The stored copy is no longer on disk — download unavailable.</strong>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
