// Anthropic API client wrapper
// Model: claude-sonnet-4-6 (verified 2026-06-16)
// NOTE: In production, route all calls through a Netlify Function proxy to shield the API key.
// Direct browser exposure is acceptable for personal/local use only.

const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY
const MODEL = 'claude-sonnet-4-6'

export async function callClaude({ systemPrompt, messages, maxTokens = 1024 }) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('Missing Anthropic API key. Check your .env file.')
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error?.message || `Anthropic API error: ${response.status}`)
  }

  const data = await response.json()
  return data.content[0].text
}
