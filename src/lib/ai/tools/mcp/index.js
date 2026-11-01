// MCP-only tool registry. The in-app assistant never sees these: they are not
// in ALL_TOOLS, so its prompt size, confirm card and behaviour are unchanged.
// Only app/api/mcp/route.js imports this file.

import { ALL_TOOLS } from '../index.js'
import { outlookTools } from './outlook.tools.js'
import { scenarioOutlookTools } from './scenarioOutlook.tools.js'
import { wealthPlanTools } from './wealthPlans.tools.js'
import { briefingTools } from './briefings.tools.js'
import { transactionTools } from './transactions.tools.js'
import { computedTools } from './computed.tools.js'
import { importTools } from './import.tools.js'

export const MCP_ONLY_TOOLS = [
  ...outlookTools,
  ...scenarioOutlookTools,
  ...wealthPlanTools,
  ...briefingTools,
  ...transactionTools,
  ...computedTools,
  ...importTools,
]

export function mcpTools() {
  return [...ALL_TOOLS, ...MCP_ONLY_TOOLS]
}

const BY_NAME = new Map(mcpTools().map(t => [t.name, t]))

export function getMcpTool(name) {
  return BY_NAME.get(name) ?? null
}

export function mcpToolSchemas() {
  return mcpTools().map(t => t.schema)
}

// Write tools flagged mcpGated run as a dry run unless mode is "commit". The
// existing in-app tools are not flagged, so they execute immediately as before.
export async function runMcpTool(tool, userId, input, ctx = {}) {
  const args = input ?? {}
  if (tool.write && tool.mcpGated && args.mode !== 'commit') {
    const preview = tool.preview
      ? await tool.preview(args, { ...ctx, userId })
      : { title: tool.name, rows: [] }
    return {
      summary: `Preview only: ${preview.title ?? tool.name}. Nothing was saved.`,
      result: {
        mode: 'preview',
        committed: false,
        preview,
        next: 'Nothing was saved. Call again with mode:"commit" to apply.',
      },
    }
  }
  return tool.execute(userId, args, { ...ctx, userId })
}

export async function executeMcpTool(name, userId, input, ctx = {}) {
  const tool = getMcpTool(name)
  if (!tool) throw new Error(`Unknown tool: ${name}`)
  return runMcpTool(tool, userId, input, ctx)
}
