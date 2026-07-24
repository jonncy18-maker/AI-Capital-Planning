// AI scenario agent — lets the assistant actually CREATE a scenario (instead of
// only describing the steps), via Anthropic tool use. The tool loop runs in the
// browser: the model returns a create_scenario tool call, we execute it against
// the database scoped to the user's session, return a tool_result, and continue
// until the model produces its final summary. This mirrors how the rest of the
// app does its DB writes client-side.
//
// Preview flow: on the FIRST create_scenario tool call, the agent pauses and
// returns { status: 'pending', pending: { ... } } instead of writing to the DB.
// The caller shows a preview card. confirmPendingScenario() executes the write
// and continues the loop; cancelPendingScenario() sends an error tool_result so
// the AI acknowledges the cancellation.

import { invokeAIChat } from './sendMessage.js'
import { createScenario, addAdjustment } from '../db/scenarios.js'
import { getBudgetCategories, upsertCategory } from '../db/budgetCategories.js'
import { buildScenarioSystemExtra, buildAdjustmentSystemExtra } from './scenarioAgent.prompts.js'

// A single create_scenario / add_adjustment tool call can legitimately span many
// category-months (e.g. a multi-year lease correction: new payment + old-lease
// overlap + FSD + one-time fees across several months and years). Emitted as
// tool JSON that easily exceeds 1.5k tokens, so the ceiling must be generous or
// Anthropic truncates the tool call (stop_reason 'max_tokens'), which previously
// surfaced as a silent blank bubble. Kept well under Sonnet's output limit.
const AGENT_MAX_TOKENS = 8000

// Shown when a tool call is truncated despite the raised ceiling — a real,
// explainable outcome instead of an empty message.
const TRUNCATION_MSG =
  'That scenario was too large to build in one step. Try splitting it into ' +
  'smaller pieces — for example model the new lease payment first, then add the ' +
  'FSD subscription and the one-time delivery/down-payment costs as a follow-up.'

export const CREATE_SCENARIO_TOOL = {
  name: 'create_scenario',
  description:
    'Create a planning scenario as a set of month-by-month adjustments to the budget. ' +
    'Each adjustment is a SIGNED DELTA versus the currently budgeted amount for that ' +
    'category in that month (e.g. if a line was budgeted $467/mo and the new plan is ' +
    '$649/mo, the delta is +182; a saving is negative). Target existing budget category ' +
    'names when they fit; otherwise propose a clear new category name (a new bucket will ' +
    'be created). Spread recurring changes across each affected month/year. Use this when ' +
    'the user asks you to run, model, or build a concrete scenario.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short scenario name, e.g. "Tesla Model Y lease".' },
      description: { type: 'string', description: 'One or two sentences describing the change and its assumptions.' },
      adjustments: {
        type: 'array',
        description: 'One row per affected category-month.',
        items: {
          type: 'object',
          properties: {
            category: { type: 'string', description: 'Budget category to adjust (existing name preferred).' },
            group: { type: 'string', description: 'Group to use if this category must be created (optional).' },
            type: { type: 'string', enum: ['Fixed', 'Flexible', 'Non-Monthly'], description: 'Type if a new category must be created (optional).' },
            year: { type: 'integer', description: 'Four-digit year, e.g. 2026.' },
            month: { type: 'integer', minimum: 1, maximum: 12, description: '1=Jan … 12=Dec.' },
            delta_amount: { type: 'number', description: 'Signed change vs the budgeted amount for that month.' },
            label: { type: 'string', description: 'Optional note for this row.' },
          },
          required: ['category', 'year', 'month', 'delta_amount'],
        },
      },
    },
    required: ['name', 'adjustments'],
  },
}

function resolveCategoryId(cats, name) {
  if (!name) return null
  const lc = name.trim().toLowerCase()
  const exact = cats.find(c => (c.category || '').toLowerCase() === lc)
  if (exact) return exact.id
  const fuzzy = cats.find(c => {
    const cn = (c.category || '').toLowerCase()
    if (cn.length < 4 || lc.length < 4) return false
    return cn.includes(lc) || lc.includes(cn)
  })
  return fuzzy ? fuzzy.id : null
}

