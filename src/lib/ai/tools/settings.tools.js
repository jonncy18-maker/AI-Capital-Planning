// Settings: income/planning profile, credit-card assumptions, AI preferences.

import { getProfile, saveProfile, saveMinCheckingBalance } from '../../db/profile.js'
import { getAIPreferences, saveAIPreferences } from '../../db/aiPreferences.js'
import { getCCSettings, updateCCSettings } from '../../db/creditCards.js'
import { normalizePreferences, VERBOSITY_OPTIONS } from '../preferences.js'
import { money, row, toMonth, toNullableNumber, toNumber, MONTH_SHORT } from './helpers.js'

// The profile route is a full-row upsert (PUT /api/profile replaces every column
// it manages), so a partial write would silently blank out salary, onboarding
// state and pay days. Every profile edit therefore reads the current row and
// merges on top of it.
const PROFILE_FIELDS = {
  annual_income: { label: 'Salary', fmt: money },
  annual_bonus: { label: 'Bonus', fmt: money },
  bonus_month: { label: 'Bonus month', fmt: v => MONTH_SHORT[toMonth(v) - 1] },
  benefits_amount: { label: 'Benefits', fmt: money },
  benefits_pct: { label: 'Benefits is a %', fmt: v => (v ? 'Yes' : 'No') },
  four01k_pct: { label: '401k %', fmt: v => `${toNumber(v)}%` },
  four01k_on_bonus: { label: '401k on bonus', fmt: v => (v ? 'Yes' : 'No') },
  variance_threshold: { label: 'Variance threshold', fmt: v => `${toNumber(v)}%` },
  pay_day_1: { label: 'Pay day 1', fmt: v => `day ${toNumber(v)}` },
  pay_day_2: { label: 'Pay day 2', fmt: v => `day ${toNumber(v)}` },
}

function profilePatch(input) {
  const patch = {}
  if (input.salary !== undefined) patch.annual_income = toNullableNumber(input.salary)
  if (input.bonus !== undefined) patch.annual_bonus = toNullableNumber(input.bonus)
  if (input.bonus_month !== undefined) patch.bonus_month = toMonth(input.bonus_month)
  if (input.benefits_amount !== undefined) patch.benefits_amount = toNullableNumber(input.benefits_amount)
  if (input.benefits_is_pct !== undefined) patch.benefits_pct = !!input.benefits_is_pct
  if (input.k401_pct !== undefined) patch.four01k_pct = toNullableNumber(input.k401_pct)
  if (input.k401_on_bonus !== undefined) patch.four01k_on_bonus = !!input.k401_on_bonus
  if (input.variance_threshold !== undefined) patch.variance_threshold = toNullableNumber(input.variance_threshold)
  if (input.pay_day_1 !== undefined) patch.pay_day_1 = toNullableNumber(input.pay_day_1)
  if (input.pay_day_2 !== undefined) patch.pay_day_2 = toNullableNumber(input.pay_day_2)
  return patch
}

