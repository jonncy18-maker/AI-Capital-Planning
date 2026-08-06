import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { auth } from '../../../../src/lib/neon/authServer.js'

// POST /api/bills/forecast-amounts — body { year, month, bills }
// Mirrors src/lib/db/bills.js#getForecastAmountsForBills. This is a
// POST-with-body endpoint (not a GET) because the caller passes a computed
// `bills` array (each possibly having forecast_category_id/forecast_divisor)
// that the route cannot derive on its own.
export async function POST(request) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  const { year, month, bills } = body || {}

  if (!Number.isInteger(year)) {
    return Response.json({ error: 'Field "year" must be an integer.' }, { status: 400 })
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return Response.json({ error: 'Field "month" must be an integer between 1 and 12.' }, { status: 400 })
  }
  if (!Array.isArray(bills)) {
    return Response.json({ error: 'Field "bills" must be an array.' }, { status: 400 })
  }

  const linkedBills = bills.filter(b => b?.forecast_category_id)
  if (linkedBills.length === 0) {
    return Response.json({})
  }

  const categoryIds = [...new Set(linkedBills.map(b => b.forecast_category_id))]

  try {
    const sql = getNeonSql()
    const [lineItems, forecastLines, forecastYearRows] = await Promise.all([
      sql`
        SELECT category_id, amount FROM budget_line_items
        WHERE user_id = ${userId} AND budget_year = ${year} AND month = ${month}
          AND category_id = ANY(${categoryIds})
      `,
      sql`
        SELECT category_id, amount FROM forecast_line_items
        WHERE user_id = ${userId} AND budget_year = ${year} AND month = ${month}
          AND category_id = ANY(${categoryIds})
      `,
      // Mirrors hasForecastForYear: once the year's forecast is initialized it
      // is the sole source of truth for forecast-linked bills.
      sql`
        SELECT 1 FROM forecast_line_items
        WHERE user_id = ${userId} AND budget_year = ${year}
        LIMIT 1
      `,
    ])
    const forecastReady = forecastYearRows.length > 0

    // Sum budget_line_items per category.
    const lineItemTotals = {}
    for (const li of lineItems) {
      lineItemTotals[li.category_id] = (lineItemTotals[li.category_id] ?? 0) + Number(li.amount)
    }

    // Sum forecast_line_items per category.
    const forecastTotals = {}
    for (const fi of forecastLines) {
      forecastTotals[fi.category_id] = (forecastTotals[fi.category_id] ?? 0) + Number(fi.amount)
    }

    // Once the forecast is initialized for the year, a category with no forecast
    // line in a month forecasts $0 — dropping an expense off the forecast (a paid-off
    // loan, a cancelled service) must not fall back to the budget, which still
    // carries the old amount. The budget is only a fallback for a year that has no
    // forecast yet. Matches the Forecast module's own forecastReady semantics.
    const result = {}
    for (const bill of linkedBills) {
      const monthly = forecastReady
        ? (forecastTotals[bill.forecast_category_id] ?? 0)
        : (lineItemTotals[bill.forecast_category_id] ?? null)
      if (monthly != null) {
        result[bill.id] = monthly / Math.max(1, bill.forecast_divisor ?? 1)
      }
    }
    return Response.json(result)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
