// Single source of truth for which model family handles which AI workload.
//
// The client sends a *family* ('haiku' | 'sonnet'), not a pinned model ID.
// The ai-chat Edge Function resolves the family to the NEWEST available model
// in that family at request time (see db/functions/ai-chat/index.ts →
// resolveModel), so new Anthropic releases are adopted without a code change.
// Pinned fallbacks live in the Edge Function for when the Models API is
// unreachable.
//
// Routing rationale (see PR discussion): cheap classification → Haiku,
// reasoning → Sonnet. Opus is intentionally not used here.
// Text-only Haiku-class tasks that run on GPT-6 Luna instead whenever
// OPENAI_API_KEY is set (see luna.js). Callers pass one of these as `task`
// alongside `modelFamily`; with no key the route ignores it, so the Anthropic
// family still applies.
export const AI_TASKS = {
  suggestBuckets: 'suggest-buckets',
  suggestTabMatches: 'suggest-tab-matches',
}

export const AI_MODEL_FAMILIES = {
  groupMapping: 'haiku', // classification: import category → budget group
  assistant: 'sonnet', // reasoning: command bar + AI briefing
}
