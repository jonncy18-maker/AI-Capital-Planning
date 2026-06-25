// AI-powered category → bucket suggestion.
//
// Takes a list of unmapped category names and a compact profile built by
// categoryProfiler, then calls the ai-chat Edge Function with a focused
// prompt. Returns pre-filled group/type suggestions and (optionally) a
// short list of targeted clarifying questions for genuinely ambiguous categories.
//
// Falls back gracefully — callers should handle { error } responses by
// proceeding with the default Uncategorized mappings.

import { supabase } from '../supabase.js'
import { ALL_GROUPS } from '../csv/categoryMap.js'
import { AI_MODEL_FAMILIES } from './models.js'
import { buildBucketSystemPrompt } from './suggestBuckets.prompts.js'

// Returns:
//   { suggestions: [{ category, group, type, confidence, note }], questions: [...] }
// or on failure:
//   { error: string }
//
// `groups` is the user's own budget groups (their flexible buckets). The AI maps
// into these and may propose a new one only when nothing fits. Falls back to the
// built-in defaults for a brand-new user with no groups yet.
export async function suggestBuckets(unmappedCats, profile, groups) {
  const groupList = groups && groups.length ? groups : ALL_GROUPS
  const unmappedSet = new Set(unmappedCats)
  const profiled = profile.categories.filter(c => unmappedSet.has(c.category))

  const profileLines = profiled.map(c => {
    const merchants = c.topMerchants.length ? ` [e.g. ${c.topMerchants.join(', ')}]` : ''
    return (
      `- "${c.category}"${merchants}: ` +
      `$${c.monthlyAvg}/mo avg, ${c.frequencyPct}% of months, ` +
      `${c.inferredType} pattern, ${c.shareOfSpend}% of total spend`
    )
  }).join('\n')

  const system = buildBucketSystemPrompt(groupList)

  const userMessage =
    `Assign these ${unmappedCats.length} categories from a Monarch Money export ` +
    `(${profile.spanMonths}-month transaction history):\n\n${profileLines}`

  const { data, error } = await supabase.functions.invoke('ai-chat', {
    body: {
      system,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 1500,
      modelFamily: AI_MODEL_FAMILIES.groupMapping, // classification → newest Haiku
    },
  })

  if (error || data?.error) {
    return { error: error?.message ?? data?.error ?? 'AI service unavailable' }
  }

  try {
    // Strip any accidental markdown fences before parsing
    const raw = (data.text ?? '').replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim()
    const parsed = JSON.parse(raw)
    return {
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      questions: Array.isArray(parsed.questions) ? parsed.questions : [],
    }
  } catch {
    return { error: 'AI returned unexpected format — using manual mapping fallback' }
  }
}
