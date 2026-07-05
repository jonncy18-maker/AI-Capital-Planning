import { invokeAIChatRaw } from './aiChatRaw.js'
import { buildGrillSystemPrompt } from './grillSession.prompts.js'

export async function sendGrillMessage({ messages, phase, targetYear, profile, commitments, priorBudgetGroups, spendingGroups }) {
  const systemPrompt = buildGrillSystemPrompt({ phase, targetYear, profile, commitments, priorBudgetGroups, spendingGroups })

  // The interview opens with an empty history — the assistant is meant to ask
  // the first question, driven by the system prompt. Anthropic (and /api/ai-chat,
  // matching the old Supabase edge function) require >=1 message, so seed a
  // minimal kickoff user turn when there's no history yet. Without this the
  // opening call 400s — which is why the grill's first question never loaded
  // ("Having trouble connecting"), a latent bug predating this migration.
  const convo = messages.length
    ? messages.map(m => ({ role: m.role, content: m.content }))
    : [{ role: 'user', content: "Let's begin." }]

  const { data, error } = await invokeAIChatRaw({
    system: systemPrompt,
    messages: convo,
    maxTokens: 1024,
  })

  if (error) throw error
  if (data?.error) throw new Error(data.error)

  return { content: data?.text ?? '' }
}
