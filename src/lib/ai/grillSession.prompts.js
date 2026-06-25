// AI-facing instruction text for the Budget Builder Grill Session.
// The 6-phase interview logic and financial picture formatting.
// Execution/routing lives in grillSession.js.

export const GRILL_PHASE_NAMES = ['Income', 'Life Events', 'Commitments', 'Non-Monthly', 'Category Targets', 'Envelope Check']

export function buildGrillSystemPrompt({ phase, targetYear, profile, commitments, priorBudgetGroups, spendingGroups }) {
  const phaseName = GRILL_PHASE_NAMES[(phase ?? 1) - 1] ?? 'Income'

  const incomeLines = []
  if (profile?.annual_income) incomeLines.push(`Salary $${Math.round(profile.annual_income).toLocaleString()}/yr`)
  if (profile?.annual_bonus) {
    const bonusLine = `Bonus $${Math.round(profile.annual_bonus).toLocaleString()}${profile.bonus_month ? ` in month ${profile.bonus_month}` : ''}`
    incomeLines.push(bonusLine)
  }
  if (profile?.four01k_pct) incomeLines.push(`401k ${profile.four01k_pct}%`)
  if (profile?.benefits_amount) incomeLines.push(`Benefits $${Math.round(profile.benefits_amount).toLocaleString()}`)

  const commitmentLines = (commitments ?? []).map(c => {
    const parts = [c.name]
    if (c.cost_structure) parts.push(c.cost_structure)
    if (c.end_date) parts.push(`ends ${c.end_date}`)
    else parts.push('ongoing')
    return parts.join(' · ')
  })

  const priorLines = Object.entries(priorBudgetGroups ?? {})
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}: $${Math.round(v).toLocaleString()}`)

  const spendLines = Object.entries(spendingGroups ?? {})
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}: $${Math.round(v).toLocaleString()}`)

  const sections = [
    `You are a financial planning assistant helping the user build their ${targetYear} annual budget.`,
    `You guide them through a structured 6-phase interview. Be concise. Ask one focused question at a time.`,
    `Make specific dollar suggestions grounded in the data below. Never ask for information already in the data.`,
    ``,
    `== PHASES ==`,
    `1. Income — Confirm salary, bonus, 401k, benefits for ${targetYear}. Any changes?`,
    `2. Life Events — What's changing in ${targetYear}? (new job, move, promotion, new dependent, big purchase)`,
    `   Classify: confirmed → affects base budget | probable → should become a Scenario | possible → park as an Idea`,
    `3. Commitments — Review each active commitment. Are amounts or timing changing? Anything ending or starting?`,
    `4. Non-Monthly — For each significant irregular expense, confirm: happening in ${targetYear}? Which month(s)?`,
    `5. Category Targets — Group by group: given prior year actuals and budget, where should ${targetYear} targets land?`,
    `   Flag categories that ran over budget both years.`,
    `6. Envelope Check — Total planned spend vs projected income. Surplus or deficit? Where does surplus go?`,
    ``,
    `== CURRENT PHASE ==`,
    `Phase ${phase}: ${phaseName}`,
  ]

  if (incomeLines.length) {
    sections.push(``, `== USER'S FINANCIAL PICTURE ==`)
    sections.push(`Income: ${incomeLines.join(' | ')}`)
  } else {
    sections.push(``, `== USER'S FINANCIAL PICTURE ==`)
  }

  if (commitmentLines.length) {
    sections.push(`Active commitments:`)
    commitmentLines.forEach(l => sections.push(`  - ${l}`))
  }

  if (priorLines.length) {
    sections.push(`Prior year budget by group: ${priorLines.join(', ')}`)
  }

  if (spendLines.length) {
    sections.push(`Trailing 12-month actual spending by group: ${spendLines.join(', ')}`)
  }

  return sections.join('\n')
}
