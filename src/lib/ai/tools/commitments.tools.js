// Long-Term Commitments write tools.

import { getCommitments, upsertCommitment, deleteCommitment } from '../../db/commitments.js'
import { money, resolveByName, row, toMonth, toNumber, requireField } from './helpers.js'

const TYPES = ['scholarship', 'family_support', 'lease', 'eldercare', 'other']
const STATUSES = ['active', 'paused', 'completed']
const CADENCES = ['monthly', 'annual', 'total']

function describeCadence(cadence, amount, month) {
  if (cadence === 'annual') return `${money(amount)} once a year (month ${toMonth(month)})`
  if (cadence === 'total') return `${money(amount)} total over the term`
  return `${money(amount)} per month`
}

// The commitments API PATCHes a partial record but replaces cost_structure and
// split_rules wholesale, so an edit has to re-send the whole cost structure —
// hence the merge against the existing row rather than a bare patch.
function buildCostStructure(input, existing) {
  const cs = existing?.cost_structure ?? {}
  const cadence = input.cadence ?? cs.kind ?? 'monthly'
  const amount = input.amount !== undefined ? toNumber(input.amount) : toNumber(cs.amount ?? cs.monthly_amount ?? cs.annual_total)
  const built = { kind: cadence, amount }
  if (cadence === 'annual') built.month = toMonth(input.due_month ?? cs.month ?? cs.due_month ?? 1)
  return built
}

function buildSplitRules(input, existing) {
  if (!input.split_rules) return existing?.split_rules ?? {}
  const out = {}
  for (const [k, v] of Object.entries(input.split_rules)) {
    const pct = Number(v)
    if (!k.trim() || !Number.isFinite(pct)) continue
    // Accept either a fraction (0.95) or a percentage (95) — the model writes both.
    out[k.trim()] = pct > 1 ? pct / 100 : pct
  }
  return out
}

export const commitmentTools = [
  {
    name: 'save_commitment',
    group: 'commitments',
    write: true,
    schema: {
      name: 'save_commitment',
      description:
        'Create a new long-term commitment (an obligation spanning more than a year: scholarship, ' +
        'family support, lease, eldercare) or update an existing one. To update, pass the exact ' +
        'existing name in `name` and set `update: true` — only the fields you pass change. ' +
        'Look up existing commitments with lookup_data first when editing.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Commitment name. For an update this must match the existing commitment.' },
          update: { type: 'boolean', description: 'True to edit the commitment matching `name` instead of creating a new one.' },
          rename_to: { type: 'string', description: 'New name, when updating.' },
          type: { type: 'string', enum: TYPES },
          status: { type: 'string', enum: STATUSES },
          start_date: { type: 'string', description: 'YYYY-MM-DD.' },
          end_date: { type: 'string', description: 'YYYY-MM-DD, or omit for open-ended.' },
          cadence: { type: 'string', enum: CADENCES, description: 'monthly = amount every month; annual = amount once a year; total = a fixed total over the whole term.' },
          amount: { type: 'number', description: 'Cost for the chosen cadence.' },
          due_month: { type: 'integer', minimum: 1, maximum: 12, description: 'Month the annual amount lands (cadence=annual only).' },
          notes: { type: 'string' },
          split_rules: {
            type: 'object',
            description: 'Optional category split, e.g. {"mission": 0.95, "family_support": 0.05}. Values may be fractions or percentages.',
            additionalProperties: { type: 'number' },
          },
        },
        required: ['name'],
      },
    },
    async preview(input, ctx) {
      const existing = input.update ? resolveByName(await getCommitments(ctx.userId, { status: null }), input.name) : null
      const cs = buildCostStructure(input, existing)
      return {
        title: existing ? `Update commitment · ${existing.name}` : `New commitment · ${input.name}`,
        subtitle: input.notes || existing?.notes || '',
        rows: [
          input.rename_to ? row('Rename to', input.rename_to) : null,
          row('Type', input.type ?? existing?.type ?? 'other'),
          row('Status', input.status ?? existing?.status ?? 'active'),
          row('Starts', input.start_date ?? existing?.start_date ?? '—'),
          row('Ends', input.end_date ?? existing?.end_date ?? 'open-ended'),
          row('Cost', describeCadence(cs.kind, cs.amount, cs.month)),
        ].filter(Boolean),
      }
    },
    async execute(userId, input) {
      requireField(input, 'name')
      const all = await getCommitments(userId, { status: null })
      const existing = input.update ? resolveByName(all, input.name) : null
      if (input.update && !existing) throw new Error(`No commitment named "${input.name}".`)

      const payload = {
        name: input.rename_to?.trim() || existing?.name || input.name.trim(),
        type: input.type ?? existing?.type ?? 'other',
        status: input.status ?? existing?.status ?? 'active',
        start_date: input.start_date ?? existing?.start_date ?? new Date().toISOString().slice(0, 10),
        end_date: input.end_date ?? existing?.end_date ?? null,
        cost_structure: buildCostStructure(input, existing),
        split_rules: buildSplitRules(input, existing),
        notes: input.notes ?? existing?.notes ?? null,
      }
      if (existing) payload.id = existing.id

      const saved = await upsertCommitment(userId, payload)
      return {
        summary: `${existing ? 'Updated' : 'Created'} commitment "${payload.name}"`,
        result: { id: saved?.id ?? existing?.id, name: payload.name },
        // Only a fresh create is cleanly reversible; an edit would need the
        // whole prior record, which the log deliberately doesn't retain.
        undo: existing ? null : { tool: 'delete_commitment', input: { name: payload.name } },
      }
    },
  },

  {
    name: 'delete_commitment',
    group: 'commitments',
    write: true,
    schema: {
      name: 'delete_commitment',
      description: 'Delete a long-term commitment by name. Prefer setting status to "completed" via save_commitment when the obligation simply ended — deletion loses the record.',
      input_schema: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Exact commitment name.' } },
        required: ['name'],
      },
    },
    async preview(input, ctx) {
      const target = resolveByName(await getCommitments(ctx.userId, { status: null }), input.name)
      return {
        title: `Delete commitment · ${target?.name ?? input.name}`,
        subtitle: target ? '' : 'No commitment with that name was found.',
        rows: target ? [
          row('Type', target.type),
          row('Status', target.status),
          row('Term', `${target.start_date ?? '—'} → ${target.end_date ?? 'open-ended'}`),
        ] : [],
        destructive: true,
      }
    },
    async execute(userId, input) {
      const target = resolveByName(await getCommitments(userId, { status: null }), requireField(input, 'name'))
      if (!target) throw new Error(`No commitment named "${input.name}".`)
      await deleteCommitment(target.id)
      return { summary: `Deleted commitment "${target.name}"`, result: { id: target.id } }
    },
  },
]
