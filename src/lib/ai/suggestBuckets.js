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

  const system = `You are a financial data assistant. Assign each spending category to a budget group and expense type.

The user's existing budget groups (strongly prefer these — use EXACTLY as written): ${groupList.join(', ')}
You MAY propose a new concise Title Case group only when a category genuinely fits none of the above.
Valid types: Fixed, Flexible, Non-Monthly

Definitions:
- Fixed = consistent amount every month (rent, subscriptions, loan payments)
- Flexible = amount varies month to month (groceries, gas, dining out)
- Non-Monthly = seasonal or occasional (travel, insurance premiums, gifts, annual fees)

Respond with ONLY a valid JSON object — no markdown, no code fences, no explanation before or after:
{
  "suggestions": [
    { "category": "string", "group": "string", "type": "string", "confidence": "high|medium|low", "note": "string or null" }
  ],
  "questions": [
    { "category": "string", "question": "string", "options": ["GroupName1", "GroupName2", "GroupName3"] }
  ]
}

Rules:
- Every category in the input must appear in suggestions.
- Add a question ONLY when the data is truly ambiguous and the group cannot be inferred (e.g. "Zelle" could be rent, family support, or bill-splitting). Max 3 questions.
- Question options must be valid group names from the list above.
- The note field is for low/medium confidence entries — one short sentence explaining the uncertainty, or null.`

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
