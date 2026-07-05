import { getNeonSql } from '../../../src/lib/neon/client.js'
import { auth } from '../../../src/lib/neon/authServer.js'

// Mirrors src/lib/db/creditCards.js#getCreditCards.
export async function GET() {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  try {
    const sql = getNeonSql()
    const rows = await sql`
      SELECT * FROM credit_cards
      WHERE user_id = ${userId} AND active = true
      ORDER BY display_order ASC
    `
    return Response.json(rows)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// Upsert endpoint mirroring src/lib/db/creditCards.js#upsertCreditCard, which
// does a plain `.upsert({ ...card, user_id })` with no explicit onConflict —
// meaning it resolves conflicts on the table's PRIMARY KEY (id). credit_cards.id
// defaults to gen_random_uuid() (verified via information_schema), so:
// - body.id present  -> UPDATE by id, scoped to user_id for authorization.
// - body.id absent   -> INSERT a new row with a fresh server-generated id.
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

  const card = body || {}

  const {
    id = null,
    name,
    issuer = null,
    network = null,
    last_four = null,
    points_program = null,
    is_default = false,
    statement_close_day = null,
    due_days_after_close = 21,
    annual_fee = null,
    annual_fee_month = null,
    points_value_cents = 1.0,
    color = null,
    active = true,
    display_order = 0,
  } = card

  try {
    const sql = getNeonSql()

    if (id) {
      // WHERE user_id = ${userId} is the authorization boundary: a user can
      // never touch a card they don't own, even by guessing an id.
      const [existing] = await sql`
        SELECT * FROM credit_cards WHERE id = ${id} AND user_id = ${userId}
      `
      if (!existing) {
        return Response.json({ error: 'Credit card not found.' }, { status: 404 })
      }

      const merged = {
        name: name ?? existing.name,
        issuer: issuer ?? existing.issuer,
        network: network ?? existing.network,
        last_four: last_four ?? existing.last_four,
        points_program: points_program ?? existing.points_program,
        is_default: card.is_default !== undefined ? !!is_default : existing.is_default,
        statement_close_day: statement_close_day ?? existing.statement_close_day,
        due_days_after_close: card.due_days_after_close !== undefined ? due_days_after_close : existing.due_days_after_close,
        annual_fee: annual_fee ?? existing.annual_fee,
        annual_fee_month: annual_fee_month ?? existing.annual_fee_month,
        points_value_cents: card.points_value_cents !== undefined ? points_value_cents : existing.points_value_cents,
        color: color ?? existing.color,
        active: card.active !== undefined ? !!active : existing.active,
        display_order: card.display_order !== undefined ? display_order : existing.display_order,
      }

      const [row] = await sql`
        UPDATE credit_cards
        SET
          name = ${merged.name},
          issuer = ${merged.issuer},
          network = ${merged.network},
          last_four = ${merged.last_four},
          points_program = ${merged.points_program},
          is_default = ${merged.is_default},
          statement_close_day = ${merged.statement_close_day},
          due_days_after_close = ${merged.due_days_after_close},
          annual_fee = ${merged.annual_fee},
          annual_fee_month = ${merged.annual_fee_month},
          points_value_cents = ${merged.points_value_cents},
          color = ${merged.color},
          active = ${merged.active},
          display_order = ${merged.display_order}
        WHERE id = ${id} AND user_id = ${userId}
        RETURNING *
      `
      return Response.json(row)
    }

    if (!name || typeof name !== 'string') {
      return Response.json({ error: 'Field "name" is required.' }, { status: 400 })
    }

    const [row] = await sql`
      INSERT INTO credit_cards
        (user_id, name, issuer, network, last_four, points_program, is_default,
         statement_close_day, due_days_after_close, annual_fee, annual_fee_month,
         points_value_cents, color, active, display_order)
      VALUES
        (${userId}, ${name}, ${issuer}, ${network}, ${last_four}, ${points_program}, ${!!is_default},
         ${statement_close_day}, ${due_days_after_close}, ${annual_fee}, ${annual_fee_month},
         ${points_value_cents}, ${color}, ${!!active}, ${display_order})
      RETURNING *
    `
    return Response.json(row, { status: 201 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
