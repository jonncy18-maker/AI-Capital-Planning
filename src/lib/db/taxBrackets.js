import { estimateNetIncome } from '../tax/estimateTax.js'
import { inflate, inflateBrackets } from '../tax/inflation.js'

// Loads tax reference data from the `tax_brackets` table and resolves it for a
// given budget year, falling back to the latest seeded year (inflation-adjusted)
// for future years. The table is tiny and static within a session, so the whole
// thing is fetched once and cached in module memory.

let _cache = null

async function loadAll() {
  if (_cache) return _cache
  const res = await fetch('/api/tax-brackets', { credentials: 'include' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  _cache = body || []
  return _cache
}

// Test/refresh hook.
export function clearTaxCache() { _cache = null }

function find(rows, year, jurisdiction, filingStatus = 'all') {
  return rows.find(
    r => r.year === year && r.jurisdiction === jurisdiction && r.filing_status === filingStatus
  )
}

// Pick the seeded year to use for a requested budget year: exact match if present,
// otherwise the nearest available (latest for future years, earliest for older).
function resolveYear(rows, requested) {
  const years = [...new Set(rows.filter(r => r.jurisdiction === 'federal').map(r => r.year))]
    .sort((a, b) => a - b)
  if (!years.length) return { effYear: requested, estimated: false }
  if (years.includes(requested)) return { effYear: requested, estimated: false }
  const effYear = requested > years[years.length - 1] ? years[years.length - 1] : years[0]
  return { effYear, estimated: effYear !== requested }
}

// Resolve federal brackets/standard deduction, FICA constants, and the chosen
// state's rate for `year`, projecting forward when the year isn't seeded.
export async function getTaxData(year, filingStatus = 'single', state = null) {
  const rows = await loadAll()
  const { effYear, estimated } = resolveYear(rows, year)

  const fedRow = find(rows, effYear, 'federal', filingStatus) || find(rows, effYear, 'federal', 'single')
  const ficaRow = find(rows, effYear, 'fica', 'all')
  const stateRow = state ? find(rows, effYear, state.toUpperCase(), 'all') : null

  const federal = {
    brackets: estimated
      ? inflateBrackets(fedRow?.brackets || [], effYear, year)
      : (fedRow?.brackets || []),
    standardDeduction: estimated
      ? inflate(Number(fedRow?.standard_deduction) || 0, effYear, year)
      : (Number(fedRow?.standard_deduction) || 0),
  }

  const ficaMeta = ficaRow?.meta || null
  const fica = ficaMeta
    ? { ...ficaMeta, ssWageBase: estimated ? inflate(Number(ficaMeta.ssWageBase) || 0, effYear, year) : ficaMeta.ssWageBase }
    : null

  return {
    year,
    effYear,
    estimated,
    federal,
    fica,
    state: stateRow?.meta || null,
  }
}

// Thin async wrapper: load the resolved reference data, then run the pure engine.
export async function estimateNet({ grossIncome, bonus, filingStatus = 'single', state, stateRateOverride, preTaxDeductions, year }) {
  const taxData = await getTaxData(year, filingStatus, state)
  const result = estimateNetIncome({ grossIncome, bonus, filingStatus, stateRateOverride, preTaxDeductions, taxData })
  return { ...result, year: taxData.year, effYear: taxData.effYear }
}
