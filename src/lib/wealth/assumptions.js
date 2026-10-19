// Editable Wealth Trajectory assumptions: defaults, index-return presets and
// validation. The set is stored as one jsonb object on an immutable wealth_plans
// row, so a changed assumption is always a new plan version.

export const PROJECTION_END_AGE = 65

// S&P 500 nominal total returns (Damodaran data via clark.com). Stored with an
// as-of date and edited by hand; nothing here is scraped live.
export const INDEX_PRESETS = [
  {
    key: '5y',
    label: '5-year',
    rate: 0.1116,
    as_of: '2026-10-17',
    source: 'https://clark.com/sp-500-return-calculator/',
  },
  {
    key: '10y',
    label: '10-year',
    rate: 0.1467,
    as_of: '2026-10-17',
    source: 'https://clark.com/sp-500-return-calculator/',
  },
  {
    key: '30y',
    label: '30-year',
    rate: 0.0991,
    as_of: '2026-10-17',
    source: 'https://clark.com/sp-500-return-calculator/',
  },
]

export function defaultAssumptions() {
  return {
    version: 1,
    current_age: 32,
    retirement_age: 60,
    retirement_spend: 105000,
    withdrawal_multiple: 25,
    inflation: 0.03,
    return_mode: 'manual',
    manual_return: 0.07,
    index_preset: '10y',
    presets: INDEX_PRESETS.map((p) => ({ ...p })),
    scenarios: [
      { name: 'Base −2%', delta: -0.02 },
      { name: 'Base +2%', delta: 0.02 },
    ],
    pay_growth: 0.03,
    spend_growth: 0.03,
    caps: { year: 2026, k401: 24500, ira: 7500, hsa: 4400, growth: 0.03 },
    employee_401k: 24178,
    match_rate: 0.25,
    catch_up: {
      enabled: false,
      age_50: 50,
      age_hsa: 55,
      k401: 8000,
      ira: 1100,
      hsa: 1000,
    },
    emergency: { target: 30000, current: 0 },
    surplus: { base: 10000, source: 'manual' },
    surplus_by_year: {},
  }
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value
}
function fail(message) {
  throw new Error(message)
}
function obj(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${field} is required.`)
  return value
}
function num(value, field, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    fail(`${field} must be between ${min} and ${max}.`)
  return value
}
function int(value, field, min, max) {
  if (!Number.isInteger(value) || value < min || value > max)
    fail(`${field} must be a whole number between ${min} and ${max}.`)
  return value
}
const dollars = (value, field, min = 0) => num(value, field, min, 1e9)

export function validateAssumptions(input) {
  const a = obj(input, 'Assumptions')
  if (a.version !== 1) fail('Unsupported assumptions version.')
  const current_age = int(a.current_age, 'Current age', 18, 80)
  const retirement_age = int(a.retirement_age, 'Retirement age', 40, 75)
  if (retirement_age <= current_age) fail('Retirement age must be after the current age.')
  if (a.return_mode !== 'index' && a.return_mode !== 'manual')
    fail('Return mode must be index or manual.')
  if (!Array.isArray(a.presets) || a.presets.length > 10) fail('Index presets must be a list.')
  const presets = a.presets.map((p, i) => {
    obj(p, `Preset ${i + 1}`)
    if (typeof p.key !== 'string' || !p.key || p.key.length > 20) fail('Preset needs a key.')
    if (typeof p.label !== 'string' || !p.label || p.label.length > 40)
      fail('Preset needs a label.')
    if (!validDate(p.as_of)) fail('Preset as-of date must be YYYY-MM-DD.')
    if (typeof p.source !== 'string' || p.source.length > 200) fail('Preset source is too long.')
    return {
      key: p.key,
      label: p.label,
      rate: num(p.rate, `Preset ${p.label} rate`, 0, 0.3),
      as_of: p.as_of,
      source: p.source,
    }
  })
  if (a.return_mode === 'index' && !presets.some((p) => p.key === a.index_preset))
    fail('Choose an index preset.')
  if (!Array.isArray(a.scenarios) || a.scenarios.length > 6) fail('At most 6 scenarios.')
  const scenarios = a.scenarios.map((s, i) => {
    obj(s, `Scenario ${i + 1}`)
    if (typeof s.name !== 'string' || !s.name.trim() || s.name.trim().length > 40)
      fail('Scenario name is required (up to 40 characters).')
    return { name: s.name.trim(), delta: num(s.delta, `${s.name} offset`, -0.1, 0.1) }
  })
  const caps = obj(a.caps, 'Contribution caps')
  const cu = obj(a.catch_up, 'Catch-up')
  if (typeof cu.enabled !== 'boolean') fail('Choose whether catch-up is on.')
  const emergency = obj(a.emergency, 'Emergency fund')
  const surplus = obj(a.surplus, 'Surplus')
  if (surplus.source !== 'manual' && surplus.source !== 'outlook')
    fail('Surplus source must be manual or outlook.')
  const byYear = a.surplus_by_year ?? {}
  obj(byYear, 'Surplus by year')
  const surplus_by_year = {}
  for (const [year, amount] of Object.entries(byYear)) {
    if (!/^\d{4}$/.test(year) || +year < 2000 || +year > 2200) fail('Surplus has an invalid year.')
    surplus_by_year[year] = dollars(amount, 'Surplus', -1e9)
  }
  return {
    version: 1,
    current_age,
    retirement_age,
    retirement_spend: dollars(a.retirement_spend, 'Retirement spend'),
    withdrawal_multiple: num(a.withdrawal_multiple, 'Withdrawal multiple', 10, 60),
    inflation: num(a.inflation, 'Inflation', 0, 0.2),
    return_mode: a.return_mode,
    manual_return: num(a.manual_return, 'Manual return', 0, 0.25),
    index_preset: typeof a.index_preset === 'string' ? a.index_preset : '',
    presets,
    scenarios,
    pay_growth: num(a.pay_growth, 'Pay growth', 0, 0.2),
    spend_growth: num(a.spend_growth, 'Spending growth', 0, 0.2),
    caps: {
      year: int(caps.year, 'Cap year', 2000, 2200),
      k401: dollars(caps.k401, '401(k) cap'),
      ira: dollars(caps.ira, 'Roth IRA cap'),
      hsa: dollars(caps.hsa, 'HSA cap'),
      growth: num(caps.growth, 'Cap growth', 0, 0.2),
    },
    employee_401k: dollars(a.employee_401k, 'Your 401(k) contribution'),
    match_rate: num(a.match_rate, 'Employer match', 0, 1),
    catch_up: {
      enabled: cu.enabled,
      age_50: int(cu.age_50, 'Catch-up age', 40, 75),
      age_hsa: int(cu.age_hsa, 'HSA catch-up age', 40, 75),
      k401: dollars(cu.k401, '401(k) catch-up'),
      ira: dollars(cu.ira, 'IRA catch-up'),
      hsa: dollars(cu.hsa, 'HSA catch-up'),
    },
    emergency: {
      target: dollars(emergency.target, 'Emergency target'),
      current: dollars(emergency.current, 'Emergency balance now'),
    },
    surplus: { base: dollars(surplus.base, 'Surplus', -1e9), source: surplus.source },
    surplus_by_year,
    ytd_estimated: a.ytd_estimated === true,
  }
}