export const settingsTools = [
  {
    name: 'update_planning_profile',
    group: 'settings',
    write: true,
    schema: {
      name: 'update_planning_profile',
      description:
        'Update the income and planning assumptions in Settings — salary, bonus, benefits, 401k ' +
        'contribution, budget variance threshold, pay days. These drive the take-home forecast ' +
        'and the Income vs. Expenses chart. Only the fields you pass change.',
      input_schema: {
        type: 'object',
        properties: {
          salary: { type: 'number', description: 'Annual gross salary.' },
          bonus: { type: 'number', description: 'Annual bonus amount.' },
          bonus_month: { type: 'integer', minimum: 1, maximum: 12, description: 'Month the bonus lands.' },
          benefits_amount: { type: 'number', description: 'Monthly benefits deduction (dollars, or a percent when benefits_is_pct is true).' },
          benefits_is_pct: { type: 'boolean' },
          k401_pct: { type: 'number', description: '401k contribution as a percent of gross.' },
          k401_on_bonus: { type: 'boolean', description: 'Whether 401k and benefits also apply in the bonus month.' },
          variance_threshold: { type: 'number', description: 'Percent variance before budget vs. actual flags a category.' },
          pay_day_1: { type: 'integer', description: 'Day of month of the first paycheck.' },
          pay_day_2: { type: 'integer', description: 'Day of month of the second paycheck.' },
          min_checking_balance: { type: 'number', description: 'Minimum balance the pay-period planner keeps in checking.' },
        },
      },
    },
    async preview(input, ctx) {
      const current = await getProfile(ctx.userId)
      const patch = profilePatch(input)
      const rows = Object.entries(patch).map(([k, v]) => {
        const meta = PROFILE_FIELDS[k]
        const before = current?.[k]
        const label = meta?.label ?? k
        const fmt = meta?.fmt ?? (x => String(x))
        return row(label, `${before === null || before === undefined ? '—' : fmt(before)} → ${fmt(v)}`)
      })
      if (input.min_checking_balance !== undefined) {
        rows.push(row('Min checking balance', `${money(current?.min_checking_balance)} → ${money(input.min_checking_balance)}`))
      }
      return { title: 'Update planning settings', rows }
    },
    async execute(userId, input) {
      const patch = profilePatch(input)
      if (Object.keys(patch).length) {
        const current = await getProfile(userId)
        await saveProfile(userId, { ...(current ?? {}), ...patch })
      }
      if (input.min_checking_balance !== undefined) {
        await saveMinCheckingBalance(userId, toNumber(input.min_checking_balance))
      }
      const changed = Object.keys(patch).map(k => PROFILE_FIELDS[k]?.label ?? k)
      if (input.min_checking_balance !== undefined) changed.push('Min checking balance')
      if (!changed.length) throw new Error('No settings fields were provided.')
      return { summary: `Updated planning settings: ${changed.join(', ')}`, result: { changed } }
    },
  },

  {
    name: 'update_credit_card_settings',
    group: 'settings',
    write: true,
    schema: {
      name: 'update_credit_card_settings',
      description: 'Update the credit-card planning assumptions: what share of spend is put on cards (coverage) and how well it is routed to the best card (optimization).',
      input_schema: {
        type: 'object',
        properties: {
          coverage_pct: { type: 'number', description: 'Percent of spend put on credit cards (0-100).' },
          optimization_pct: { type: 'number', description: 'Percent of that spend routed to the best-earning card (0-100).' },
        },
      },
    },
    async preview(input, ctx) {
      const current = await getCCSettings(ctx.userId)
      return {
        title: 'Update credit-card assumptions',
        rows: [
          input.coverage_pct !== undefined ? row('Coverage', `${toNumber(current?.coveragePct ?? current?.cc_coverage_pct)}% → ${toNumber(input.coverage_pct)}%`) : null,
          input.optimization_pct !== undefined ? row('Optimization', `${toNumber(current?.optimizationPct ?? current?.cc_optimization_pct)}% → ${toNumber(input.optimization_pct)}%`) : null,
        ].filter(Boolean),
      }
    },
    async execute(userId, input) {
      const current = await getCCSettings(userId)
      const coveragePct = input.coverage_pct !== undefined
        ? toNumber(input.coverage_pct)
        : toNumber(current?.coveragePct ?? current?.cc_coverage_pct)
      const optimizationPct = input.optimization_pct !== undefined
        ? toNumber(input.optimization_pct)
        : toNumber(current?.optimizationPct ?? current?.cc_optimization_pct)
      await updateCCSettings(userId, { coveragePct, optimizationPct })
      return { summary: `Set card coverage ${coveragePct}% / optimization ${optimizationPct}%`, result: { coveragePct, optimizationPct } }
    },
  },

  {
    name: 'update_ai_preferences',
    group: 'settings',
    write: true,
    schema: {
      name: 'update_ai_preferences',
      description:
        'Update how the assistant briefs this user — tone, response length, what to prioritize, ' +
        'always surface, or treat as noise. Use when the user tells you how they want to be ' +
        'briefed ("stop leading with net worth", "keep it shorter"). Fields you omit are kept.',
      input_schema: {
        type: 'object',
        properties: {
          tone: { type: 'string', description: 'Desired tone, e.g. "direct, no hedging".' },
          verbosity: { type: 'string', enum: VERBOSITY_OPTIONS },
          priorities: { type: 'array', items: { type: 'string' }, description: 'What matters most to this user.' },
          surface: { type: 'array', items: { type: 'string' }, description: 'Things to always call out.' },
          ignore: { type: 'array', items: { type: 'string' }, description: 'Things to treat as noise.' },
          notes: { type: 'string', description: 'Any other framing guidance.' },
        },
      },
    },
    async preview(input, ctx) {
      const current = normalizePreferences((await getAIPreferences(ctx.userId))?.preferences)
      const next = normalizePreferences({ ...current, ...input })
      return {
        title: 'Update AI briefing preferences',
        rows: [
          next.tone !== current.tone ? row('Tone', `${current.tone || '—'} → ${next.tone}`) : null,
          next.verbosity !== current.verbosity ? row('Length', `${current.verbosity} → ${next.verbosity}`) : null,
          input.priorities ? row('Prioritize', next.priorities.join('; ')) : null,
          input.surface ? row('Always surface', next.surface.join('; ')) : null,
          input.ignore ? row('De-emphasize', next.ignore.join('; ')) : null,
          input.notes ? row('Notes', next.notes) : null,
        ].filter(Boolean),
      }
    },
    async execute(userId, input) {
      const existing = await getAIPreferences(userId)
      const merged = normalizePreferences({ ...normalizePreferences(existing?.preferences), ...input })
      await saveAIPreferences(userId, { preferences: merged })
      return { summary: 'Updated AI briefing preferences', result: merged }
    },
  },
]