async function executeCreateScenario(userId, input) {
  const adjustments = Array.isArray(input?.adjustments) ? input.adjustments : []
  if (!adjustments.length) throw new Error('No adjustments were provided.')

  let cats = await getBudgetCategories(userId)

  const missing = new Map()
  for (const a of adjustments) {
    if (!resolveCategoryId(cats, a.category)) {
      const key = (a.category || '').trim().toLowerCase()
      if (key && !missing.has(key)) missing.set(key, a)
    }
  }
  if (missing.size) {
    for (const a of missing.values()) {
      await upsertCategory(userId, {
        category: a.category.trim(),
        group: a.group || 'Uncategorized',
        type: a.type || 'Flexible',
      })
    }
    cats = await getBudgetCategories(userId)
  }

  const scenario = await createScenario(userId, {
    name: input.name || 'New scenario',
    description: input.description || '',
  })

  const thisYear = new Date().getFullYear()
  let written = 0
  let netDelta = 0
  for (const a of adjustments) {
    const categoryId = resolveCategoryId(cats, a.category)
    if (!categoryId) continue
    const month = Math.min(12, Math.max(1, Math.round(Number(a.month) || 1)))
    const year = Math.round(Number(a.year) || thisYear)
    const delta = Number(a.delta_amount) || 0
    await addAdjustment(userId, scenario.id, {
      category_id: categoryId, month, year, delta_amount: delta, label: a.label || input.name || '',
    })
    written += 1
    netDelta += delta
  }

  return { scenarioId: scenario.id, name: scenario.name, adjustmentCount: written, netDelta }
}

// Build a human-readable preview of what create_scenario would do, without
// touching the DB. Used to populate the confirmation card in the chat.
function buildPreview(input) {
  const thisYear = new Date().getFullYear()
  const adjustments = (input?.adjustments ?? []).map(a => ({
    category: a.category || '',
    year: Math.round(Number(a.year) || thisYear),
    month: Math.min(12, Math.max(1, Math.round(Number(a.month) || 1))),
    delta_amount: Number(a.delta_amount) || 0,
    label: a.label || '',
  }))
  const netDelta = adjustments.reduce((sum, a) => sum + a.delta_amount, 0)
  return {
    name: input?.name || 'New scenario',
    description: input?.description || '',
    adjustments,
    adjustmentCount: adjustments.length,
    netDelta,
  }
}

// Continue the tool loop from an already-built messages array (post tool_results).
// Executes any create_scenario calls directly — no second pause. Used by both
// confirmPendingScenario (after the user approves) and for unknown-tool branches.
async function continueFromMessages({ messages, context, yearTxns, systemExtra, userId, created, onStatus }) {
  let msgs = messages
  for (let step = 0; step < 4; step++) {
    const res = await invokeAIChat({ messages: msgs, tools: [CREATE_SCENARIO_TOOL], context, yearTxns, systemExtra, maxTokens: AGENT_MAX_TOKENS })
    if (res.status !== 'ok') return { status: res.status, text: res.text, created }

    if (res.stop_reason === 'max_tokens') {
      return { status: 'error', text: TRUNCATION_MSG, created }
    }

    msgs = [...msgs, { role: 'assistant', content: res.content }]

    if (res.stop_reason !== 'tool_use') {
      return { status: 'ok', text: res.text || 'Done.', created }
    }

    const toolResults = []
    for (const block of res.content) {
      if (block.type !== 'tool_use') continue
      if (block.name !== 'create_scenario') {
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ ok: false, error: `Unknown tool: ${block.name}` }), is_error: true })
        continue
      }
      onStatus?.(`Building "${block.input?.name || 'scenario'}" …`)
      try {
        const summary = await executeCreateScenario(userId, block.input)
        created.push(summary)
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ ok: true, ...summary }) })
      } catch (e) {
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ ok: false, error: e.message }), is_error: true })
      }
    }
    msgs = [...msgs, { role: 'user', content: toolResults }]
  }

  return { status: 'ok', text: 'Stopped after several steps — the scenario may be partially built. Check the Scenario Planner.', created }
}

