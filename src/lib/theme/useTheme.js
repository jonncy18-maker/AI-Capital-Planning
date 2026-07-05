import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'acp-theme'

// Persistent dark/light theme. Sets data-theme on <html> (token CSS keys off it)
// and remembers the choice across sessions.
export function useTheme() {
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'dark'
    // Prefer the attribute the pre-hydration inline script (app/layout.jsx)
    // already set from localStorage — this keeps React state in lock-step with
    // the DOM the user actually sees, so the toggle isn't one step stale and a
    // saved theme isn't clobbered on mount. Fall back to localStorage directly.
    const attr = document.documentElement.getAttribute('data-theme')
    if (attr === 'light' || attr === 'dark') return attr
    try {
      return localStorage.getItem(STORAGE_KEY) || 'dark'
    } catch {
      return 'dark'
    }
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // ignore storage failures (private mode, etc.)
    }
    // TEMP theme diagnostic — remove once toggle is confirmed working.
    console.log('[theme] effect applied →', theme, '| html data-theme =', document.documentElement.getAttribute('data-theme'), '| localStorage =', (() => { try { return localStorage.getItem(STORAGE_KEY) } catch { return 'n/a' } })())
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme(t => {
      const next = t === 'dark' ? 'light' : 'dark'
      // TEMP theme diagnostic — remove once toggle is confirmed working.
      console.log('[theme] toggle clicked:', t, '→', next)
      return next
    })
  }, [])

  return { theme, toggleTheme }
}
