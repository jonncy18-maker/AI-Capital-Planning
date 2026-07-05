import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { auth } from '../../../../src/lib/neon/authServer.js'
import { CATEGORY_SEED_DATA } from '../../../../src/lib/csv/categoryMap.js'

// Mirrors src/lib/db/budgetCategories.js#seedDefaultCategories: upsert the
// default Monarch category -> group/type mappings for this user. Safe to
// call multiple times — existing rows (matched by user_id, category) are
// left untouched so user-customized targets are never overwritten, matching
// the source's onConflict: 'user_id,category', ignoreDuplicates: true
// behavior. As with app/api/budget-categories/import/route.js, there is no
// unique constraint on (user_id, category) enforced here, so each row is a
// sequential exists-check + insert-if-missing rather than a single
// INSERT ... ON CONFLICT statement.
export async function POST() {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  try {
    const sql = getNeonSql()

    const existingRows = await sql`
      SELECT category FROM budget_categories WHERE user_id = ${userId}
    `
    const existingCategories = new Set(existingRows.map(r => r.category))

    const toInsert = CATEGORY_SEED_DATA.filter(c => !existingCategories.has(c.category))

    for (const c of toInsert) {
      await sql`
        INSERT INTO budget_categories (user_id, category, "group", type, exclude_from_totals, is_active)
        VALUES (${userId}, ${c.category}, ${c.group}, ${c.type}, ${!!c.exclude}, true)
      `
    }

    return Response.json({ seeded: toInsert.length })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
