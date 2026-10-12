import test from 'node:test'
import assert from 'node:assert/strict'
import {
  expectedAt,
  buildPlanSeries,
  investmentActual,
  validatePlan,
  latestSnapshots,
  planEndDate,
  captureOutlook,
  validateSnapshotAmounts,
} from '../src/lib/wealth/plans.js'
const plan = (extra = {}) => ({
  name: 'Baseline',
  start_date: '2027-01-01',
  start_balance: 10000,
  monthly_contribution: 1000,
  annual_return: 0,
  horizon: 5,
  retirement_target: 100000,
  emergency_cash_target: 30000,
  annual_contributions: {},
  annual_contributions_without_commitments: {},
  annual_commitment_drain: 0,
  include_commitments: true,
  starting_contributions_ytd: 0,
  ...extra,
})
test('baseline date and exact partial date, month end and full calendar year', () => {
  assert.equal(expectedAt(plan(), '2027-01-01').balance, 10000)
  assert.equal(expectedAt(plan(), '2027-01-16').balance, 10483.87)
  assert.equal(expectedAt(plan(), '2027-01-31').balance, 10967.74)
  assert.equal(expectedAt(plan(), '2027-12-31').balance, 21967.74)
  assert.equal(expectedAt(plan(), '2026-12-31'), null)
  assert.equal(expectedAt(plan(), '2032-01-02'), null)
})
test('leap date horizon clamps; mid-year YTD is unknown without explicit anchor', () => {
  assert.equal(planEndDate(plan({ start_date: '2024-02-29' })), '2029-02-28')
  const p = plan({ start_date: '2028-02-15', starting_contributions_ytd: null })
  assert.equal(expectedAt(p, '2028-02-29').balance, 10482.76)
  assert.equal(expectedAt(p, '2028-12-31').contributions_ytd, null)
  assert.equal(
    expectedAt({ ...p, starting_contributions_ytd: 200 }, '2028-02-29').contributions_ytd,
    682.76
  )
  assert.equal(expectedAt(p, '2029-01-31').contributions_ytd, 1000)
})
test('explicit actual zero and numeric DB strings accepted; missing component unknown', () => {
  assert.equal(investmentActual({ investment_balance: '0', retirement_balance: 0 }), 0)
  for (const v of [null, undefined, '', NaN, 'junk'])
    assert.equal(investmentActual({ investment_balance: v, retirement_balance: 20 }), null)
  assert.equal(investmentActual({ investment_balance: '123.45', retirement_balance: '20' }), 143.45)
})
test('calendar overrides avoid double drain, negative withdrawals clamp, assumptions stay frozen', () => {
  const p = plan({ annual_contributions: { 2027: 1200 }, annual_commitment_drain: 12000 })
  assert.equal(expectedAt(p, '2027-01-31').balance, 10096.77)
  assert.equal(expectedAt(plan({ monthly_contribution: -20000 }), '2027-01-31').balance, 0)
  const before = JSON.stringify(p)
  buildPlanSeries(p)
  assert.equal(JSON.stringify(p), before)
  const series = buildPlanSeries(p)
  assert.equal(series.monthly.filter((x) => x.date.startsWith('2028-')).length, 12)
})
test('real dates and strict API validation', () => {
  assert.equal(validatePlan(plan()).name, 'Baseline')
  for (const bad of [
    { start_date: '2027-02-29' },
    { start_date: '2027-13-01' },
    { horizon: 4 },
    { start_date: '2199-01-01' },
    { annual_return: 0.13 },
    { monthly_contribution: '20' },
    { annual_contributions: { x: 20 } },
    { annual_contributions: { 2027: Infinity } },
    { name: '' },
  ])
    assert.throws(() => validatePlan(plan(bad)))
})
test('actual selection excludes future and chooses most recent duplicate deterministically', () => {
  const rows = [
    { id: 'a', snapshot_date: '2027-07-01', created_at: '2027-07-01T01:00:00Z' },
    { id: 'b', snapshot_date: '2027-07-01', created_at: '2027-07-01T02:00:00Z' },
    { id: 'c', snapshot_date: '2027-08-01' },
  ]
  assert.deepEqual(
    latestSnapshots(rows, '2027-07-31').map((x) => x.id),
    ['b']
  )
})

test('calendar capture allocates positive savings only, keeps full withdrawals, rejects incomplete input', () => {
  const outlook = {
    columns: [{ year: 2027 }, { year: 2028 }],
    netSavings: [12000, -6000],
    commitments: [2000, 1000],
  }
  const captured = captureOutlook(outlook, 0.5)
  assert.deepEqual(captured, {
    withCommitments: { 2027: 6000, 2028: -6000 },
    withoutCommitments: { 2027: 7000, 2028: -5000 },
  })
  assert.equal(captureOutlook({ ...outlook, netSavings: [null, -6000] }), null)
  assert.equal(captureOutlook(outlook, 1.01), null)
  const p = plan({
    annual_contributions: captured.withCommitments,
    annual_contributions_without_commitments: captured.withoutCommitments,
    annual_commitment_drain: 1200,
  })
  assert.equal(expectedAt(p, '2027-01-31').balance, 10483.87)
  assert.equal(expectedAt(p, '2027-01-31', { withoutCommitments: true }).balance, 10564.52)
})
test('snapshot cash stays a subset, unknown balances stay null and negative deposits are valid', () => {
  assert.doesNotThrow(() =>
    validateSnapshotAmounts({
      other_assets: 1000,
      emergency_cash: 1000,
      investment_contributions_ytd: -200,
    })
  )
  assert.doesNotThrow(() =>
    validateSnapshotAmounts({ investment_balance: null, retirement_balance: 0 })
  )
  for (const invalid of [
    { other_assets: null, emergency_cash: 0 },
    { other_assets: 1000, emergency_cash: 1000.01 },
    { investment_balance: '100' },
    { retirement_balance: 0.001 },
    { emergency_cash: -1 },
  ])
    assert.throws(() => validateSnapshotAmounts(invalid))
})
test('end-of-day baseline has no first-date flow and next calendar year YTD resets', () => {
  const p = plan({ start_date: '2027-12-31', starting_contributions_ytd: 1200 })
  assert.equal(expectedAt(p, '2027-12-31').contributions_ytd, 1200)
  assert.equal(expectedAt(p, '2028-01-01').contributions_ytd, 32.26)
  assert.equal(expectedAt(p, '2028-01-31').contributions_ytd, 1000)
})
