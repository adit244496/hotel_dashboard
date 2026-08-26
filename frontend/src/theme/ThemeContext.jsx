import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'hotel_dashboard_theme'
const ThemeContext = createContext(null)

export const THEME_MODES = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

function systemPrefersDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

/**
 * Read the palette out of CSS custom properties.
 *
 * Charts are drawn on canvas, so they cannot inherit CSS. Sourcing their colors
 * from the same variables the rest of the page uses keeps one definition of the
 * palette rather than a JS copy that drifts.
 */
function readTokens() {
  const styles = getComputedStyle(document.documentElement)
  const get = (name) => styles.getPropertyValue(name).trim()
  return {
    surface: get('--surface'),
    ink: get('--ink'),
    ink2: get('--ink-2'),
    ink3: get('--ink-3'),
    grid: get('--grid'),
    axis: get('--axis'),
    series: [get('--s1'), get('--s2'), get('--s3')],
    good: get('--good'),
    critical: get('--critical'),
  }
}

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(
    () => localStorage.getItem(STORAGE_KEY) || 'auto'
  )
  const [resolved, setResolved] = useState('dark')
  const [tokens, setTokens] = useState(null)

  // Stamp the root element, which is what the CSS variables key off.
  useEffect(() => {
    const apply = () => {
      const next = mode === 'auto' ? (systemPrefersDark() ? 'dark' : 'light') : mode
      document.documentElement.setAttribute('data-theme', next)
      document.documentElement.style.colorScheme = next
      setResolved(next)
      // Let the new variables land before sampling them for the charts.
      requestAnimationFrame(() => setTokens(readTokens()))
    }
    apply()

    if (mode !== 'auto') return undefined
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [mode])

  const setMode = useCallback((next) => {
    localStorage.setItem(STORAGE_KEY, next)
    setModeState(next)
  }, [])

  const value = useMemo(
    () => ({ mode, setMode, resolved, tokens }),
    [mode, setMode, resolved, tokens]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
