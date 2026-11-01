// Read-only tools that assemble what a Pay Periods tab shows from db getters
// and the existing pure engines. Nothing here writes, and the engines are
// imported unchanged so the numbers match the UI.

import { getProfile } from '../../../db/profile.js'
import { getBills, getBillAmounts, getForecastAmountsForBills, splitBillsByPeriod } from '../../../db/bills.js'
import { getBudgetCategories } from '../../../db/budgetCategories.js'
import { getBudgetLineItems } from '../../../db/budgetLineItems.js'
import { getForecastLineItems } from '../../../db/forecastLineItems.js'
import { getCreditCards, getEarnRates, getCCSettings, buildEarnRateMap } from '../../../db/creditCards.js'
import { buildMonthSlots, loadOutflowSeries, loadInflowSeries } from '../../../payperiods/cashSeries.js'
import { routeForecastToCards, computeStatementForecast, projectedBillAmounts, statementDueIn } from '../../../cashflow/cashflowEngine.js'
import { toCents, fromCents } from '../../../money.js'
import { toYear, toMonth } from '../helpers.js'

const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

async function loadPlannerInputs(userId) {
  const [profile, bills, creditCards, budgetCategories, rates, ccSettings] = await Promise.all([
    getProfile(userId),
    getBills(userId),
    getCreditCards(userId),
    getBudgetCategories(userId),
    getEarnRates(userId),
    getCCSettings(userId),
  ])
  return {
    profile, bills, creditCards, budgetCategories,
    earnRateMap: buildEarnRateMap(rates),
    ccCoverage: ccSettings.coveragePct,
    ccOptimization: ccSettings.optimizationPct,
    payDay2: profile?.pay_day_2 ?? 30,
  }
}

function periodView(list) {
  return {
    total: fromCents(list.reduce((n, b) => n + toCents(b.resolvedAmount ?? 0), 0)),
    bills: list.map(b => ({
      id: b.id, name: b.name, pay_day: b.pay_day, amount: b.resolvedAmount, credit_card_id: b.credit_card_id ?? null,
    })),
  }
}

export const computedTools = [
  {
    name: 'get_pay_period_cash_series',
    group: 'computed',
    write: false,
    schema: {
      name: 'get_pay_period_cash_series',
      description:
        'The Pay periods Cash flow tab as data: for each month of the current year, money in (stored actual, ' +
        'live pull or income forecast), bill outflow split into the two pay periods, and net. Elapsed months use actuals, ' +
        'the current and future months use the forecast.',
      input_schema: { type: 'object', properties: {} },
    },
    async execute(userId) {
      const i = await loadPlannerInputs(userId)
      const [outflow, inflow] = await Promise.all([
        loadOutflowSeries({
          userId, bills: i.bills, payDay2: i.payDay2, creditCards: i.creditCards,
          budgetCategories: i.budgetCategories, earnRateMap: i.earnRateMap,
          ccCoverage: i.ccCoverage, ccOptimization: i.ccOptimization,
        }),
        loadInflowSeries({ userId, profile: i.profile, budgetCategories: i.budgetCategories }),
      ])
      const inflowByKey = new Map(inflow.map(s => [`${s.year}-${s.month}`, s]))
      const months = outflow.map(o => {
        const slot = inflowByKey.get(`${o.year}-${o.month}`) ?? { inflow: 0, inflowIsActual: false, inflowKind: 'none' }
        const out = o.period1Total + o.period2Total
        return {
          key: `${o.year}-${pad(o.month)}`,
          label: o.label,
          isFuture: o.isFuture,
          isCurrent: o.isCurrent,
          inflow: slot.inflow,
          inflow_kind: slot.inflowKind,
          period1_outflow: o.period1Total,
          period2_outflow: o.period2Total,
          outflow: out,
          net: slot.inflow - out,
        }
      })
      return {
        summary: `Cash series for ${buildMonthSlots().currentYear}`,
        result: { pay_day_2: i.payDay2, cc_coverage_pct: i.ccCoverage, cc_optimization_pct: i.ccOptimization, months },
      }
    },
  },

  {
    name: 'get_pay_period_schedule',
    group: 'computed',
    write: false,
    schema: {
      name: 'get_pay_period_schedule',
      description:
        'The Pay periods Schedule for one month: bills due in period 1 (before the second pay day) and period 2 with their ' +
        'resolved amounts (manual amount, forecast, or projected credit-card statement), plus each credit card\'s projected statement ' +
        'payment due that month.',
      input_schema: {
        type: 'object',
        properties: { year: { type: 'integer' }, month: { type: 'integer', description: '1-12.' } },
        required: ['year', 'month'],
      },
    },
    async execute(userId, input) {
      const year = toYear(input.year)
      const month = toMonth(input.month)
      const i = await loadPlannerInputs(userId)
      const [amounts, forecastAmountsMap, lineItems, forecastLines] = await Promise.all([
        getBillAmounts(userId, year, month),
        getForecastAmountsForBills(userId, year, month, i.bills),
        getBudgetLineItems(userId, { year }),
        getForecastLineItems(userId, year),
      ])
      const cashflow = routeForecastToCards({
        budgetCategories: i.budgetCategories, lineItems, forecastLines,
        cards: i.creditCards, earnRateMap: i.earnRateMap,
        coveragePct: i.ccCoverage, optimizationPct: i.ccOptimization, year,
      })
      const statementsByCard = computeStatementForecast({ cardDollarsByMonth: cashflow.cardDollarsByMonth, cards: i.creditCards, year })
      const cardStatementMap = projectedBillAmounts({ bills: i.bills, statementsByCard, year, month })
      const amountsMap = Object.fromEntries(amounts.map(a => [a.bill_id, a.amount]))
      const scheduleBills = i.bills.filter(b => !b.exclude_from_schedule)
      const { period1, period2 } = splitBillsByPeriod(scheduleBills, amountsMap, i.payDay2 - 1, forecastAmountsMap, cardStatementMap)

      const statements = i.creditCards.map(card => {
        const due = statementDueIn(statementsByCard?.[card.id], year, month)
        return due
          ? { card_id: card.id, card: card.name, balance: due.balance, close_date: ymd(due.closeDate), due_date: ymd(due.dueDate) }
          : null
      }).filter(Boolean)

      return {
        summary: `Pay period schedule for ${year}-${pad(month)}`,
        result: { year, month, pay_day_2: i.payDay2, period1: periodView(period1), period2: periodView(period2), card_statements_due: statements },
      }
    },
  },
]
