import { getNeonSql } from '../../../src/lib/neon/client.js'
import { auth } from '../../../src/lib/neon/authServer.js'

const ALLOWED_TYPES = ['Fixed', 'Flexible', 'Non-Monthly']

// Mirrors src/lib/db/budgetCategories.js#getBudgetCategories: fetch all rows
// for the user, ordered by group. That source function has no server-side
// is_active filter (callers filter client-side), so we default to returning
// everything and only apply a filter when ?is_active= is explicitly passed.
export async function GET(request) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const isActiveParam = searchParams.get('is_active')

  try {
    const sql = getNeonSql()
    let rows
    if (isActiveParam === null) {
      rows = await sql`
        SELECT * FROM budget_categories
        WHERE user_id = ${userId}
        ORDER BY "group" ASC
      `
    } else {
      const isActive = isActiveParam === 'true'
      rows = await sql`
        SELECT * FROM budget_categories
        WHERE user_id = ${userId} AND is_active = ${isActive}
        ORDER BY "group" ASC
      `
    }
    return Response.json(rows)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// Upsert endpoint mirroring src/lib/db/budgetCategories.js#upsertCategory.
// - If body.id is provided, updates that row (scoped to the caller's user_id).
// - Otherwise upserts by (user_id, category): updates the existing row for
//   that category name if one exists, else inserts a new one.
// There is no unique constraint on (user_id, category) in the Neon schema, so
// this is implemented as fetch-then-insert-or-update rather than
// INSERT ... ON CONFLICT (judgment call — see report).
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

  const {
    id = null,
    category,
    group = null,
    type = null,
    monthlyTarget = null,
    annualTarget = null,
    excludeFromTotals,
    ccCategory = null,
    cashOnly = false,
    pinnedCardId = null,
    isActive = true,
  } = body || {}

  if (type !== null && !ALLOWED_TYPES.includes(type)) {
    return Response.json(
      { error: `Field "type" must be one of: ${ALLOWED_TYPES.join(', ')}.` },
      { status: 400 }
    )
  }

  try {
    const sql = getNeonSql()

    let existing
    if (id) {
      // WHERE user_id = ${userId} is the authorization boundary: a user can
      // never touch a row they don't own, even by guessing an id.
      ;[existing] = await sql`
        SELECT * FROM budget_categories WHERE id = ${id} AND user_id = ${userId}
      `
      if (!existing) {
        return Response.json({ error: 'Budget category not found.' }, { status: 404 })
      }
    } else {
      if (!category || typeof category !== 'string') {
        return Response.json({ error: 'Field "category" is required.' }, { status: 400 })
      }
      ;[existing] = await sql`
        SELECT * FROM budget_categories WHERE user_id = ${userId} AND category = ${category}
      `
    }

    if (existing) {
      // Fetch-then-merge so fields the caller omits are left untouched,
      // mirroring upsertCategory's behavior where exclude_from_totals is
      // only written when the caller explicitly passes it.
      const merged = {
        ...existing,
        category: category ?? existing.category,
        group: group ?? existing.group,
        type: type ?? existing.type,
        monthly_target: monthlyTarget ?? existing.monthly_target,
        annual_target: annualTarget ?? existing.annual_target,
        exclude_from_totals:
          excludeFromTotals !== undefined ? !!excludeFromTotals : existing.exclude_from_totals,
        cc_category: ccCategory ?? existing.cc_category,
        cash_only: cashOnly !== undefined ? !!cashOnly : existing.cash_only,
        pinned_card_id: pinnedCardId ?? existing.pinned_card_id,
        is_active: isActive !== undefined ? !!isActive : existing.is_active,
      }

      const [row] = await sql`
        UPDATE budget_categories
        SET
          category = ${merged.category},
          "group" = ${merged.group},
          type = ${merged.type},
          monthly_target = ${merged.monthly_target},
          annual_target = ${merged.annual_target},
          exclude_from_totals = ${merged.exclude_from_totals},
          cc_category = ${merged.cc_category},
          cash_only = ${merged.cash_only},
          pinned_card_id = ${merged.pinned_card_id},
          is_active = ${merged.is_active}
        WHERE id = ${existing.id} AND user_id = ${userId}
        RETURNING *
      `
      return Response.json(row)
    }

    const [row] = await sql`
      INSERT INTO budget_categories
        (user_id, category, "group", type, monthly_target, annual_target,
         exclude_from_totals, cc_category, cash_only, pinned_card_id, is_active)
      VALUES
        (${userId}, ${category}, ${group}, ${type}, ${monthlyTarget}, ${annualTarget},
         ${!!excludeFromTotals}, ${ccCategory}, ${!!cashOnly}, ${pinnedCardId}, ${isActive !== undefined ? !!isActive : true})
      RETURNING *
    `
    return Response.json(row, { status: 201 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
