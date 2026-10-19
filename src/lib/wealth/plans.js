import { validateAssumptions } from './assumptions.js'
import { toCents, fromCents, mulCents, allocateCents, parseCentsStrict } from '../money.js'

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return (
    Number.isFinite(d.getTime()) &&
    d.toISOString().slice(0, 10) === value &&
    +value.slice(0, 4) >= 2000 &&
    +value.slice(0, 4) <= 2200
  )
}
const iso = (d) => d.toISOString().slice(0, 10)
const date = (s) => new Date(`${s}T00:00:00Z`)
const days = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
export function planEndDate(plan) {
  const d = date(plan.start_date),
    year = d.getUTCFullYear() + Number(plan.horizon),
    month = d.getUTCMonth()
  return iso(new Date(Date.UTC(year, month, Math.min(d.getUTCDate(), days(year, month)))))
}
function money(value, field, { nullable = false, negative = false } = {}) {
  if (value == null && nullable) return null
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    Math.abs(value) > 1e9 ||
    (!negative && value < 0) ||
    parseCentsStrict(value) == null
  )
    throw new Error(
      `${field} must be a finite ${negative ? '' : 'nonnegative '}amount with at most two decimals (maximum $1 billion).`
    )
  return value
}
function map(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${field} must be a calendar-year map.`)
  const out = {}
  for (const [year, amount] of Object.entries(value)) {
    if (!/^\d{4}$/.test(year) || +year < 2000 || +year > 2200)
      throw new Error(`${field} has an invalid year.`)
    out[year] = money(amount, field, { negative: true })
  }
  return out
}
export function validatePlan(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new Error('Expected a plan object.')
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100)
    throw new Error('Plan name is required (up to 100 characters).')
  if (!validDate(body.start_date))
    throw new Error('Start date must be a real YYYY-MM-DD calendar date.')
  if (!Number.isInteger(body.horizon) || body.horizon < 5 || body.horizon > 40)
    throw new Error('Horizon must be 5–40 years.')
  if (+body.start_date.slice(0, 4) + body.horizon > 2200)
    throw new Error('The saved horizon must end by 2200.')
  if (
    typeof body.annual_return !== 'number' ||
    !Number.isFinite(body.annual_return) ||
    body.annual_return < 0 ||
    body.annual_return > 0.25
  )
    throw new Error('Annual return must be between 0 and 25%.')
  if (typeof body.include_commitments !== 'boolean')
    throw new Error('Choose whether commitments are included.')
  return {
    name: body.name.trim(),
    start_date: body.start_date,
    horizon: body.horizon,
    annual_return: body.annual_return,
    start_balance: money(body.start_balance, 'Starting balance'),
    monthly_contribution: money(body.monthly_contribution, 'Monthly contribution', {
      negative: true,
    }),
    retirement_target: money(body.retirement_target, 'Retirement target'),
    emergency_cash_target: money(body.emergency_cash_target, 'Emergency cash target', {
      nullable: true,
    }),
    starting_contributions_ytd: money(
      body.starting_contributions_ytd,
      'Starting YTD contributions',
      { nullable: true, negative: true }
    ),
    annual_commitment_drain: money(body.annual_commitment_drain, 'Commitment drain'),
    include_commitments: body.include_commitments,
    annual_contributions: map(body.annual_contributions, 'Annual contributions'),
    annual_contributions_without_commitments: map(
      body.annual_contributions_without_commitments,
      'Contributions without commitments'
    ),
    assumptions: body.assumptions == null ? null : validateAssumptions(body.assumptions),
  }
}
export function investmentActual(snapshot) {
  const a = parseCentsStrict(snapshot?.investment_balance),
    b = parseCentsStrict(snapshot?.retirement_balance)
  return a == null || b == null ? null : fromCents(a + b)
}
export function optionalActual(value) {
  const cents = parseCentsStrict(value)
  return cents == null ? null : fromCents(cents)
}
export function latestSnapshots(rows, today = iso(new Date())) {
  const sorted = [...rows]
    .filter((s) => validDate(s.snapshot_date) && s.snapshot_date <= today)
    .sort(
      (a, b) =>
        b.snapshot_date.localeCompare(a.snapshot_date) ||
        String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')) ||
        String(b.id).localeCompare(String(a.id))
    )
  return sorted.filter((s, i) => i === 0 || sorted[i - 1].snapshot_date !== s.snapshot_date)
}
function monthlyFlow(plan, y, m, without) {
  const overrides = without
    ? plan.annual_contributions_without_commitments
    : plan.annual_contributions
  if (overrides?.[y] != null) return allocateCents(toCents(overrides[y]), 12)[m]
  const drain =
    !without && plan.include_commitments
      ? allocateCents(toCents(plan.annual_commitment_drain), 12)[m]
      : 0
  return toCents(plan.monthly_contribution) - drain
}
export function expectedAt(plan, at, { withoutCommitments = false } = {}) {
  if (!validDate(at) || at < plan.start_date || at > planEndDate(plan)) return null
  const start = date(plan.start_date),
    end = date(at)
  let balance = toCents(plan.start_balance),
    since = 0,
    ytd = 0
  let cursor = start,
    anchor =
      plan.starting_contributions_ytd == null
        ? plan.start_date.endsWith('-01-01')
          ? 0
          : null
        : toCents(plan.starting_contributions_ytd)
  while (cursor < end || (cursor.getTime() === end.getTime() && cursor !== start)) {
    const year = cursor.getUTCFullYear(),
      month = cursor.getUTCMonth(),
      day = cursor.getUTCDate()
    const monthEnd = new Date(Date.UTC(year, month + 1, 0)),
      stop = monthEnd < end ? monthEnd : end
    const fraction = (stop.getUTCDate() - (cursor === start ? day : 0)) / days(year, month)
    const flow = mulCents(monthlyFlow(plan, year, month, withoutCommitments), fraction)
    balance = Math.max(
      0,
      mulCents(balance, Math.pow(1 + Number(plan.annual_return) / 12, fraction)) + flow
    )
    since += flow
    ytd += flow
    if (stop.getTime() === end.getTime()) break
    cursor = new Date(Date.UTC(year, month + 1, 1))
    if (cursor.getUTCFullYear() !== year) {
      ytd = 0
      anchor = 0
    }
  }
  return {
    date: at,
    balance: fromCents(balance),
    contribution: fromCents(since),
    contributions_ytd: anchor == null ? null : fromCents(anchor + ytd),
  }
}
export function buildPlanSeries(plan, options) {
  const end = planEndDate(plan),
    start = date(plan.start_date),
    monthly = [expectedAt(plan, plan.start_date, options)],
    annual = []
  let y = start.getUTCFullYear(),
    m = start.getUTCMonth()
  while (true) {
    const at = iso(new Date(Date.UTC(y, m + 1, 0)))
    if (at > end) break
    if (at > plan.start_date) monthly.push(expectedAt(plan, at, options))
    if (m === 11) annual.push(expectedAt(plan, at, options))
    m++
    if (m === 12) {
      m = 0
      y++
    }
  }
  if (monthly.at(-1).date !== end) monthly.push(expectedAt(plan, end, options))
  return { monthly, annual, end_date: end }
}
export function captureOutlook(outlook, allocation = 1) {
  const withCommitments = {},
    withoutCommitments = {}
  if (
    !outlook ||
    outlook.empty ||
    !Number.isFinite(allocation) ||
    allocation < 0 ||
    allocation > 1 ||
    !Array.isArray(outlook.columns) ||
    !outlook.columns.length ||
    !Array.isArray(outlook.netSavings) ||
    outlook.netSavings.length !== outlook.columns.length ||
    outlook.netSavings.some((n) => !Number.isFinite(n)) ||
    !Array.isArray(outlook.commitments) ||
    outlook.commitments.length !== outlook.columns.length ||
    outlook.commitments.some((n) => !Number.isFinite(n))
  )
    return null
  outlook.columns.forEach((c, i) => {
    const allocate = (n) => fromCents(mulCents(toCents(n), n > 0 ? allocation : 1))
    withCommitments[c.year] = allocate(outlook.netSavings[i])
    withoutCommitments[c.year] = allocate(outlook.netSavings[i] + (outlook.commitments[i] ?? 0))
  })
  return { withCommitments, withoutCommitments }
}

export function validateSnapshotAmounts(snapshot) {
  for (const field of [
    'net_worth',
    'investment_balance',
    'retirement_balance',
    'other_assets',
    'liabilities',
    'emergency_cash',
    'investment_contributions_ytd',
  ]) {
    money(snapshot[field], field, {
      nullable: true,
      negative: field === 'net_worth' || field === 'investment_contributions_ytd',
    })
  }
  if (
    snapshot.emergency_cash != null &&
    (snapshot.other_assets == null || snapshot.emergency_cash > snapshot.other_assets)
  ) {
    throw new Error(
      'Emergency cash must be included in a known other-assets balance and cannot exceed it.'
    )
  }
}