// Run one turn of the conversation. On the first create_scenario tool call,
// returns { status: 'pending', pending } instead of writing to the DB so the
// caller can show a confirmation UI before any data is persisted.
export async function runScenarioAgent({ userId, history = [], prompt, context, yearTxns, onStatus }) {
  const categoryNames = (context?.categories ?? [])
    .map(c => c.category)
    .filter(Boolean)
  const systemExtra = buildScenarioSystemExtra(categoryNames)

  const messages = [
    ...history.filter(m => m.content).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: prompt },
  ]

  const res = await invokeAIChat({ messages, tools: [CREATE_SCENARIO_TOOL], context, yearTxns, systemExtra, maxTokens: AGENT_MAX_TOKENS })
  if (res.status !== 'ok') return { status: res.status, text: res.text, created: [] }

  // A truncated tool call comes back as 'max_tokens' with no text — surface the
  // reason instead of an empty bubble.
  if (res.stop_reason === 'max_tokens') {
    return { status: 'error', text: TRUNCATION_MSG, created: [] }
  }

  const messagesWithAI = [...messages, { role: 'assistant', content: res.content }]

  if (res.stop_reason !== 'tool_use') {
    return { status: 'ok', text: res.text || "I couldn't produce a concrete change for that — could you rephrase or add a bit more detail?", created: [] }
  }

  const createBlock = res.content.find(b => b.type === 'tool_use' && b.name === 'create_scenario')

  if (createBlock) {
    // Pause before writing — return pending state for the caller to confirm.
    return {
      status: 'pending',
      text: '',
      created: [],
      pending: {
        messagesWithAI,
        allToolBlocks: res.content.filter(b => b.type === 'tool_use'),
        preview: buildPreview(createBlock.input),
        systemExtra,
      },
    }
  }

  // tool_use but no create_scenario — handle unknown tools and continue
  const toolResults = res.content
    .filter(b => b.type === 'tool_use')
    .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify({ ok: false, error: `Unknown tool: ${b.name}` }), is_error: true }))

  const messagesWithResults = [...messagesWithAI, { role: 'user', content: toolResults }]
  return continueFromMessages({ messages: messagesWithResults, context, yearTxns, systemExtra, userId, created: [], onStatus })
}

// Execute the pending scenario after user confirmation, then continue the loop
// to get the AI's final summary text.
export async function confirmPendingScenario({ userId, pending, context, yearTxns, onStatus }) {
  const { messagesWithAI, allToolBlocks, systemExtra } = pending
  const created = []

  const toolResults = []
  for (const block of allToolBlocks) {
    if (block.name !== 'create_scenario') {
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ ok: false, error: `Unknown tool: ${block.name}` }), is_error: true })
      continue
    }
    onStatus?.(`Building "${block.input?.name || 'scenario'}" …`)
    try {
      const summary = await executeCreateScenario(userId, block.input)
      created.push(summary)
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ ok: true, ...summary }) })
    } catch (e) {
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ ok: false, error: e.message }), is_error: true })
    }
  }

  const messagesWithResults = [...messagesWithAI, { role: 'user', content: toolResults }]
  return continueFromMessages({ messages: messagesWithResults, context, yearTxns, systemExtra, userId, created, onStatus })
}

