// "Grill mode" — the conversational personalization interview. The AI plays an
// interviewer that probes what the user actually wants from their AI briefings,
// grounded in the real financial context (which invokeAIChat injects for us).
//
// Two phases:
//   1. runGrillTurn()        — one interviewer question/turn at a time.
//   2. synthesizePreferences() — fold the transcript into a structured prefs blob.
//
// Reusing invokeAIChat (and its cached context brief) means evolving the
// interview later is a prompt edit, not a rebuild.

import { invokeAIChat } from './sendMessage.js'
import { normalizePreferences } from './preferences.js'

const INTERVIEWER_INSTRUCTION = `You are now in PERSONALIZATION INTERVIEW mode ("grill me"). Your job is NOT to give advice or briefings right now — it is to interview the user so their future AI briefings can be tailored to what they actually care about.

How to run the interview:
- Open by briefly noting 1–2 concrete patterns you can see in their financial context above (e.g. a dominant spend group, income vs. expense shape, a large commitment, a savings-rate signal). Keep it to one short sentence, then ask your first question.
- Ask exactly ONE pointed question per turn. Make questions specific and grounded in their data — not generic ("What are your goals?"). Prefer questions like "Your dining spend runs ~30% of discretionary — do you want me to flag that every briefing, or is that a deliberate choice you'd rather I leave alone?"
- Probe for: what they want surfaced first, what they consider noise, their tolerance for blunt vs. encouraging tone, how much detail they want, their real planning priorities, and any framing they dislike.
- Adapt each follow-up to their last answer. Keep your turns short — one sentence of context at most, then the question.
- Aim for about 6 questions. Once you have enough to personalize, or the user signals they're done, STOP asking and reply with a single short confirmation line (no new question) that begins with "Got it —". Do not summarize a long list back to them; synthesis happens separately.

Format: plain prose, no markdown headers, no bullet lists. One question, then stop.`

const SYNTHESIS_INSTRUCTION = `The personalization interview is complete. Read the full conversation above and distill the user's stated preferences into a single JSON object describing how their AI briefings and AI-generated content should be framed.

Respond with ONLY the JSON object — no prose, no code fences. Use exactly this shape:
{
  "tone": "<one short phrase, e.g. 'direct and blunt' | 'encouraging' | 'analytical and neutral'>",
  "verbosity": "brief" | "standard" | "detailed",
  "priorities": ["<the things they most want the AI to focus on>"],
  "surface": ["<things to always call out proactively>"],
  "ignore": ["<things to de-emphasize or treat as noise>"],
  "notes": "<any other framing guidance in one or two sentences>"
}

Only include what the user actually expressed or clearly implied. Use empty arrays / empty strings where they said nothing relevant. Keep every entry concise.`

// One interviewer turn. `messages` is the running [{role, content}] thread.
// Returns the assistant's next question (or closing line) as text.
export async function runGrillTurn({ messages, context }) {
  const res = await invokeAIChat({
    messages,
    context,
    systemExtra: INTERVIEWER_INSTRUCTION,
    maxTokens: 400,
  })
  return res
}

// Fold the completed transcript into a structured preferences object.
export async function synthesizePreferences({ messages, context }) {
  const res = await invokeAIChat({
    messages: [
      ...messages,
      { role: 'user', content: 'Please synthesize my preferences now.' },
    ],
    context,
    systemExtra: SYNTHESIS_INSTRUCTION,
    maxTokens: 600,
  })
  if (res.status !== 'ok') return { status: 'error', text: res.text, preferences: null }

  const prefs = parsePreferences(res.text)
  if (!prefs) return { status: 'error', text: 'Could not parse the synthesized preferences.', preferences: null }
  return { status: 'ok', preferences: prefs }
}

// Strip code fences / stray prose and parse the first JSON object found.
function parsePreferences(text) {
  if (!text) return null
  let t = text.trim()
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    const obj = JSON.parse(t.slice(start, end + 1))
    return normalizePreferences(obj)
  } catch {
    return null
  }
}

// (preference shape helpers live in ./preferences.js to avoid an import cycle)
