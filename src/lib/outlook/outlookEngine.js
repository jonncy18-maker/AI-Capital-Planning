import { commitmentYearSchedule } from '../commitments/schedule.js'
import { parseLocalDate } from '../dates.js'

// Pure 5-year outlook math. No fetches: callers pass already-loaded inputs.
//
// Columns are nextYear..nextYear+4. Each expense group gets one annual number:
// the base-year group total compounded by the group's rate. Commitments are
// placed exactly (never inflated), one-off events and scenario adjustments are
// added in their own year only (never compounded).

export const OUTLOOK_YEARS = 5
export const DEFAULT_INFLATION = 0.03
export const DEFAULT_INCOME_GROWTH = 0.03

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const isIncomeGroup = g => (g || '').trim().toLowerCase() === 'income'
const isTransfersGroup = g => (g || '').trim().toLowerCase() === 'transfers'

// True for groups/categories that are not real spending: the Income group,
// Transfers, and any category flagged exclude_from_totals (the flag the rest of
// the app uses to drop transfers and card payments from totals).
function isExcludedFromSpend(group, category) {
  return isIncomeGroup(group) || isTransfersGroup(group) || !!category?.exclude_from_totals
}

// NEXT if it has a budget, else the current year if it does, else no outlook.
export function resolveBaseYear({ nextYear, curYear, hasNextBudget, hasCurBudget }) {
  if (hasNextBudget) return nextYear
  if (hasCurBudget) return curYear
  return null
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function sumBy(list, pred, pick) {
  let s = 0
  for (const item of list) if (pred(item)) s += num(pick(item))
  return s
}

export function groupRate(assumptions, group) {
  const override = assumptions?.group_rates?.[group]
  if (override != null && Number.isFinite(Number(override))) {
    return { rate: Number(override), isOverride: true }
  }
  const inflation = Number(assumptions?.inflation_rate)
  return { rate: Number.isFinite(inflation) ? inflation : DEFAULT_INFLATION, isOverride: false }
}

// baseGroups: { [group]: base annual amount } from the base-year budget,
// excluding commitment-linked line items (commitments are computed separately).
export function computeGroupBases({ baseLineItems = [], categories = [] }) {
  const catById = new Map(categories.map(c => [c.id, c]))
  const bases = {}
  // Seed every spendable group so groups with no base-year spend still get a
  // row (and can take events/adjustments/rates).
  for (const c of categories) {
    if (c.group && !isExcludedFromSpend(c.group, c)) bases[c.group] ??= 0
  }
  for (const li of baseLineItems) {
    if (li.commitment_id != null) continue
    const cat = catById.get(li.category_id)
    const group = li.budget_categories?.group ?? cat?.group
    if (!group) continue
    if (isExcludedFromSpend(group, cat ?? li.budget_categories)) continue
    bases[group] = (bases[group] ?? 0) + num(li.amount)
  }
  return bases
}

// Expense group names a scenario adjustment / event can target.
export function expenseGroups(categories = []) {
  const set = new Set()
  for (const c of categories) {
    if (c.group && !isExcludedFromSpend(c.group, c)) set.add(c.group)
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

function endedLabel(commitment) {
  const end = parseLocalDate(commitment.end_date)
  return `${MONTH_NAMES[end.getMonth()]} ${end.getFullYear()}`
}

// baseYear null -> { empty: true }.
// adjustments: committed scenarios' outlook adjustments (always in the baseline).
// selectedAdjustments: the picked modeled/idea scenario's, shown as a delta.
export function buildOutlook({
  nextYear,
  baseYear,
  baseLineItems = [],
  categories = [],
  commitments = [],
  takeHomeBase = null,
  assumptions = {},
  events = [],
  adjustments: allAdjustments = [],
  selectedAdjustments: allSelectedAdjustments = [],
}) {
  if (baseYear == null) return { empty: true, nextYear, baseYear: null }

  const years = Array.from({ length: OUTLOOK_YEARS }, (_, i) => nextYear + i)
  const columns = years.map(year => ({
    year,
    kind: baseYear === nextYear && year === nextYear ? 'detailed' : 'outlook',
  }))

  // The detailed column is a read-only roll-up of the real budget; outlook
  // adjustments (possible via the API) must not change it.
  const detailedYears = new Set(columns.filter(c => c.kind === 'detailed').map(c => c.year))
  const adjustments = allAdjustments.filter(a => !detailedYears.has(a.year))
  const selectedAdjustments = allSelectedAdjustments.filter(a => !detailedYears.has(a.year))

  const bases = computeGroupBases({ baseLineItems, categories })

  // A group that only appears on an event/adjustment still needs a row so the
  // amount is visible and totals reconcile with the rows shown.
  const inWindow = y => y >= years[0] && y <= years[years.length - 1]
  for (const a of [...adjustments, ...selectedAdjustments]) {
    if (inWindow(a.year) && a.group_name) bases[a.group_name] ??= 0
  }

  const groupNames = Object.keys(bases).sort((a, b) => a.localeCompare(b))

  const groups = groupNames.map(name => {
    const { rate, isOverride } = groupRate(assumptions, name)
    const cells = years.map(year => {
      const compounded = bases[name] * Math.pow(1 + rate, year - baseYear)
      const committedAdj = sumBy(adjustments, a => a.year === year && a.group_name === name, a => a.delta_amount)
      const scenarioDelta = sumBy(selectedAdjustments, a => a.year === year && a.group_name === name, a => a.delta_amount)
      return { amount: compounded + committedAdj, committedAdj, scenarioDelta }
    })
    return { name, base: bases[name], rate, isOverride, cells }
  })

  const commitmentTotals = years.map(year =>
    commitments.reduce((s, c) => s + commitmentYearSchedule(c, year).reduce((a, b) => a + b, 0), 0)
  )

  const commitmentEnds = years.map(year =>
    commitments
      .filter(c => c.end_date && parseLocalDate(c.end_date).getFullYear() === year - 1)
      .map(c => ({ id: c.id, name: c.name, ended: endedLabel(c) }))
  )

  const eventsByYear = years.map(year => {
    const items = events.filter(e => e.year === year)
    return { total: items.reduce((s, e) => s + num(e.amount), 0), items }
  })

  const takeHome = Number(takeHomeBase)
  const hasIncome = takeHomeBase != null && Number.isFinite(takeHome) && takeHome > 0
  const growth = Number.isFinite(Number(assumptions?.income_growth_rate))
    ? Number(assumptions.income_growth_rate)
    : DEFAULT_INCOME_GROWTH
  const income = years.map(year => (hasIncome ? takeHome * Math.pow(1 + growth, year - baseYear) : null))

  const groupTotals = years.map((_, i) => groups.reduce((s, g) => s + g.cells[i].amount, 0))
  const scenarioDeltaTotals = years.map((_, i) => groups.reduce((s, g) => s + g.cells[i].scenarioDelta, 0))

  // The group rows already contain committed adjustments, so net savings only
  // subtracts the group total, commitments and events.
  const netSavings = years.map((_, i) =>
    income[i] == null ? null : income[i] - groupTotals[i] - commitmentTotals[i] - eventsByYear[i].total
  )
  const netSavingsScenario = netSavings.map((n, i) => (n == null ? null : n - scenarioDeltaTotals[i]))

  return {
    empty: false,
    nextYear,
    baseYear,
    baseMode: baseYear === nextYear ? 'next' : 'current',
    columns,
    groups,
    income,
    commitments: commitmentTotals,
    commitmentEnds,
    events: eventsByYear,
    groupTotals,
    netSavings,
    netSavingsScenario,
    scenarioDeltaTotals,
  }
}

// Net savings for NEXT..NEXT+4 as a year -> amount map, only when every year
// has a number (otherwise the Wealth projection must not use a partial series).
export function outlookNetSavingsMap(outlook) {
  if (!outlook || outlook.empty) return null
  if (outlook.netSavings.some(n => n == null || !Number.isFinite(n))) return null
  return Object.fromEntries(outlook.columns.map((c, i) => [c.year, outlook.netSavings[i]]))
}

// Wealth projection inputs, keyed by projection year index (calendar year - curYear).
// Outlook net savings already net out commitments, so the "with commitments"
// series uses them as-is and the "without commitments" series adds that year's
// commitment total back. null unless every year has a net savings number.
export function outlookContributionMaps(outlook, curYear) {
  const net = outlookNetSavingsMap(outlook)
  if (!net) return null
  const withCommitments = {}
  const withoutCommitments = {}
  outlook.columns.forEach((c, i) => {
    const y = c.year - curYear
    withCommitments[y] = net[c.year]
    withoutCommitments[y] = net[c.year] + outlook.commitments[i]
  })
  return { withCommitments, withoutCommitments }
}

// { [group]: amount } for one year, for reference panels.
export function outlookGroupTargets(outlook, year) {
  if (!outlook || outlook.empty) return null
  const idx = outlook.columns.findIndex(c => c.year === year)
  if (idx < 0) return null
  const out = {}
  for (const g of outlook.groups) out[g.name] = g.cells[idx].amount
  return out
}

// Running cash cushion trajectory: starting cash + cumulative annual net savings.
// Returns cushion per year, min cushion, min index, buffer against floor, and pass status.
export function computeCushion({ netSavings = [], startCash = 0, floor = 25000 }) {
  const cushion = []
  let running = Number(startCash) || 0
  for (let i = 0; i < netSavings.length; i++) {
    const net = netSavings[i] == null ? 0 : Number(netSavings[i]) || 0
    running += net
    cushion.push(running)
  }
  let minCushion = cushion.length ? cushion[0] : running
  let minIndex = 0
  for (let i = 0; i < cushion.length; i++) {
    if (cushion[i] < minCushion) {
      minCushion = cushion[i]
      minIndex = i
    }
  }
  const buffer = minCushion - floor
  const isPass = minCushion >= floor
  return {
    cushion,
    minCushion,
    minIndex,
    buffer,
    isPass,
    floor,
    startCash,
  }
}

