// Single fetch seam for every src/lib/db/*.js function.
//
// Browser-safe by design — no Node-only imports here, since every db/*.js
// file (and therefore this one) is bundled into the client too. The default
// behavior is exactly what every call site did before this existed: a plain
// relative fetch with the Neon Auth session cookie.
//
// The MCP connector (the only server-side caller — see mcpContext.js) swaps
// this out per-request via setServerFetch(), so it can call the same
// /api/** routes with an absolute URL and a bearer token instead of a
// cookie. Nothing else ever calls setServerFetch().
let serverFetch = null

export function setServerFetch(fn) {
  serverFetch = fn
}

export function apiFetch(path, options = {}) {
  if (serverFetch) return serverFetch(path, options)
  return fetch(path, { ...options, credentials: 'include' })
}
