// Scenario write tools: the create_scenario / add_adjustment tool schemas plus
// their execute and preview builders. Shared by the scenario tool registry
// (tools/scenarios.tools.js), which the MCP connector reaches.

import { createScenario, addAdjustment } from '../../db/scenarios.js'
import { getBudgetCategories, upsertCategory } from '../../db/budgetCategories.js'

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

export async function executeCreateScenario(userId, input) {
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
    netDelta += isIncomeCategoryName(cats, a.category) ? delta : -delta
  }

  return { scenarioId: scenario.id, name: scenario.name, adjustmentCount: written, netDelta }
}

// Build a human-readable preview of what create_scenario would do, without
// touching the DB. Used to populate the confirmation card in the chat.
// Category-name → income lookup for preview/net math. Mirrors
// isIncomeAdjustment in scenarioUtils, but previews only carry the name.
function isIncomeCategoryName(categories, name) {
  const n = (name || '').trim().toLowerCase()
  const cat = (categories ?? []).find(c => (c.category || '').trim().toLowerCase() === n)
  return ((cat?.group || '') + '').trim().toLowerCase() === 'income'
}

export function buildPreview(input, categories) {
  const thisYear = new Date().getFullYear()
  const adjustments = (input?.adjustments ?? []).map(a => ({
    category: a.category || '',
    year: Math.round(Number(a.year) || thisYear),
    month: Math.min(12, Math.max(1, Math.round(Number(a.month) || 1))),
    delta_amount: Number(a.delta_amount) || 0,
    label: a.label || '',
    isIncome: isIncomeCategoryName(categories, a.category),
  }))
  // Net in cash terms: income adds, spending subtracts.
  const netDelta = adjustments.reduce((sum, a) => sum + (a.isIncome ? a.delta_amount : -a.delta_amount), 0)
  return {
    name: input?.name || 'New scenario',
    description: input?.description || '',
    adjustments,
    adjustmentCount: adjustments.length,
    netDelta,
  }
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

export async function executeAddAdjustments(userId, scenarioId, input) {
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
    netDelta += isIncomeCategoryName(cats, a.category) ? delta : -delta
  }
  return { adjustmentCount: written, netDelta }
}

export function buildAdjPreview(input, categories) {
  const thisYear = new Date().getFullYear()
  const adjustments = (input?.adjustments ?? []).map(a => ({
    category: a.category || '',
    year: Math.round(Number(a.year) || thisYear),
    month: Math.min(12, Math.max(1, Math.round(Number(a.month) || 1))),
    delta_amount: Number(a.delta_amount) || 0,
    label: a.label || '',
    isIncome: isIncomeCategoryName(categories, a.category),
  }))
  // Net in cash terms: income adds, spending subtracts.
  const netDelta = adjustments.reduce((sum, a) => sum + (a.isIncome ? a.delta_amount : -a.delta_amount), 0)
  return { adjustments, adjustmentCount: adjustments.length, netDelta }
}
