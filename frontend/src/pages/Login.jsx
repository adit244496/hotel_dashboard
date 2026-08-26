import { useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { THEME_MODES, useTheme } from '../theme/ThemeContext'
import BrandMark from '../components/BrandMark'

const THEME_ICON = { auto: '◐', light: '☀', dark: '☾' }

const HIGHLIGHTS = [
  {
    title: 'Every property, one view',
    body: 'Room, F&B and cost performance across the portfolio, month or year to date.',
  },
  {
    title: 'Actual vs budget vs last year',
    body: 'Every figure sits beside its budget and prior year, with the variance worked out.',
  },
  {
    title: 'Two years of history',
    body: 'Workbooks are read, checked and kept, so trends build as you upload.',
  },
]

export default function Login() {
  const { signIn } = useAuth()
  const { mode, setMode } = useTheme()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await signIn(email.trim(), password)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
    // On success the app swaps this page out, so busy is left set.
  }

  return (
    <div className="auth">
      {/* Brand side: what this is, for someone landing on it cold. */}
      <aside className="auth-brand">
        <div className="auth-brand-inner">
          <div className="auth-logo">
            <BrandMark className="auth-mark" />
            <div>
              <div className="auth-logo-name">Hotel Performance</div>
              <div className="auth-logo-sub">Management Information System</div>
            </div>
          </div>

          <h2 className="auth-tagline">
            The monthly numbers for every hotel, in one place.
          </h2>

          <ul className="auth-points">
            {HIGHLIGHTS.map((item) => (
              <li key={item.title}>
                <span className="tick" aria-hidden="true">✓</span>
                <div>
                  <b>{item.title}</b>
                  <p>{item.body}</p>
                </div>
              </li>
            ))}
          </ul>

          <p className="auth-foot">Internal use · Access is granted by an administrator</p>
        </div>
      </aside>

      {/* Form side */}
      <main className="auth-form-side">
        <div className="auth-theme">
          <div className="segmented" role="group" aria-label="Colour theme">
            {THEME_MODES.map((item) => (
              <button
                key={item.value}
                type="button"
                className={mode === item.value ? 'active' : ''}
                onClick={() => setMode(item.value)}
                aria-pressed={mode === item.value}
                title={`${item.label} theme`}
              >
                <span aria-hidden="true">{THEME_ICON[item.value]}</span>
                <span className="theme-word">{item.label}</span>
              </button>
            ))}
          </div>
        </div>

        <form className="auth-card" onSubmit={submit}>
          <div className="auth-card-mark">
            <BrandMark className="auth-mark sm" />
          </div>

          <h1>Sign in</h1>
          <p className="auth-sub">Use the account your administrator set up for you.</p>

          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}

          <div className="field">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              placeholder="you@hotelgroup.in"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="input-affix">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="affix-btn"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <button className="btn wide lg" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="auth-help">
            Forgotten your password? An administrator can reset it for you from the
            Admin page.
          </p>
        </form>
      </main>
    </div>
  )
}
