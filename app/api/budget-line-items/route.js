import { getNeonSql } from '../../../src/lib/neon/client.js'
import { auth } from '../../../src/lib/neon/authServer.js'

// Reshapes the flat join result back into the nested shape
// src/lib/db/budgetLineItems.js#getBudgetLineItems/#insertBudgetLineItem
// return via the original `*, budget_categories(id, category, "group", type)`
// embedded select — callers (e.g. src/modules/budget/Budget.jsx,
// src/lib/dashboard/widgetData.js) read `li.budget_categories?.group` etc.
function shapeLineItem(row) {
  const { cat_id, cat_category, cat_group, cat_type, ...rest } = row
  return {
    ...rest,
    budget_categories:
      cat_id != null
        ? { id: cat_id, category: cat_category, group: cat_group, type: cat_type }
        : null,
  }
}

// GET /api/budget-line-items?year=
// Mirrors src/lib/db/budgetLineItems.js#getBudgetLineItems. Neon has no
// default row cap, so a single joined query covers this function without the
// source's manual paging loop (a 1,000-row page limit would have required one).
export async function GET(request) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const yearParam = searchParams.get('year')
  const year = yearParam ? Number.parseInt(yearParam, 10) : null

  try {
    const sql = getNeonSql()
    const rows = await sql`
      SELECT
        bli.*,
        bc.id AS cat_id,
        bc.category AS cat_category,
        bc."group" AS cat_group,
        bc.type AS cat_type
      FROM budget_line_items bli
      LEFT JOIN budget_categories bc ON bc.id = bli.category_id
      WHERE bli.user_id = ${userId}
        AND (${year}::int IS NULL OR bli.budget_year = ${year})
      ORDER BY bli.month ASC
    `
    return Response.json(rows.map(shapeLineItem))
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// POST /api/budget-line-items
// Two shapes, disambiguated by presence of an `items` array in the body:
//   1. { year, version, items: [...] } -> bulk replace-for-year
//      (mirrors src/lib/db/budgetLineItems.js#saveBudgetForYear)
//   2. { year, version, categoryId, month, amount, label } -> single insert
//      (mirrors src/lib/db/budgetLineItems.js#insertBudgetLineItem)
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

  const { year, version = 'v1', items } = body || {}

  if (!Number.isInteger(year)) {
    return Response.json({ error: 'Field "year" must be an integer.' }, { status: 400 })
  }

  const sql = getNeonSql()

  if (Array.isArray(items)) {
    // Bulk replace-for-year path.
    for (const [i, item] of items.entries()) {
      if (!item?.category_id || typeof item.category_id !== 'string') {
        return Response.json(
          { error: `Item ${i} is missing required field "category_id".` },
          { status: 400 }
        )
      }
      if (!Number.isInteger(item.month) || item.month < 1 || item.month > 12) {
        return Response.json(
          { error: `Item ${i}'s "month" must be an integer between 1 and 12.` },
          { status: 400 }
        )
      }
      if (typeof item.amount !== 'number' || Number.isNaN(item.amount)) {
        return Response.json(
          { error: `Item ${i}'s "amount" must be a number.` },
          { status: 400 }
        )
      }
    }

    try {
      if (items.length === 0) {
        // Matches the source's early return: delete existing rows, nothing to insert.
        await sql`
          DELETE FROM budget_line_items
          WHERE user_id = ${userId} AND budget_year = ${year} AND budget_version = ${version}
        `
        return Response.json({ success: true, count: 0 })
      }

      const prepared = items.map(item => ({
        user_id: userId,
        budget_year: year,
        budget_version: version,
        category_id: item.category_id,
        month: item.month,
        amount: item.amount,
        label: item.label ?? null,
        commitment_id: item.commitment_id ?? null,
      }))

      // Delete-then-insert must be atomic — a crash mid-operation must not
      // leave the year half-deleted — so both statements run inside a single
      // non-interactive transaction (@neondatabase/serverless's sql.transaction).
      await sql.transaction([
        sql`
          DELETE FROM budget_line_items
          WHERE user_id = ${userId} AND budget_year = ${year} AND budget_version = ${version}
        `,
        sql`
          INSERT INTO budget_line_items
            (user_id, budget_year, budget_version, category_id, month, amount, label, commitment_id)
          SELECT
            user_id, budget_year, budget_version, category_id, month, amount, label, commitment_id
          FROM jsonb_to_recordset(${JSON.stringify(prepared)}::jsonb) AS t(
            user_id uuid, budget_year int, budget_version text, category_id uuid,
            month int, amount numeric, label text, commitment_id uuid
          )
        `,
      ])

      return Response.json({ success: true, count: prepared.length })
    } catch (err) {
      return Response.json({ error: err.message }, { status: 500 })
    }
  }

  // Single-insert path.
  const { categoryId, month, amount, label = null } = body || {}

  if (!categoryId || typeof categoryId !== 'string') {
    return Response.json({ error: 'Field "categoryId" is required.' }, { status: 400 })
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return Response.json({ error: 'Field "month" must be an integer between 1 and 12.' }, { status: 400 })
  }
  if (typeof amount !== 'number' || Number.isNaN(amount)) {
    return Response.json({ error: 'Field "amount" must be a number.' }, { status: 400 })
  }

  try {
    const [inserted] = await sql`
      INSERT INTO budget_line_items
        (user_id, budget_year, budget_version, category_id, month, amount, label)
      VALUES
        (${userId}, ${year}, ${version}, ${categoryId}, ${month}, ${amount}, ${label})
      RETURNING id
    `

    const [row] = await sql`
      SELECT
        bli.*,
        bc.id AS cat_id,
        bc.category AS cat_category,
        bc."group" AS cat_group,
        bc.type AS cat_type
      FROM budget_line_items bli
      LEFT JOIN budget_categories bc ON bc.id = bli.category_id
      WHERE bli.id = ${inserted.id}
    `
    return Response.json(shapeLineItem(row), { status: 201 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
