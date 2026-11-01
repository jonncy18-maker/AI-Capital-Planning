// Pure: walks the typed checking balance back through real Monarch transactions
// to give WEEKS four weeks of actual history. No I/O; checkingHistoryLoader.js
// fetches the rows. Dates are 'YYYY-MM-DD' strings, arithmetic is on day numbers
// (see weeklyCashSeries.js), money is integer cents internally and dollars out.
//
// Honesty rules: a week with missing data is a gap with a reason, never a guess;
// history never walks forward from an old anchor (the projection's carriedIn owns
// that period); transactions are never deduped or dropped.

import { toCents, fromCents, formatMoney } from '../money.js'
import { addDays, clampDay } from './weeklyCashSeries.js'

export const HISTORY_WEEKS = 4
export const RECONCILE_WINDOW_DAYS = 3

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const TX_CAP = 100

export function reconcileToleranceCents(snapshotC) {
  return Math.max(2500, Math.round(Math.abs(snapshotC) * 0.01))
}

const nameKey = v => String(v ?? '').trim().toLowerCase()

export function monarchAccountOptions(transactions) {
  const counts = new Map()
  for (const t of transactions ?? []) {
    const name = String(t?.account ?? '').trim()
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

// Manual balance snapshots, dated by the planner's own period semantics.
export function snapshotCheckpoints(balanceRows, accountId, profile) {
  const d1 = profile?.pay_day_1 ?? 15
  const d2 = profile?.pay_day_2 ?? 30
  const out = []
  for (const r of balanceRows ?? []) {
    if (r?.account_id !== accountId || r.balance == null) continue
    const balance = Number(r.balance)
    if (!Number.isFinite(balance)) continue
    const y = Number(r.year)
    const m = Number(r.month)
    const half = Number(r.period_half)
    const day = clampDay(y, m, half === 1 ? d1 : d2)
    const date = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    out.push({ date, balance, label: `${MONTH_ABBR[m - 1]} period ${half} snapshot` })
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

export function buildCheckingHistory({
  today, start, anchor = null, accountName = null, transactions = [], checkpoints = [], fetchFrom,
}) {
  const hasName = !!accountName && accountName.trim() !== ''
  const wanted = hasName ? nameKey(accountName) : null
  const hasAnchor = !!anchor && anchor.asOfDate != null && Number.isFinite(Number(anchor.balance))
  const asOf = hasAnchor ? anchor.asOfDate : null
  const anchorC = hasAnchor ? toCents(anchor.balance) : 0

  const rows = (transactions ?? []).map((t, i) => ({
    date: String(t.date).slice(0, 10), amountC: toCents(t.amount), account: String(t.account ?? ''),
    merchant: String(t.merchant ?? ''), order: i,
  }))
  const mapped = hasName ? rows.filter(r => nameKey(r.account) === wanted) : []

  // One Monarch sync imports every account, so coverage is global: a quiet
  // checking account looks the same as an unsynced one.
  let coverage = null
  for (const r of rows) if (r.date <= today && (coverage == null || r.date > coverage)) coverage = r.date

  let status = 'ok'
  let globalGap = null
  if (!hasName) { status = 'no-mapping'; globalGap = 'Map your Monarch checking account to see history' }
  else if (!hasAnchor) { status = 'no-anchor'; globalGap = 'Enter a balance to see history' }
  else if (mapped.length === 0) {
    status = 'no-transactions'; globalGap = `No transactions for "${accountName.trim()}" since ${fetchFrom}`
  } else if (coverage == null || coverage < asOf) {
    status = 'not-synced'
    globalGap = `Transactions synced through ${coverage ?? 'never'}; your balance is as of ${asOf}. Sync Monarch${coverage == null ? '.' : ` or use an as-of date on or before ${coverage}.`}`
  }

  const balanceAtC = day => {
    let sum = 0
    for (const r of mapped) if (r.date > day && r.date <= asOf) sum += r.amountC
    return anchorC - sum
  }

  // Same amount on the same day under different merchants may be one charge
  // imported twice. Flagged only; both rows stay in every total.
  const groups = new Map()
  for (const r of mapped) {
    const k = `${r.date}|${r.amountC}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(r)
  }
  const possibleDuplicates = []
  for (const list of groups.values()) {
    const seen = new Map()
    for (const r of list) {
      const k = nameKey(r.merchant)
      if (!seen.has(k)) seen.set(k, r.merchant.trim())
    }
    if (list.length >= 2 && seen.size >= 2) {
      possibleDuplicates.push({ date: list[0].date, amount: fromCents(list[0].amountC), merchants: [...seen.values()] })
    }
  }
  possibleDuplicates.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const dupReason = d => `Possible duplicate on ${d.date}: ${d.merchants.join(' / ')}`

  // Reconciliation against manual snapshots near the history window.
  const reconciliation = []
  let failed = null
  if (status === 'ok') {
    const covered = day => day >= addDays(fetchFrom, -1)
    for (const cp of checkpoints ?? []) {
      if (cp.date < addDays(start, -28) || cp.date > asOf) continue
      const wStart = addDays(cp.date, -RECONCILE_WINDOW_DAYS)
      const wEnd = addDays(cp.date, RECONCILE_WINDOW_DAYS) < asOf ? addDays(cp.date, RECONCILE_WINDOW_DAYS) : asOf
      if (!covered(wStart)) continue
      let lo = Infinity
      let hi = -Infinity
      for (let d = wStart; d <= wEnd; d = addDays(d, 1)) {
        const b = balanceAtC(d)
        if (b < lo) lo = b
        if (b > hi) hi = b
      }
      const snapC = toCents(cp.balance)
      const diffC = snapC >= lo && snapC <= hi ? 0 : snapC < lo ? lo - snapC : snapC - hi
      const ok = diffC <= reconcileToleranceCents(snapC)
      reconciliation.push({
        date: cp.date, label: cp.label, snapshot: fromCents(snapC), lo: fromCents(lo), hi: fromCents(hi),
        diff: fromCents(diffC), ok,
      })
      if (!ok && !failed) failed = reconciliation[reconciliation.length - 1]
    }
  }

  const points = []
  for (let i = -HISTORY_WEEKS; i <= -1; i++) {
    const weekStart = addDays(start, 7 * i)
    const weekEnd = addDays(weekStart, 6)
    const inWeek = mapped.filter(r => r.date >= weekStart && r.date <= weekEnd)

    let balance = null
    let gap = true
    let gapReason = globalGap
    if (!gapReason && weekEnd > asOf) {
      gapReason = `After your as-of date (${asOf}); the projection covers this period`
    }
    if (!gapReason) { balance = fromCents(balanceAtC(weekEnd)); gap = false }

    const approxReasons = []
    if (!gap) {
      for (const d of possibleDuplicates) if (d.date > weekEnd && d.date <= asOf) approxReasons.push(dupReason(d))
      if (failed) {
        approxReasons.push(`Off from your ${failed.label} (${formatMoney(failed.snapshot, { decimals: 2 })}) by ${formatMoney(failed.diff, { decimals: 2 })}`)
      }
    }

    let net = null
    let inflow = null
    let outflow = null
    let netGapReason = null
    if (!hasName) netGapReason = 'Map your Monarch checking account to see history'
    else if (mapped.length === 0) netGapReason = `No transactions for "${accountName.trim()}" since ${fetchFrom}`
    else if (coverage == null || coverage < weekEnd) {
      netGapReason = `Transactions synced through ${coverage ?? 'never'}; this week ended ${weekEnd}`
    } else {
      let pos = 0
      let neg = 0
      for (const r of inWeek) { if (r.amountC > 0) pos += r.amountC; else neg += -r.amountC }
      net = fromCents(pos - neg); inflow = fromCents(pos); outflow = fromCents(neg)
    }
    const netReasons = net == null
      ? []
      : possibleDuplicates.filter(d => d.date >= weekStart && d.date <= weekEnd).map(dupReason)

    points.push({
      index: i, weekStart, weekEnd, balance, gap, gapReason: gap ? gapReason : null,
      approximate: approxReasons.length > 0, approxReasons,
      net, inflow, outflow, netGapReason, netApproximate: netReasons.length > 0,
      transactions: inWeek
        .slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order))
        .slice(0, TX_CAP)
        .map(r => ({ date: r.date, amount: fromCents(r.amountC), merchant: r.merchant })),
    })
  }

  return {
    status, coverageThrough: coverage, accountName: hasName ? accountName.trim() : null,
    points, reconciliation, possibleDuplicates,
    approximate: points.some(p => p.approximate),
  }
}
