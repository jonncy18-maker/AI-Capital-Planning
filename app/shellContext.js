import { createContext, useContext } from 'react'

// Provided by app/layout.jsx (via AppRoot). Carries everything the module
// pages need that used to come from AppShell's closures: shared AI/data
// state, the profile + its save handler, and the module-switching function.
export const ShellContext = createContext(null)

export function useShell() {
  const ctx = useContext(ShellContext)
  if (!ctx) {
    throw new Error('useShell() must be called within the app shell provider (see app/layout.jsx / app/AppRoot.jsx)')
  }
  return ctx
}
