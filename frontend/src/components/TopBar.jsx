import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { THEME_MODES, useTheme } from '../theme/ThemeContext'
import BrandMark from './BrandMark'

const THEME_ICON = { auto: '◐', light: '☀', dark: '☾' }

function initials(user) {
  const source = (user.full_name || user.email || '').trim()
  const parts = source.split(/[\s.@_-]+/).filter(Boolean)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || 'U'
}

/**
 * Account menu.
 *
 * Identity, theme and sign-out live here rather than on the bar itself — the
 * bar keeps only what is used while reading the dashboard.
 */
function AccountMenu() {
  const { user, signOut, isAdmin } = useAuth()
  const { mode, setMode } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onEsc = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('click', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  return (
    <div className="account" ref={ref}>
      <button
        className="avatar-btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={user.email}
      >
        <span className="avatar">{initials(user)}</span>
        <span className="chev" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">
            <span className="avatar lg">{initials(user)}</span>
            <div className="menu-id">
              <div className="menu-name">{user.full_name || user.email.split('@')[0]}</div>
              <div className="menu-mail">{user.email}</div>
            </div>
          </div>
          <div className="menu-meta">
            <span className={`role-badge ${isAdmin ? 'admin' : ''}`}>
              {isAdmin ? 'Administrator' : 'Viewer'}
            </span>
          </div>

          <div className="menu-sep" />
          <div className="menu-label">Appearance</div>
          <div className="menu-theme">
            {THEME_MODES.map((item) => (
              <button
                key={item.value}
                className={mode === item.value ? 'active' : ''}
                onClick={() => setMode(item.value)}
                aria-pressed={mode === item.value}
              >
                <span aria-hidden="true">{THEME_ICON[item.value]}</span>
                {item.label}
              </button>
            ))}
          </div>

          {isAdmin && (
            <>
              <div className="menu-sep" />
              <NavLink to="/admin" className="menu-item" onClick={() => setOpen(false)} role="menuitem">
                Settings &amp; users
              </NavLink>
            </>
          )}

          <div className="menu-sep" />
          <button className="menu-item danger" onClick={signOut} role="menuitem">
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

export default function TopBar({ currency, setCurrency, subtitle }) {
  const { isAdmin } = useAuth()

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <BrandMark />
          <div className="brand-text">
            <span className="brand-name">Hotel Performance</span>
            <span className="brand-sub">{subtitle}</span>
          </div>
        </div>

        <nav className="nav" aria-label="Sections">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
            Dashboard
          </NavLink>
          {isAdmin && (
            <>
              <NavLink to="/upload" className={({ isActive }) => (isActive ? 'active' : '')}>
                Upload
              </NavLink>
              <NavLink to="/admin" className={({ isActive }) => (isActive ? 'active' : '')}>
                Admin
              </NavLink>
            </>
          )}
        </nav>

        <div className="topbar-right">
          <div className="segmented compact" role="group" aria-label="Currency unit">
            <button
              className={currency === 'L' ? 'active' : ''}
              onClick={() => setCurrency('L')}
              aria-pressed={currency === 'L'}
              title="Show figures in lakhs"
            >
              ₹ L
            </button>
            <button
              className={currency === 'Cr' ? 'active' : ''}
              onClick={() => setCurrency('Cr')}
              aria-pressed={currency === 'Cr'}
              title="Show figures in crores"
            >
              ₹ Cr
            </button>
          </div>
          <AccountMenu />
        </div>
      </div>
    </header>
  )
}
