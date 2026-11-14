// Pure helpers for the WEEKS what-if overlay. What-ifs live in React state only;
// buildWhatIfParam turns them into the `whatIf` input of buildWeeklyCashSeries.

import { toCents, fromCents, parseCentsStrict } from '../money.js'
import { cashEffect, isIncomeAdjustment } from '../scenarios/scenarioUtils.js'

const MAX_AMOUNT = 1e9
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/

function isRealDate(v) {
  const m = typeof v === 'string' ? YMD.exec(v) : null
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

function occurrenceKey(item) {
  if (item.type === 'skipBill' || item.type === 'moveBill') return `bill|${item.billId}|${item.ym}`
  if (item.type === 'moveCard') return `card|${item.cardId}|${item.dueYm}`
  return null
}

export function validateQuickWhatIf(item, { start, end, existing = [] } = {}) {
  const fail = error => ({ ok: false, error })
  const type = item?.type
  const inWindow = d => isRealDate(d) && d >= start && d <= end

  if (type === 'expense' || type === 'income') {
    const amount = item.amount
    const c = typeof amount === 'number' ? parseCentsStrict(amount) : null
    if (c == null) return fail('Enter an amount with at most 2 decimals.')
    if (!(amount > 0) || amount > MAX_AMOUNT) return fail('Amount must be greater than 0.')
    if (!inWindow(item.date)) return fail(`Pick a real date from ${start} to ${end}.`)
    const label = String(item.label ?? '').trim()
    if (label.length < 1 || label.length > 60) return fail('Label must be 1 to 60 characters.')
    return { ok: true, error: null }
  }
  if (type === 'skipBill' || type === 'moveBill' || type === 'moveCard') {
    if (type === 'moveBill' || type === 'moveCard') {
      if (!inWindow(item.toDate)) return fail(`Pick a real date from ${start} to ${end}.`)
    }
    const key = occurrenceKey(item)
    if (existing.some(e => occurrenceKey(e) === key)) return fail('That payment already has a what-if')
    return { ok: true, error: null }
  }
  return fail('Unknown what-if type.')
}

const emptyDeltas = () => ({ deltas: {}, skippedIncome: 0, skippedOther: 0, applied: false })

export function scenarioMonthDeltas(scenario, adjustments, budgetCategories = []) {
  if (scenario?.state !== 'modeled') return emptyDeltas()
  const catById = new Map((budgetCategories ?? []).map(c => [c.id, c]))
  const cents = {}
  let skippedIncome = 0
  let skippedOther = 0
  for (const adj of adjustments ?? []) {
    if (isIncomeAdjustment(adj)) { skippedIncome += 1; continue }
    const cat = catById.get(adj.category_id)
    const group = String(adj.budget_categories?.group ?? cat?.group ?? '').trim().toLowerCase()
    if (group === 'transfers' || cat?.exclude_from_totals || adj.budget_categories?.exclude_from_totals) {
      skippedOther += 1
      continue
    }
    const k = `${adj.year}-${adj.month}`
    cents[k] = (cents[k] ?? 0) + toCents(cashEffect(adj))
  }
  const deltas = {}
  for (const [k, c] of Object.entries(cents)) deltas[k] = fromCents(c)
  return { deltas, skippedIncome, skippedOther, applied: true }
}

export function buildWhatIfParam(quickItems = [], monthDeltas = {}) {
  const param = { extraEvents: [], skipBills: [], moveBills: [], moveCards: [], monthDeltas: {} }
  for (const it of quickItems) {
    if (it.type === 'expense' || it.type === 'income') {
      param.extraEvents.push({
        id: it.id, date: it.date, direction: it.type === 'income' ? 'in' : 'out',
        amount: it.amount, label: String(it.label ?? '').trim(),
      })
    } else if (it.type === 'skipBill') param.skipBills.push({ billId: it.billId, ym: it.ym })
    else if (it.type === 'moveBill') param.moveBills.push({ billId: it.billId, ym: it.ym, toDate: it.toDate })
    else if (it.type === 'moveCard') param.moveCards.push({ cardId: it.cardId, dueYm: it.dueYm, toDate: it.toDate })
  }
  for (const [k, v] of Object.entries(monthDeltas ?? {})) if (v) param.monthDeltas[k] = v
  return param
}

export function hasWhatIf(param) {
  if (!param) return false
  return (param.extraEvents?.length ?? 0) > 0 || (param.skipBills?.length ?? 0) > 0
    || (param.moveBills?.length ?? 0) > 0 || (param.moveCards?.length ?? 0) > 0
    || Object.values(param.monthDeltas ?? {}).some(Boolean)
}
