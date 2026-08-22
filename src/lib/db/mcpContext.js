// Server-only. Imported exclusively by app/api/mcp/route.js — never reachable
// from the browser bundle, which is why the node:async_hooks import lives
// here and not in apiClient.js (webpack refuses to bundle Node built-ins
// into client code, and every db/*.js file — hence apiClient.js — is used
// client-side too).
//
// Wires a single stable fetch implementation into apiClient.js that looks up
// the current request's token via AsyncLocalStorage. That's what makes this
// safe under concurrent requests on a warm serverless instance: the
// implementation itself never changes, only the per-request store it reads
// from, and AsyncLocalStorage keeps that store scoped to its own async chain.
import { AsyncLocalStorage } from 'node:async_hooks'
import { setServerFetch } from './apiClient.js'

const mcpAuthContext = new AsyncLocalStorage()

function getAppBaseUrl() {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL
  // VERCEL_URL is the per-deployment hostname, which sits behind Vercel
  // Authentication (SSO protection) whenever it's enabled for anything but
  // custom domains — exactly this project's setting. A self-fetch to that
  // URL gets bounced by Vercel's own auth wall before it ever reaches this
  // app, silently producing empty-looking data. VERCEL_PROJECT_PRODUCTION_URL
  // is the assigned production domain (here, the exempt ai-capital-planning
  // .vercel.app alias) and isn't behind that wall.
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

setServerFetch((path, options = {}) => {
  const ctx = mcpAuthContext.getStore()
  if (!ctx) throw new Error('apiFetch called server-side outside an MCP request context.')
  return fetch(`${getAppBaseUrl()}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), authorization: `Bearer ${ctx.token}` },
  })
})

// Runs `fn` with every apiFetch() call inside it authenticated as `token`.
export function runAsToken(token, fn) {
  return mcpAuthContext.run({ token }, fn)
}
