// AI-assisted matching of budget categories to their detail worksheet tabs.
//
// When a user uploads a multi-tab budget workbook, each Non-Monthly category may
// have its own tab holding the real month-by-month amounts. Name-based matching
// catches the obvious cases; this asks the model to resolve the rest (synonyms,
// abbreviations, pluralization). Mirrors suggestBuckets — returns { matches } or
// { error } so callers can fall back to the manual selections.

import { invokeAIChatRaw } from './aiChatRaw.js'
import { AI_MODEL_FAMILIES } from './models.js'

// Returns { matches: [{ category, tab, confidence }] } or { error }.
// `tab` is always one of `tabNames` or null.
export async function suggestTabMatches(categories, tabNames) {
  if (!categories.length || !tabNames.length) return { matches: [] }

  const system = `You match budget category names to the worksheet tab that holds that category's detailed month-by-month breakdown.

Respond with ONLY a valid JSON object — no markdown, no code fences, no explanation:
{
  "matches": [
    { "category": "string", "tab": "string or null", "confidence": "high|medium|low" }
  ]
}

Rules:
- "tab" MUST be EXACTLY one of the provided tab names, or null when no tab plausibly matches.
- Every input category must appear exactly once in "matches".
- Match on meaning, not just spelling: handle synonyms, abbreviations (e.g. "Intl" = "International"), and plural/singular differences.
- Do not invent tabs. Do not match two categories to the same tab unless clearly correct.`

  const userMessage =
    `Categories:\n${categories.map(c => `- ${c}`).join('\n')}\n\n` +
    `Available tabs:\n${tabNames.map(t => `- ${t}`).join('\n')}`

  const { data, error } = await invokeAIChatRaw({
    system,
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: 1200,
    modelFamily: AI_MODEL_FAMILIES.groupMapping, // classification → newest Haiku
  })

  if (error || data?.error) {
    return { error: error?.message ?? data?.error ?? 'AI service unavailable' }
  }

  try {
    const raw = (data.text ?? '').replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim()
    const parsed = JSON.parse(raw)
    return { matches: Array.isArray(parsed.matches) ? parsed.matches : [] }
  } catch {
    return { error: 'AI returned unexpected format — keep the manual selections' }
  }
}
