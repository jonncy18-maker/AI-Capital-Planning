import { invokeAIChatRaw } from './aiChatRaw.js'
import { buildGrillSystemPrompt } from './grillSession.prompts.js'

export async function sendGrillMessage({ messages, phase, targetYear, profile, commitments, priorBudgetGroups, spendingGroups }) {
  const systemPrompt = buildGrillSystemPrompt({ phase, targetYear, profile, commitments, priorBudgetGroups, spendingGroups })

  const { data, error } = await invokeAIChatRaw({
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    maxTokens: 1024,
  })

  if (error) throw error
  if (data?.error) throw new Error(data.error)

  return { content: data?.text ?? '' }
}
