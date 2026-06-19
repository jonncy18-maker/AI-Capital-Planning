// Pure helpers for the AI personalization preferences blob. No AI/network
// imports here so both the context loader (which renders prefs into the brief)
// and the grill interview (which produces them) can depend on it without a cycle.

export const VERBOSITY_OPTIONS = ['brief', 'standard', 'detailed']

function asArray(v) {
  if (Array.isArray(v)) return v.filter(Boolean).map(String)
  if (typeof v === 'string' && v.trim()) return [v.trim()]
  return []
}

export function normalizePreferences(obj = {}) {
  return {
    tone: typeof obj?.tone === 'string' ? obj.tone.trim() : '',
    verbosity: VERBOSITY_OPTIONS.includes(obj?.verbosity) ? obj.verbosity : 'standard',
    priorities: asArray(obj?.priorities),
    surface: asArray(obj?.surface),
    ignore: asArray(obj?.ignore),
    notes: typeof obj?.notes === 'string' ? obj.notes.trim() : '',
  }
}

// True when the user has set anything worth honoring.
export function hasPreferences(prefs) {
  if (!prefs) return false
  return !!(
    (prefs.tone && prefs.tone.length) ||
    (prefs.notes && prefs.notes.length) ||
    (prefs.priorities && prefs.priorities.length) ||
    (prefs.surface && prefs.surface.length) ||
    (prefs.ignore && prefs.ignore.length) ||
    (prefs.verbosity && prefs.verbosity !== 'standard')
  )
}

// Render the preferences as a system-prompt block the AI honors when briefing.
// Returns '' when there's nothing meaningful set, so the brief stays clean.
export function formatPreferencesForBrief(prefs) {
  if (!hasPreferences(prefs)) return ''
  const lines = ['## How To Brief This User (personalization)']
  if (prefs.tone) lines.push(`- Tone: ${prefs.tone}`)
  if (prefs.verbosity && prefs.verbosity !== 'standard') {
    lines.push(`- Length: keep responses ${prefs.verbosity === 'brief' ? 'short and high-signal' : 'thorough and detailed'}`)
  }
  if (prefs.priorities.length) lines.push(`- Prioritize: ${prefs.priorities.join('; ')}`)
  if (prefs.surface.length) lines.push(`- Always surface: ${prefs.surface.join('; ')}`)
  if (prefs.ignore.length) lines.push(`- De-emphasize / treat as noise: ${prefs.ignore.join('; ')}`)
  if (prefs.notes) lines.push(`- Other framing guidance: ${prefs.notes}`)
  lines.push('Honor these preferences in every briefing and AI-generated answer unless the user overrides them in the moment.')
  return lines.join('\n')
}
