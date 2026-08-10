// A record of every write the assistant has made, so a change can be found and
// reversed after the chat thread has moved on.
//
// Stored in localStorage per user rather than in Neon: it is a UI convenience
// on top of data that already lives in the database, and keeping it client-side
// means no schema migration and no extra write on the critical path. Entries
// are capped and pruned by age — this is a recent-activity trail, not an audit
// database.

const KEY_PREFIX = 'aicp.aiActionLog.'
const MAX_ENTRIES = 60
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30

function key(userId) {
  return `${KEY_PREFIX}${userId ?? 'anon'}`
}

function read(userId) {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(key(userId))
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    const cutoff = Date.now() - MAX_AGE_MS
    return parsed.filter(e => e && typeof e.at === 'number' && e.at >= cutoff)
  } catch {
    return []
  }
}

function write(userId, entries) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key(userId), JSON.stringify(entries.slice(0, MAX_ENTRIES)))
  } catch {
    // A full or unavailable localStorage must never break a write the user
    // already confirmed — the data itself is safely in Neon either way.
  }
}

export function getActionLog(userId) {
  return read(userId)
}

// `actions` come straight off a confirmed turn: { tool, group, summary, undo }.
export function recordActions(userId, actions = []) {
  if (!actions.length) return read(userId)
  const now = Date.now()
  const entries = actions.map((a, i) => ({
    id: `${now}-${i}`,
    at: now,
    tool: a.tool,
    group: a.group ?? '',
    summary: a.summary ?? a.tool,
    undo: a.undo ?? null,
    undone: false,
  }))
  const next = [...entries, ...read(userId)]
  write(userId, next)
  return next
}

export function markUndone(userId, id) {
  const next = read(userId).map(e => (e.id === id ? { ...e, undone: true, undo: null } : e))
  write(userId, next)
  return next
}

export function clearActionLog(userId) {
  write(userId, [])
  return []
}
