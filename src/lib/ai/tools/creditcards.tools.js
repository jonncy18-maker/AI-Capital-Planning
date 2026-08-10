// Credit card records, points balances and planned redemptions.

import {
  getCreditCards, upsertCreditCard, deleteCreditCard,
  upsertPointsBalance, getPointRedemptions, upsertPointRedemption, deletePointRedemption,
  upsertEarnRate,
} from '../../db/creditCards.js'
import {
  money, resolveByName, row, toMonth, toNumber, toNullableNumber, toYear, thisYear,
  requireField, MONTH_SHORT,
} from './helpers.js'

function points(v) {
  return `${Math.round(Number(v) || 0).toLocaleString()} pts`
}

export const creditCardTools = [
  {
    name: 'save_credit_card',
    group: 'creditcards',
    write: true,
    schema: {
      name: 'save_credit_card',
      description: 'Create a credit card record or update an existing one by name.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Card name, e.g. "Amex Platinum".' },
          issuer: { type: 'string' },
          network: { type: 'string', description: 'e.g. visa, mastercard, amex.' },
          last_four: { type: 'string' },
          points_program: { type: 'string', description: 'e.g. "Membership Rewards", "Ultimate Rewards".' },
          annual_fee: { type: 'number' },
          annual_fee_month: { type: 'integer', minimum: 1, maximum: 12 },
          statement_close_day: { type: 'integer', minimum: 1, maximum: 31 },
          due_days_after_close: { type: 'integer' },
          points_value_cents: { type: 'number', description: 'Assumed value per point, in cents.' },
          active: { type: 'boolean' },
        },
        required: ['name'],
      },
    },
    async preview(input, ctx) {
      const existing = resolveByName(await getCreditCards(ctx.userId), input.name)
      return {
        title: existing ? `Update card · ${existing.name}` : `New card · ${input.name}`,
        rows: [
          row('Issuer', input.issuer ?? existing?.issuer),
          row('Program', input.points_program ?? existing?.points_program),
          row('Annual fee', (input.annual_fee ?? existing?.annual_fee) != null ? money(input.annual_fee ?? existing?.annual_fee) : null),
          row('Fee month', (input.annual_fee_month ?? existing?.annual_fee_month) ? MONTH_SHORT[toMonth(input.annual_fee_month ?? existing?.annual_fee_month) - 1] : null),
          row('Statement closes', input.statement_close_day ?? existing?.statement_close_day),
        ],
      }
    },
    async execute(userId, input) {
      requireField(input, 'name')
      const existing = resolveByName(await getCreditCards(userId), input.name)
      const payload = {
        name: input.name.trim(),
        issuer: input.issuer ?? existing?.issuer ?? null,
        network: input.network ?? existing?.network ?? null,
        last_four: input.last_four ?? existing?.last_four ?? null,
        points_program: input.points_program ?? existing?.points_program ?? null,
        is_default: existing?.is_default ?? false,
        statement_close_day: input.statement_close_day ?? existing?.statement_close_day ?? null,
        due_days_after_close: input.due_days_after_close ?? existing?.due_days_after_close ?? null,
        annual_fee: toNullableNumber(input.annual_fee) ?? existing?.annual_fee ?? null,
        annual_fee_month: input.annual_fee_month ?? existing?.annual_fee_month ?? null,
        points_value_cents: toNullableNumber(input.points_value_cents) ?? existing?.points_value_cents ?? null,
        color: existing?.color ?? null,
        active: input.active ?? existing?.active ?? true,
        display_order: existing?.display_order ?? null,
      }
      if (existing) payload.id = existing.id
      const saved = await upsertCreditCard(userId, payload)
      return {
        summary: `${existing ? 'Updated' : 'Created'} card "${payload.name}"`,
        result: { id: saved?.id ?? existing?.id },
        undo: existing ? null : { tool: 'delete_credit_card', input: { name: payload.name } },
      }
    },
  },

  {
    name: 'delete_credit_card',
    group: 'creditcards',
    write: true,
    schema: {
      name: 'delete_credit_card',
      description: 'Delete a credit card record by name, along with its earn rates and points history.',
      input_schema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
    async preview(input, ctx) {
      const target = resolveByName(await getCreditCards(ctx.userId), input.name)
      return {
        title: `Delete card · ${target?.name ?? input.name}`,
        subtitle: target ? '' : 'No card with that name was found.',
        rows: target ? [row('Issuer', target.issuer), row('Program', target.points_program)] : [],
        destructive: true,
      }
    },
    async execute(userId, input) {
      const target = resolveByName(await getCreditCards(userId), requireField(input, 'name'))
      if (!target) throw new Error(`No credit card named "${input.name}".`)
      await deleteCreditCard(target.id)
      return { summary: `Deleted card "${target.name}"`, result: { id: target.id } }
    },
  },

  {
    name: 'save_points_balance',
    group: 'creditcards',
    write: true,
    schema: {
      name: 'save_points_balance',
      description: 'Record the current points balance for a card as of a date.',
      input_schema: {
        type: 'object',
        properties: {
          card: { type: 'string', description: 'Card name or id.' },
          balance: { type: 'number', description: 'Points balance.' },
          as_of_date: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' },
        },
        required: ['card', 'balance'],
      },
    },
    async preview(input, ctx) {
      const target = resolveByName(await getCreditCards(ctx.userId), input.card)
      return {
        title: `Points balance · ${target?.name ?? input.card}`,
        subtitle: target ? '' : 'No card with that name was found.',
        rows: [
          row('Balance', points(input.balance), 'good'),
          row('As of', input.as_of_date ?? new Date().toISOString().slice(0, 10)),
        ],
      }
    },
    async execute(userId, input) {
      const target = resolveByName(await getCreditCards(userId), requireField(input, 'card'))
      if (!target) throw new Error(`No credit card named "${input.card}".`)
      const asOf = input.as_of_date ?? new Date().toISOString().slice(0, 10)
      await upsertPointsBalance(userId, target.id, toNumber(input.balance), asOf)
      return { summary: `Recorded ${points(input.balance)} on "${target.name}" as of ${asOf}`, result: { cardId: target.id } }
    },
  },

  {
    name: 'save_point_redemption',
    group: 'creditcards',
    write: true,
    schema: {
      name: 'save_point_redemption',
      description: 'Plan or record a points redemption in a given month.',
      input_schema: {
        type: 'object',
        properties: {
          card: { type: 'string', description: 'Card name or id.' },
          year: { type: 'integer' },
          month: { type: 'integer', minimum: 1, maximum: 12 },
          points_amount: { type: 'number' },
          description: { type: 'string', description: 'What the points are being used for.' },
        },
        required: ['card', 'month', 'points_amount'],
      },
    },
    async preview(input, ctx) {
      const target = resolveByName(await getCreditCards(ctx.userId), input.card)
      return {
        title: `Redemption · ${target?.name ?? input.card}`,
        subtitle: input.description || '',
        rows: [
          row('When', `${MONTH_SHORT[toMonth(input.month) - 1]} ${toYear(input.year)}`),
          row('Points', points(input.points_amount), 'bad'),
        ],
      }
    },
    async execute(userId, input) {
      const target = resolveByName(await getCreditCards(userId), requireField(input, 'card'))
      if (!target) throw new Error(`No credit card named "${input.card}".`)
      const year = input.year ? toYear(input.year) : thisYear()
      const month = toMonth(input.month)
      const saved = await upsertPointRedemption(userId, {
        cardId: target.id,
        year,
        month,
        pointsAmount: toNumber(input.points_amount),
        description: input.description ?? null,
      })
      return {
        summary: `Planned ${points(input.points_amount)} redemption on "${target.name}" in ${MONTH_SHORT[month - 1]} ${year}`,
        result: { id: saved?.id },
        undo: saved?.id ? { tool: 'delete_point_redemption', input: { id: saved.id, year } } : null,
      }
    },
  },

  {
    name: 'delete_point_redemption',
    group: 'creditcards',
    write: true,
    schema: {
      name: 'delete_point_redemption',
      description: 'Delete a planned points redemption. Pass its id (from lookup_data), or the card plus month to match on.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          card: { type: 'string' },
          year: { type: 'integer' },
          month: { type: 'integer', minimum: 1, maximum: 12 },
        },
      },
    },
    async preview(input) {
      return {
        title: 'Delete points redemption',
        rows: [
          row('Card', input.card ?? input.id),
          row('When', input.month ? `${MONTH_SHORT[toMonth(input.month) - 1]} ${toYear(input.year)}` : 'matched by id'),
        ],
        destructive: true,
      }
    },
    async execute(userId, input) {
      const year = input.year ? toYear(input.year) : thisYear()
      const rows = await getPointRedemptions(userId, year)
      let target = input.id ? (rows ?? []).find(r => r.id === input.id) : null
      if (!target && input.card) {
        const card = resolveByName(await getCreditCards(userId), input.card)
        target = (rows ?? []).find(r => r.card_id === card?.id && (!input.month || r.month === toMonth(input.month)))
      }
      if (!target) throw new Error('No matching redemption found.')
      await deletePointRedemption(target.id)
      return { summary: `Deleted redemption of ${points(target.points_amount)}`, result: { id: target.id } }
    },
  },

  {
    name: 'save_card_earn_rate',
    group: 'creditcards',
    write: true,
    schema: {
      name: 'save_card_earn_rate',
      description: 'Set the points-per-dollar earn rate for a spending category on a card.',
      input_schema: {
        type: 'object',
        properties: {
          card: { type: 'string', description: 'Card name or id.' },
          cc_category: { type: 'string', description: 'Spending category the rate applies to, e.g. "dining".' },
          earn_rate: { type: 'number', description: 'Points per dollar, e.g. 4 for 4x.' },
        },
        required: ['card', 'cc_category', 'earn_rate'],
      },
    },
    async preview(input, ctx) {
      const target = resolveByName(await getCreditCards(ctx.userId), input.card)
      return {
        title: `Earn rate · ${target?.name ?? input.card}`,
        rows: [
          row('Category', input.cc_category),
          row('Rate', `${toNumber(input.earn_rate)}x`, 'good'),
        ],
      }
    },
    async execute(userId, input) {
      const target = resolveByName(await getCreditCards(userId), requireField(input, 'card'))
      if (!target) throw new Error(`No credit card named "${input.card}".`)
      await upsertEarnRate(userId, target.id, requireField(input, 'cc_category'), toNumber(input.earn_rate))
      return {
        summary: `Set ${toNumber(input.earn_rate)}x on "${target.name}" for ${input.cc_category}`,
        result: { cardId: target.id },
      }
    },
  },
]
