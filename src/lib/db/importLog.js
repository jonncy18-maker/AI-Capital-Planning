// Neon-backed client seam for import_logs, fronting app/api/import-logs/route.js
// (Neon Auth session cookie via credentials: 'include' — no token handling).
// `userId` params are kept for signature compatibility with existing callers
// (ImportFlow.jsx, Settings.jsx) even though the route derives the real
// identity from the session itself.

import { apiFetch } from './apiClient.js'

async function parseJsonOrThrow(res) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return body
}

export async function logImport(_userId, { filename, totalRows, inserted, skipped, unmappedCount }) {
  const res = await apiFetch('/api/import-logs', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      filename: filename ?? null,
      totalRows,
      inserted,
      skipped,
      unmappedCount: unmappedCount ?? 0,
    }),
  })
  return parseJsonOrThrow(res)
}

export async function getImportHistory(_userId) {
  const res = await apiFetch('/api/import-logs', { credentials: 'include' })
  const data = await parseJsonOrThrow(res)
  return data ?? []
}

async function undoRequest(body) {
  const res = await apiFetch('/api/transactions/import/undo', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`)
    err.status = res.status
    err.body = data
    throw err
  }
  return data
}

export function previewImportUndo(_userId, importId, { removeAutoMappings = false } = {}) {
  return undoRequest({ import_id: importId, mode: 'preview', remove_auto_mappings: removeAutoMappings })
}

export function commitImportUndo(_userId, importId, { expected, removeAutoMappings = false } = {}) {
  return undoRequest({
    import_id: importId, mode: 'commit', remove_auto_mappings: removeAutoMappings, expected,
  })
}
