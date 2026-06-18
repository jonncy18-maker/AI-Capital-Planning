// Single source of truth for which model family handles which AI workload.
//
// The client sends a *family* ('haiku' | 'sonnet'), not a pinned model ID.
// The ai-chat Edge Function resolves the family to the NEWEST available model
// in that family at request time (see supabase/functions/ai-chat/index.ts →
// resolveModel), so new Anthropic releases are adopted without a code change.
// Pinned fallbacks live in the Edge Function for when the Models API is
// unreachable.
//
// Routing rationale (see PR discussion): cheap classification → Haiku,
// reasoning → Sonnet. Opus is intentionally not used here.
export const AI_MODEL_FAMILIES = {
  groupMapping: 'haiku', // classification: import category → budget group
  assistant: 'sonnet',   // reasoning: command bar + AI briefing
}
