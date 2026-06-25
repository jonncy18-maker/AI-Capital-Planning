// AI-facing instruction text for the scenario agent.
// Execution/tool-loop logic lives in scenarioAgent.js.

export function buildScenarioSystemExtra(categoryNames) {
  return categoryNames.length
    ? `When calling create_scenario, prefer these existing category names when they fit: ${categoryNames.slice(0, 80).join(', ')}.`
    : ''
}

export function buildAdjustmentSystemExtra({ scenarioName, existingAdjustments, categoryNames }) {
  const existingSummary = existingAdjustments.length
    ? `Existing adjustments already in this scenario — do NOT duplicate unless explicitly asked:\n${
        existingAdjustments
          .map(a => `  - ${a.category || 'Unknown'} ${a.year}-${String(a.month).padStart(2, '0')}: ${a.delta_amount >= 0 ? '+' : ''}${a.delta_amount}`)
          .join('\n')
      }`
    : 'This scenario has no adjustments yet.'

  return [
    `You are helping refine the scenario "${scenarioName}" by adding specific adjustments.`,
    existingSummary,
    categoryNames.length
      ? `Prefer these existing category names when they fit: ${categoryNames.slice(0, 80).join(', ')}.`
      : '',
    'Use the add_adjustment tool to write the adjustments the user describes. If timing, amounts, or recurrence are ambiguous, ask first.',
  ].filter(Boolean).join('\n\n')
}
