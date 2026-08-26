import { useEffect, useRef, useState } from 'react'
import { variance } from '../lib/format'

/**
 * Variance chip.
 *
 * The arrow carries direction, so the meaning never rests on colour alone.
 */
export function Delta({ actual, base, suffix = '%' }) {
  if (!base) return <span className="delta flat">—</span>
  const value = Number(variance(actual, base))
  const kind = value > 0.05 ? 'up' : value < -0.05 ? 'down' : 'flat'
  const arrow = kind === 'up' ? '▲' : kind === 'down' ? '▼' : '—'
  return (
    <span className={`delta ${kind}`}>
      <span aria-hidden="true">{arrow}</span>
      {Math.abs(value).toFixed(1)}
      {suffix}
    </span>
  )
}

export function Kpi({ title, value, budget, ly, delta }) {
  return (
    <div className="kpi">
      <div className="kpi-title">{title}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-row">
        {budget !== undefined && (
          <span>
            <span className="lbl">Bud</span>
            {budget}
          </span>
        )}
        {ly !== undefined && (
          <span>
            <span className="lbl">LY</span>
            {ly}
          </span>
        )}
        {delta}
      </div>
    </div>
  )
}

export function ChartCard({ title, subtitle, children, tall = false }) {
  return (
    <div className="chart-card">
      <div className="chart-title">{title}</div>
      {subtitle && <div className="chart-sub">{subtitle}</div>}
      <div className={tall ? 'chart-box tall' : 'chart-box'}>{children}</div>
    </div>
  )
}

export function TableCard({ title, note, children }) {
  return (
    <div className="tbl-card">
      <div className="tbl-hdr">
        <h3>{title}</h3>
        {note && <span className="note">{note}</span>}
      </div>
      <div className="tbl-wrap">{children}</div>
    </div>
  )
}

/** Multi-select dropdown for the hotel filter. */
export function MultiSelect({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDocClick = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [open])

  const allSelected = selected.length === options.length && options.length > 0

  const text = (() => {
    if (selected.length === 0) return 'None selected'
    if (allSelected) return `All hotels (${options.length})`
    if (selected.length <= 3) return selected.join(', ')
    return `${selected.length} of ${options.length} selected`
  })()

  const toggle = (value) => {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value]
    )
  }

  return (
    <div className="filter">
      <label>{label}</label>
      <div className="multi-select" ref={ref}>
        <div
          className="multi-btn"
          role="button"
          tabIndex={0}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setOpen((v) => !v)
            }
          }}
        >
          <span>{text}</span>
          <span className="chev">▼</span>
        </div>
        {open && (
          <div className="multi-drop">
            <label className="multi-item all">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) => onChange(e.target.checked ? options.map((o) => o.value) : [])}
              />
              Select all
            </label>
            {options.map((option) => (
              <label className="multi-item" key={option.value}>
                <input
                  type="checkbox"
                  checked={selected.includes(option.value)}
                  onChange={() => toggle(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function Alert({ kind = 'info', title, children }) {
  return (
    <div className={`alert ${kind}`}>
      {title && <strong>{title}</strong>}
      {title && children ? ' ' : null}
      {children}
    </div>
  )
}

export function EmptyState({ title, children }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  )
}