// Send an error tool_result for each block so the AI acknowledges cancellation,
// then do a single follow-up call (no tools) to get the acknowledgement text.
export async function cancelPendingScenario({ pending, context, yearTxns }) {
  const { messagesWithAI, allToolBlocks, systemExtra } = pending

  const toolResults = allToolBlocks.map(block => ({
    type: 'tool_result',
    tool_use_id: block.id,
    content: JSON.stringify({ ok: false, error: 'User cancelled before saving.' }),
    is_error: true,
  }))

  const messagesWithResults = [...messagesWithAI, { role: 'user', content: toolResults }]
  // No tools on the follow-up so the AI is forced to respond with text only.
  const res = await invokeAIChat({ messages: messagesWithResults, context, yearTxns, systemExtra, maxTokens: 512 })
  return { status: 'ok', text: res.text || 'Scenario cancelled.', created: [] }
}

// ── Adjustment agent (add_adjustment) ────────────────────────────────────────
// Adds adjustments to an EXISTING scenario without creating a new one.
// Follows the same preview-before-write pattern as create_scenario.

export const ADD_ADJUSTMENT_TOOL = {
  name: 'add_adjustment',
  description:
    'Add one or more month-by-month adjustments to the current scenario. ' +
    'Each adjustment is a SIGNED DELTA versus the budgeted amount for that ' +
    'category-month (positive = spending increase, negative = saving or reduction). ' +
    'Before calling this tool, check the existing adjustments provided in context to ' +
    'avoid duplicating or contradicting what is already there. ' +
    'If timing, amount, or recurrence is ambiguous, ask the user before calling.',
  input_schema: {
    type: 'object',
    properties: {
      adjustments: {
        type: 'array',
        description: 'One row per affected category-month to add.',
        items: {
          type: 'object',
          properties: {
            category: { type: 'string', description: 'Budget category name (existing name preferred).' },
            group: { type: 'string', description: 'Group to use if a new category must be created.' },
            type: { type: 'string', enum: ['Fixed', 'Flexible', 'Non-Monthly'], description: 'Type if a new category must be created.' },
            year: { type: 'integer', description: 'Four-digit year, e.g. 2026.' },
            month: { type: 'integer', minimum: 1, maximum: 12, description: '1=Jan … 12=Dec.' },
            delta_amount: { type: 'number', description: 'Signed change vs the budgeted amount for that month.' },
            label: { type: 'string', description: 'Optional short note for this row.' },
          },
          required: ['category', 'year', 'month', 'delta_amount'],
        },
      },
    },
    required: ['adjustments'],
  },
}

async function executeAddAdjustments(userId, scenarioId, input) {
  const adjustments = Array.isArray(input?.adjustments) ? input.adjustments : []
  if (!adjustments.length) throw new Error('No adjustments provided.')

  let cats = await getBudgetCategories(userId)

  const missing = new Map()
  for (const a of adjustments) {
    if (!resolveCategoryId(cats, a.category)) {
      const key = (a.category || '').trim().toLowerCase()
      if (key && !missing.has(key)) missing.set(key, a)
    }
  }
  if (missing.size) {
    for (const a of missing.values()) {
      await upsertCategory(userId, {
        category: a.category.trim(),
        group: a.group || 'Uncategorized',
        type: a.type || 'Flexible',
      })
    }
    cats = await getBudgetCategories(userId)
  }

  const thisYear = new Date().getFullYear()
  let written = 0
  let netDelta = 0
  for (const a of adjustments) {
    const categoryId = resolveCategoryId(cats, a.category)
    if (!categoryId) continue
    const month = Math.min(12, Math.max(1, Math.round(Number(a.month) || 1)))
    const year = Math.round(Number(a.year) || thisYear)
    const delta = Number(a.delta_amount) || 0
    await addAdjustment(userId, scenarioId, {
      category_id: categoryId, month, year, delta_amount: delta, label: a.label || '',
    })
    written += 1
    netDelta += delta
  }
  return { adjustmentCount: written, netDelta }
}

