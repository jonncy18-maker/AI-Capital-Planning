// The AI tool registry: every action the assistant can take, in one list.
//
// A tool is:
//   name      unique tool name, matches schema.name
//   group     module it belongs to (used for the activity log and grouping)
//   write     true if it changes data — write tools always pause for confirmation
//   schema    the Anthropic tool definition sent with the request
//   preview   (input, ctx) => preview payload rendered in the confirmation card
//   execute   (userId, input, ctx) => { summary, result, created?, undo? }
//
// Adding a capability means adding one entry here — the agent loop, the
// confirmation card and the activity log are all driven off this shape.

import { readTools } from './read.tools.js'
import { commitmentTools } from './commitments.tools.js'
import { wealthTools } from './wealth.tools.js'
import { accountTools } from './accounts.tools.js'
import { creditCardTools } from './creditcards.tools.js'
import { settingsTools } from './settings.tools.js'
import { billTools } from './bills.tools.js'
import { budgetTools } from './budget.tools.js'
import { forecastTools } from './forecast.tools.js'
import { incomeTools } from './income.tools.js'
import { scenarioTools } from './scenarios.tools.js'

export const ALL_TOOLS = [
  ...readTools,
  ...scenarioTools,
  ...billTools,
  ...budgetTools,
  ...forecastTools,
  ...incomeTools,
  ...commitmentTools,
  ...wealthTools,
  ...accountTools,
  ...creditCardTools,
  ...settingsTools,
]

const BY_NAME = new Map(ALL_TOOLS.map(t => [t.name, t]))

export function getTool(name) {
  return BY_NAME.get(name) ?? null
}

export function isWriteTool(name) {
  return !!getTool(name)?.write
}

// Anthropic tool definitions, in registry order.
export function toolSchemas() {
  return ALL_TOOLS.map(t => t.schema)
}

export async function buildPreview(name, input, ctx) {
  const tool = getTool(name)
  if (!tool) throw new Error(`Unknown tool: ${name}`)
  if (!tool.preview) return { title: name, rows: [] }
  const preview = await tool.preview(input ?? {}, ctx)
  return { kind: 'generic', tool: name, group: tool.group, ...preview }
}

export async function executeTool(name, userId, input, ctx) {
  const tool = getTool(name)
  if (!tool) throw new Error(`Unknown tool: ${name}`)
  return tool.execute(userId, input ?? {}, ctx)
}
