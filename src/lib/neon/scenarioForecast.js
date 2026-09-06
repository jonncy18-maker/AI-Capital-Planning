// Keeps a committed scenario's materialized forecast_line_items in sync with
// its scenario_adjustments.
//
// Committing a scenario copies its adjustments into forecast_line_items tagged
// with source_scenario_id, so Forecast — and downstream, the Pay Period
// Planner's forecast-linked bills — reflect it without a separate step. That
// copy is a snapshot: editing the adjustments afterwards leaves the forecast
// holding the old numbers until the rows are rebuilt, which is what these
// helpers do.

// The delete+insert pair that rebuilds one scenario's forecast rows from its
// current adjustments. Returned as statements (not executed) so callers can
// run them inside a larger transaction.
export function rebuildForecastStatements(sql, { userId, scenarioId, scenarioName }) {
  return [
    sql`DELETE FROM forecast_line_items WHERE source_scenario_id = ${scenarioId} AND user_id = ${userId}`,
    sql`
      INSERT INTO forecast_line_items
        (user_id, budget_year, category_id, month, amount, label, note, source, source_scenario_id)
      SELECT
        ${userId}, sa.year, sa.category_id, sa.month, sa.delta_amount,
        CASE WHEN COALESCE(sa.label, '') <> '' THEN ${scenarioName} || ' — ' || sa.label ELSE ${scenarioName} END,
        'Committed scenario: ' || ${scenarioName},
        'scenario',
        ${scenarioId}
      FROM scenario_adjustments sa
      WHERE sa.scenario_id = ${scenarioId} AND sa.user_id = ${userId}
    `,
  ]
}

// Rebuild the forecast rows for a scenario, but only when it is committed — a
// modeled or idea scenario has no materialized rows to keep current. Callers
// that mutate scenario_adjustments use this so a committed scenario's forecast
// never drifts from the adjustments it was built from.
// Returns true when rows were rebuilt.
export async function resyncCommittedScenario(sql, { userId, scenarioId }) {
  const [scenario] = await sql`
    SELECT id, name, state FROM scenarios
    WHERE id = ${scenarioId} AND user_id = ${userId}
  `
  if (!scenario || scenario.state !== 'committed') return false

  await sql.transaction(
    rebuildForecastStatements(sql, {
      userId,
      scenarioId,
      scenarioName: scenario.name,
    })
  )
  return true
}
