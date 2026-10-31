// Gathers the inputs for buildWeeklyCashSeries (weeklyCashSeries.js). Read-only:
// nothing here writes to bills, amounts, income or the profile.
//
// Outflow sourcing keeps every dollar in exactly one stream:
//   - a checking bill linked to a card with a statement close day is replaced by
//     that card's statement payment (bill leaves the bill stream);
//   - card-routed spend lives only in the statements;
//   - cash spend is the non-card remainder, minus categories already paid as bills.

import { toCents, fromCents } from '../money.js'
import {
  getBillAmountsRange, getForecastAmountsForBills, resolveBillAmount,
} from '../db/bills.js'
import { getBudgetLineItems } from '../db/budgetLineItems.js'
import { getForecastLineItems } from '../db/forecastLineItems.js'
import { estimateNet } from '../db/taxBrackets.js'
import { monthlyNetForecast } from './incomeForecast.js'
import { routeForecastToCards } from '../cashflow/cashflowEngine.js'
import { addDays, mondayOnOrBefore, resolvePayDays } from './weeklyCashSeries.js'

const MAX_WEEKS = 13

function ymParts(ymd) {
  const [y, m] = ymd.split('-').map(Number)
  return { y, m }
}

function monthRange(fromYmd, toYmd, leadMonths) {
  let { y, m } = ymParts(fromYmd)
  m -= leadMonths
  while (m < 1) { m += 12; y -= 1 }
  const end = ymParts(toYmd)
  const out = []
  while (y < end.y || (y === end.y && m <= end.m)) {
    out.push({ y, m })
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  return out
}

export async function loadWeeklyCashInputs({
  userId, profile, bills = [], accounts = [], creditCards = [], budgetCategories = [],
  earnRateMap = {}, ccCoverage = 80, ccOptimization = 100, today, anchorAsOf = null,
}) {
  const warnings = []
  const primary = accounts.find(a => a.is_primary_checking && a.type === 'checking') ?? null

  const start = mondayOnOrBefore(today)
  const end = addDays(start, MAX_WEEKS * 7 - 1)
  const earliest = anchorAsOf && anchorAsOf < start ? anchorAsOf : start
  const allMonths = monthRange(earliest, end, 3)
  const billMonths = monthRange(earliest, end, 0)
  const years = [...new Set(allMonths.map(({ y }) => y))]
  const key = (y, m) => `${y}-${m}`

  // ── Bill stream: active bills debiting primary checking ──────────────────
  const active = bills.filter(b => b.active !== false)
  const otherAccount = active.filter(b => b.debits_from_account_id && b.debits_from_account_id !== primary?.id)
  if (otherAccount.length > 0) {
    warnings.push(`Not counted (paid from another account): ${otherAccount.map(b => b.name).join(', ')}`)
  }
  const checkingBills = active.filter(b => !b.debits_from_account_id || b.debits_from_account_id === primary?.id)

  const linkedCardIds = new Set(checkingBills.map(b => b.credit_card_id).filter(Boolean))
  const timingCards = creditCards.filter(c => c.statement_close_day && linkedCardIds.has(c.id))
  const timingIds = new Set(timingCards.map(c => c.id))
  for (const c of creditCards) {
    if (!linkedCardIds.has(c.id)) warnings.push(`${c.name} has no linked bill; not counted`)
    else if (!c.statement_close_day) warnings.push(`${c.name}: no statement close day; using bill amount`)
  }
  const streamBills = checkingBills.filter(b => !(b.credit_card_id && timingIds.has(b.credit_card_id)))

  // ── Forecast routing per year (full categories, same as the planner) ─────
  const cardSpendByMonth = {}
  for (const c of timingCards) cardSpendByMonth[c.id] = {}
  const cashSpendByMonth = {}
  const billCategoryIds = new Set(checkingBills.map(b => b.forecast_category_id).filter(Boolean))
  const categoryById = new Map(budgetCategories.map(c => [c.id, c]))
  const overlapWarned = new Set()

  for (const b of checkingBills) {
    const cat = b.forecast_category_id ? categoryById.get(b.forecast_category_id) : null
    if (cat && !cat.cash_only && !overlapWarned.has(cat.id)) {
      overlapWarned.add(cat.id)
      warnings.push(`${cat.category} is paid as a bill and also routed to cards; card statements may include it`)
    }
  }

  await Promise.all(years.map(async year => {
    const [lineItems, forecastLines] = await Promise.all([
      getBudgetLineItems(userId, { year }),
      getForecastLineItems(userId, year),
    ])
    if (lineItems.length === 0 && forecastLines.length === 0) {
      warnings.push(`No forecast for ${year}: card statements and spend for ${year} project as $0`)
    }
    const cashflow = routeForecastToCards({
      budgetCategories, lineItems, forecastLines,
      cards: creditCards, earnRateMap,
      coveragePct: ccCoverage, optimizationPct: ccOptimization,
    })
    for (let m = 1; m <= 12; m++) {
      for (const c of timingCards) {
        cardSpendByMonth[c.id][key(year, m)] = cashflow.cardDollarsByMonth[c.id]?.[m] ?? 0
      }
      let cents = 0
      for (const row of cashflow.cashDetailByMonth[m] ?? []) {
        const cat = categoryById.get(row.categoryId)
        const group = String(row.group ?? cat?.group ?? '').toLowerCase()
        if (billCategoryIds.has(row.categoryId)) continue
        if (cat?.exclude_from_totals) continue
        if (group === 'income' || group === 'transfers') continue
        cents += toCents(row.amount)
      }
      cashSpendByMonth[key(year, m)] = fromCents(cents)
    }
  }))

  // ── Manual bill amounts, variable-bill fallback, forecast-linked amounts ──
  const rows = await getBillAmountsRange(userId, years[0], years[years.length - 1])
  const manual = {}
  for (const r of rows) {
    const k = key(r.year, r.month)
    ;(manual[k] ??= {})[r.bill_id] = r.amount
  }

  const todayParts = ymParts(today)
  const latest = {}
  const pastRows = rows
    .filter(r => r.year < todayParts.y || (r.year === todayParts.y && r.month <= todayParts.m))
    .sort((a, b) => (a.year !== b.year ? b.year - a.year : b.month - a.month))
  for (const r of pastRows) {
    if (latest[r.bill_id] === undefined && r.amount != null) latest[r.bill_id] = r.amount
  }
  const variableFallback = {}
  for (const b of streamBills) {
    if (b.fixed_amount == null && !b.forecast_category_id && latest[b.id] != null) {
      variableFallback[b.id] = latest[b.id]
    }
  }

  const forecastAmounts = {}
  if (streamBills.some(b => b.forecast_category_id)) {
    await Promise.all(billMonths.map(async ({ y, m }) => {
      forecastAmounts[key(y, m)] = await getForecastAmountsForBills(userId, y, m, streamBills)
    }))
  }

  const billAmountsByMonth = {}
  for (const { y, m } of billMonths) {
    const k = key(y, m)
    const perBill = {}
    for (const b of streamBills) {
      const amt = resolveBillAmount(b, manual[k] ?? {}, { ...variableFallback, ...(forecastAmounts[k] ?? {}) }, {})
      perBill[b.id] = amt == null ? null : Number(amt)
    }
    billAmountsByMonth[k] = perBill
  }

  // Manual amounts on a card's linked bill, keyed by the bill's (due) month.
  const cardManualByMonth = {}
  for (const c of timingCards) {
    cardManualByMonth[c.id] = {}
    const linked = checkingBills.filter(b => b.credit_card_id === c.id && b.fixed_amount == null)
    for (const { y, m } of allMonths) {
      const k = key(y, m)
      for (const b of linked) {
        const v = manual[k]?.[b.id]
        if (v != null && cardManualByMonth[c.id][k] === undefined) cardManualByMonth[c.id][k] = Number(v)
      }
    }
  }

  // ── Income ────────────────────────────────────────────────────────────────
  const monthlyNetByYear = {}
  if (Number(profile?.annual_income) > 0) {
    const tp = profile.tax_profile || {}
    await Promise.all(years.map(async year => {
      const est = await estimateNet({
        grossIncome: Number(profile.annual_income) || 0,
        bonus: Number(profile.annual_bonus) || 0,
        filingStatus: tp.filingStatus || 'single',
        state: tp.state || null,
        stateRateOverride: tp.stateRateOverride ?? null,
        preTaxDeductions: (Number(tp.preTax401k) || 0) + (Number(tp.preTaxOther) || 0),
        year,
      }).catch(() => null)
      monthlyNetByYear[year] = monthlyNetForecast(profile, est)
    }))
  } else {
    for (const year of years) monthlyNetByYear[year] = null
  }

  return {
    payDays: resolvePayDays(profile).days,
    monthlyNetByYear,
    bonusMonth: profile?.bonus_month ?? null,
    bills: streamBills,
    billAmountsByMonth,
    cards: timingCards,
    cardSpendByMonth,
    cardManualByMonth,
    cashSpendByMonth,
    warnings,
  }
}
