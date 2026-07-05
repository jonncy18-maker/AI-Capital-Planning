import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { auth } from '../../../../src/lib/neon/authServer.js'

// Mirrors src/lib/db/creditCards.js#getPointRedemptions.
export async function GET(request) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const yearParam = searchParams.get('year')
  const year = yearParam !== null ? Number(yearParam) : null

  if (year === null || Number.isNaN(year)) {
    return Response.json({ error: 'Query param "year" is required and must be a number.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()
    const rows = await sql`
      SELECT * FROM credit_card_point_redemptions
      WHERE user_id = ${userId} AND year = ${year}
      ORDER BY month ASC
    `
    return Response.json(rows)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// Mirrors src/lib/db/creditCards.js#upsertPointRedemption: branches on
// body.id presence — UPDATE by id if present, INSERT if absent. Hardened:
// the source's update only filters by id; here WHERE user_id = ${userId} is
// added as the authorization boundary.
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

  const redemption = body || {}
  const { id = null } = redemption

  try {
    const sql = getNeonSql()

    if (id) {
      const [existing] = await sql`
        SELECT * FROM credit_card_point_redemptions WHERE id = ${id} AND user_id = ${userId}
      `
      if (!existing) {
        return Response.json({ error: 'Point redemption not found.' }, { status: 404 })
      }

      const merged = {
        card_id: redemption.cardId ?? redemption.card_id ?? existing.card_id,
        year: redemption.year ?? existing.year,
        month: redemption.month ?? existing.month,
        points_amount: redemption.pointsAmount ?? redemption.points_amount ?? existing.points_amount,
        description: redemption.description ?? existing.description,
      }

      const [row] = await sql`
        UPDATE credit_card_point_redemptions
        SET
          card_id = ${merged.card_id},
          year = ${merged.year},
          month = ${merged.month},
          points_amount = ${merged.points_amount},
          description = ${merged.description}
        WHERE id = ${id} AND user_id = ${userId}
        RETURNING *
      `
      if (!row) {
        return Response.json({ error: 'Point redemption not found.' }, { status: 404 })
      }
      return Response.json(row)
    }

    const cardId = redemption.cardId ?? redemption.card_id
    const year = redemption.year
    const month = redemption.month
    const pointsAmount = redemption.pointsAmount ?? redemption.points_amount
    const description = redemption.description ?? null

    if (!cardId) {
      return Response.json({ error: 'Field "cardId" is required.' }, { status: 400 })
    }
    if (year === undefined || year === null) {
      return Response.json({ error: 'Field "year" is required.' }, { status: 400 })
    }
    if (month === undefined || month === null) {
      return Response.json({ error: 'Field "month" is required.' }, { status: 400 })
    }
    if (pointsAmount === undefined || pointsAmount === null) {
      return Response.json({ error: 'Field "pointsAmount" is required.' }, { status: 400 })
    }

    const [row] = await sql`
      INSERT INTO credit_card_point_redemptions
        (card_id, user_id, year, month, points_amount, description)
      VALUES
        (${cardId}, ${userId}, ${year}, ${month}, ${pointsAmount}, ${description})
      RETURNING *
    `
    return Response.json(row, { status: 201 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
