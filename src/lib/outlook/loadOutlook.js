import { getBudgetLineItems } from '../db/budgetLineItems.js'
import { getBudgetCategories } from '../db/budgetCategories.js'
import { getCommitments } from '../db/commitments.js'
import { getProfile } from '../db/profile.js'
import { estimateNet } from '../db/taxBrackets.js'
import { getScenarios } from '../db/scenarios.js'
import {
  getOutlookAssumptions,
  getOutlookEvents,
  getCommittedOutlookAdjustments,
} from '../db/outlook.js'
import { resolveBaseYear } from './outlookEngine.js'

// Estimated take-home the same way Settings > Planning shows it: the saved
// profile's gross + bonus through the tax estimator. null when there is no
// salary or the estimate can't be produced — callers show "—", never a guess.
async function estimateTakeHome(profile, year) {
  const gross = Number(profile?.annual_income) || 0
  if (gross <= 0) return null
  const tp = profile?.tax_profile || {}
  try {
    const res = await estimateNet({
      grossIncome: gross,
      bonus: Number(profile?.annual_bonus) || 0,
      filingStatus: tp.filingStatus || 'single',
      state: tp.state || null,
      stateRateOverride: tp.stateRateOverride ?? null,
      preTaxDeductions: (Number(tp.preTax401k) || 0) + (Number(tp.preTaxOther) || 0),
      year,
    })
    return res?.netIncome > 0 ? res.netIncome : null
  } catch {
    return null
  }
}

// Fetches everything buildOutlook needs. Pure data in, so the Budget outlook
// view and the Wealth module share one loader.
export async function loadOutlookInputs(userId, { curYear = new Date().getFullYear() } = {}) {
  const nextYear = curYear + 1
  const [nextItems, curItems, categories, commitments, profile, assumptions, events, committedAdjustments, scenarios] =
    await Promise.all([
      getBudgetLineItems(userId, { year: nextYear }),
      getBudgetLineItems(userId, { year: curYear }),
      getBudgetCategories(userId),
      getCommitments(userId, { status: 'active' }),
      getProfile(userId).catch(() => null),
      getOutlookAssumptions(),
      getOutlookEvents(),
      getCommittedOutlookAdjustments(),
      getScenarios(userId),
    ])

  const baseYear = resolveBaseYear({
    nextYear,
    curYear,
    hasNextBudget: nextItems.length > 0,
    hasCurBudget: curItems.length > 0,
  })
  const baseLineItems = baseYear === nextYear ? nextItems : baseYear === curYear ? curItems : []
  const takeHomeBase = baseYear == null ? null : await estimateTakeHome(profile, baseYear)

  return {
    nextYear,
    baseYear,
    baseLineItems,
    categories,
    commitments,
    takeHomeBase,
    assumptions,
    events,
    adjustments: committedAdjustments,
    scenarios,
  }
}
