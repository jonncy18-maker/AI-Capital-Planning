// AI scenario agent — lets the assistant actually CREATE a scenario (instead of
// only describing the steps), via Anthropic tool use. The tool loop runs in the
// browser: the model returns a create_scenario tool call, we execute it against
// Supabase with the user's session (RLS), return a tool_result, and continue
// until the model produces its final summary. This mirrors how the rest of the
// app does its DB writes client-side.

import { invokeAIChat } from './sendMessage.js'
import { createScenario, addAdjustment } from '../db/scenarios.js'
import { getBudgetCategories, upsertCategory } from '../db/budgetCategories.js'

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
  // Conservative fuzzy match: one fully contains the other, min length 4.
  const fuzzy = cats.find(c => {
    const cn = (c.category || '').toLowerCase()
    if (cn.length < 4 || lc.length < 4) return false
    return cn.includes(lc) || lc.includes(cn)
  })
  return fuzzy ? fuzzy.id : null
}

// Execute a create_scenario tool call against the DB. Resolves each adjustment's
// category to an id (creating the category if it doesn't exist), then writes the
// scenario + its adjustments. Returns a compact summary for the tool_result.
async function executeCreateScenario(userId, input) {
  const adjustments = Array.isArray(input?.adjustments) ? input.adjustments : []
  if (!adjustments.length) throw new Error('No adjustments were provided.')

  let cats = await getBudgetCategories(userId)

  // Create any categories we can't resolve, then refetch so they have ids.
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

// Run a conversation turn with the create_scenario tool available. `history` is
// the prior display turns ([{ role, content }]). Drives the tool loop and returns
// { status, text, created } where `created` lists any scenarios built this turn.
// `onStatus(text)` is called with progress strings (e.g. "Building …").
export async function runScenarioAgent({ userId, history = [], prompt, context, yearTxns, onStatus }) {
  const categoryNames = (context?.categories ?? [])
    .map(c => c.category)
    .filter(Boolean)
  const systemExtra = categoryNames.length
    ? `When calling create_scenario, prefer these existing category names when they fit: ${categoryNames.slice(0, 80).join(', ')}.`
    : ''

  const messages = [
    ...history.filter(m => m.content).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: prompt },
  ]

  const created = []

  for (let step = 0; step < 5; step++) {
    const res = await invokeAIChat({ messages, tools: [CREATE_SCENARIO_TOOL], context, yearTxns, systemExtra, maxTokens: 1500 })
    if (res.status !== 'ok') return { status: res.status, text: res.text, created }

    messages.push({ role: 'assistant', content: res.content })

    if (res.stop_reason !== 'tool_use') {
      return { status: 'ok', text: res.text, created }
    }

    // Every tool_use block in the turn must get a matching tool_result.
    const toolResults = []
    for (const block of res.content) {
      if (block.type !== 'tool_use') continue
      if (block.name !== 'create_scenario') {
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ ok: false, error: `Unknown tool: ${block.name}` }), is_error: true })
        continue
      }
      onStatus?.(`Building “${block.input?.name || 'scenario'}” …`)
      try {
        const summary = await executeCreateScenario(userId, block.input)
        created.push(summary)
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ ok: true, ...summary }) })
      } catch (e) {
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ ok: false, error: e.message }), is_error: true })
      }
    }
    messages.push({ role: 'user', content: toolResults })
  }

  return { status: 'ok', text: 'Stopped after several steps — the scenario may be partially built. Check the Scenario Planner.', created }
}
