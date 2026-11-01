// AI briefing tools (MCP only): read and store the cached narrative shown on module headers.

import { getLatestBriefing, saveBriefing } from '../../../db/aiBriefings.js'
import { row, requireField } from '../helpers.js'
import { withMode } from './shared.js'

export const briefingTools = [
  {
    name: 'get_ai_briefing',
    group: 'briefings',
    write: false,
    schema: {
      name: 'get_ai_briefing',
      description: 'The most recent cached AI briefing for a module (default: the dashboard overview).',
      input_schema: {
        type: 'object',
        properties: { module_context: { type: 'string', description: 'Defaults to "dashboard".' } },
      },
    },
    async execute(userId, input) {
      const briefing = await getLatestBriefing(userId, input.module_context || 'dashboard')
      return { summary: briefing ? 'Latest briefing' : 'No briefing saved yet', result: { briefing: briefing ?? null } }
    },
  },

  {
    name: 'save_ai_briefing',
    group: 'briefings',
    write: true,
    mcpGated: true,
    schema: {
      name: 'save_ai_briefing',
      description: 'Store a briefing narrative so the app shows it for that module. Adds a new row; it does not overwrite older ones.',
      input_schema: {
        type: 'object',
        properties: withMode({
          narrative: { type: 'string' },
          context_summary: { type: 'string' },
          module_context: { type: 'string', description: 'Defaults to "dashboard".' },
        }),
        required: ['narrative'],
      },
    },
    async preview(input) {
      const text = String(input.narrative ?? '')
      return {
        title: `Save briefing · ${input.module_context || 'dashboard'}`,
        rows: [row('Narrative', text.length > 200 ? `${text.slice(0, 200)}…` : text), row('Length', `${text.length} chars`, 'muted')],
      }
    },
    async execute(userId, input) {
      requireField(input, 'narrative')
      const saved = await saveBriefing(userId, {
        narrative: input.narrative,
        context_summary: input.context_summary,
        module_context: input.module_context || 'dashboard',
      })
      return { summary: 'Saved briefing', result: saved }
    },
  },
]
