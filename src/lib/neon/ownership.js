// Ownership checks for ids a client passes in a write body. Neon has no RLS
// here, and the foreign keys on category_id / commitment_id check existence
// only, so without these a caller could attach another user's category or
// commitment to their own rows (and read its name back through the join).

function distinctIds(ids) {
  return [...new Set(ids.filter(id => id != null))]
}

// True when every non-null id is a budget_categories row owned by userId.
export async function ownsAllCategories(sql, userId, ids) {
  const wanted = distinctIds(ids)
  if (wanted.length === 0) return true
  const rows = await sql`
    SELECT id FROM budget_categories
    WHERE user_id = ${userId} AND id = ANY(${wanted}::uuid[])
  `
  return rows.length === wanted.length
}

// True when every non-null id is a commitments row owned by userId.
export async function ownsAllCommitments(sql, userId, ids) {
  const wanted = distinctIds(ids)
  if (wanted.length === 0) return true
  const rows = await sql`
    SELECT id FROM commitments
    WHERE user_id = ${userId} AND id = ANY(${wanted}::uuid[])
  `
  return rows.length === wanted.length
}

export const UNOWNED_CATEGORY = { error: 'Category not found.' }
export const UNOWNED_COMMITMENT = { error: 'Commitment not found.' }