function buildAdjPreview(input) {
  const thisYear = new Date().getFullYear()
  const adjustments = (input?.adjustments ?? []).map(a => ({
    category: a.category || '',
    year: Math.round(Number(a.year) || thisYear),
    month: Math.min(12, Math.max(1, Math.round(Number(a.month) || 1))),
    delta_amount: Number(a.delta_amount) || 0,
    label: a.label || '',
  }))
  const netDelta = adjustments.reduce((sum, a) => sum + a.delta_amount, 0)
  return { adjustments, adjustmentCount: adjustments.length, netDelta }
}

export async function runAdjustmentAgent({
  userId, scenarioId, scenarioName = '', history = [], prompt,
  context, existingAdjustments = [],
}) {
  const categoryNames = (context?.categories ?? []).map(c => c.category).filter(Boolean)

  const systemExtra = buildAdjustmentSystemExtra({ scenarioName, existingAdjustments, categoryNames })

  const messages = [
    ...history.filter(m => m.content).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: prompt },
  ]

  const res = await invokeAIChat({ messages, tools: [ADD_ADJUSTMENT_TOOL], context, systemExtra, maxTokens: AGENT_MAX_TOKENS })
  if (res.status !== 'ok') return { status: res.status, text: res.text, added: [] }

  if (res.stop_reason === 'max_tokens') {
    return { status: 'error', text: TRUNCATION_MSG, added: [] }
  }

  const messagesWithAI = [...messages, { role: 'assistant', content: res.content }]

  if (res.stop_reason !== 'tool_use') {
    return { status: 'ok', text: res.text || "I couldn't produce a concrete adjustment for that — could you rephrase or add a bit more detail?", added: [] }
  }

  const addBlock = res.content.find(b => b.type === 'tool_use' && b.name === 'add_adjustment')
  if (addBlock) {
    return {
      status: 'pending',
      text: '',
      added: [],
      pending: {
        messagesWithAI,
        allToolBlocks: res.content.filter(b => b.type === 'tool_use'),
        preview: buildAdjPreview(addBlock.input),
        systemExtra,
        scenarioId,
      },
    }
  }

  // Unknown tool — send error result and get text response
  const toolResults = res.content
    .filter(b => b.type === 'tool_use')
    .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify({ ok: false, error: `Unknown tool: ${b.name}` }), is_error: true }))
  const msgs2 = [...messagesWithAI, { role: 'user', content: toolResults }]
  const res2 = await invokeAIChat({ messages: msgs2, context, systemExtra, maxTokens: 512 })
  return { status: 'ok', text: res2.text, added: [] }
}

export async function confirmPendingAdjustments({ userId, pending, context }) {
  const { messagesWithAI, allToolBlocks, systemExtra, scenarioId } = pending
  const added = []
  const toolResults = []

  for (const block of allToolBlocks) {
    if (block.name !== 'add_adjustment') {
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ ok: false, error: `Unknown tool: ${block.name}` }), is_error: true })
      continue
    }
    try {
      const summary = await executeAddAdjustments(userId, scenarioId, block.input)
      added.push(summary)
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ ok: true, ...summary }) })
    } catch (e) {
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ ok: false, error: e.message }), is_error: true })
    }
  }

  const msgs = [...messagesWithAI, { role: 'user', content: toolResults }]
  const res = await invokeAIChat({ messages: msgs, context, systemExtra, maxTokens: 512 })
  return { status: 'ok', text: res.text || 'Adjustments added.', added }
}

export async function cancelPendingAdjustments({ pending, context }) {
  const { messagesWithAI, allToolBlocks, systemExtra } = pending

  const toolResults = allToolBlocks.map(block => ({
    type: 'tool_result',
    tool_use_id: block.id,
    content: JSON.stringify({ ok: false, error: 'User cancelled.' }),
    is_error: true,
  }))

  const msgs = [...messagesWithAI, { role: 'user', content: toolResults }]
  const res = await invokeAIChat({ messages: msgs, context, systemExtra, maxTokens: 256 })
  return { status: 'ok', text: res.text || 'Cancelled.', added: [] }
}
