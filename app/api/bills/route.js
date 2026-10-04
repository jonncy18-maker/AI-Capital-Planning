import { getNeonSql } from '../../../src/lib/neon/client.js'
import { getSessionOrToken } from '../../../src/lib/neon/apiAuth.js'

const ALLOWED_BILL_TYPES = ['credit_card', 'loan', 'rent', 'investment', 'subscription', 'other']
const ALLOWED_PAYMENT_METHODS = ['auto', 'manual']

// Mirrors src/lib/db/bills.js#getBills.
export async function GET(request) {
  const { data: session } = await getSessionOrToken(request)
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  try {
    const sql = getNeonSql()
    const rows = await sql`
      SELECT * FROM bills
      WHERE user_id = ${userId} AND active = true
      ORDER BY pay_day ASC
    `
    return Response.json(rows)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// Upsert endpoint mirroring src/lib/db/bills.js#upsertBill.
// - If body.id is provided, updates that row (scoped to the caller's user_id).
// - Otherwise inserts a new row (bills.id defaults to gen_random_uuid()).
// - Business rule (computed server-side, not client-trusted): when
//   pay_same_as_due is true, pay_day is forced to equal due_day.
export async function POST(request) {
  const { data: session } = await getSessionOrToken(request)
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
    name,
    bill_type,
    due_day = null,
    pay_same_as_due = true,
    pay_day: rawPayDay = null,
    payment_method = 'manual',
    fixed_amount = null,
    debits_from_account_id = null,
    active = true,
    display_order = 0,
    is_auto_funded = false,
    auto_fund_account_id = null,
    auto_fund_day = null,
    auto_fund_amount = null,
    forecast_category_id = null,
    forecast_divisor = 1,
    statement_close_day = null,
    credit_card_id = null,
    actuals_category = null,
    exclude_from_schedule = false,
  } = body || {}

  if (bill_type !== undefined && bill_type !== null && !ALLOWED_BILL_TYPES.includes(bill_type)) {
    return Response.json(
      { error: `Field "bill_type" must be one of: ${ALLOWED_BILL_TYPES.join(', ')}.` },
      { status: 400 }
    )
  }
  if (payment_method !== undefined && payment_method !== null && !ALLOWED_PAYMENT_METHODS.includes(payment_method)) {
    return Response.json(
      { error: `Field "payment_method" must be one of: ${ALLOWED_PAYMENT_METHODS.join(', ')}.` },
      { status: 400 }
    )
  }

  // pay_day = due_day when toggled — enforced server-side so a client can't
  // desync the two fields; mirrors src/lib/db/bills.js#upsertBill exactly.
  const pay_day = pay_same_as_due ? due_day : rawPayDay

  try {
    const sql = getNeonSql()

    let existing = null
    if (id) {
      // WHERE user_id = ${userId} is the authorization boundary: a user can
      // never touch a row they don't own, even by guessing an id.
      ;[existing] = await sql`
        SELECT * FROM bills WHERE id = ${id} AND user_id = ${userId}
      `
      if (!existing) {
        return Response.json({ error: 'Bill not found.' }, { status: 404 })
      }
    } else {
      if (!name || typeof name !== 'string') {
        return Response.json({ error: 'Field "name" is required.' }, { status: 400 })
      }
      if (!bill_type) {
        return Response.json({ error: 'Field "bill_type" is required.' }, { status: 400 })
      }
    }

    if (existing) {
      // Merge only the keys the client actually sent. The destructuring above
      // fills in insert defaults (null/true/false), so testing those values
      // against undefined would treat every omitted field as "set to default"
      // and wipe it. A key sent as null still clears that field (e.g.
      // unlinking forecast_category_id).
      const sent = key => Object.prototype.hasOwnProperty.call(body, key)
      const pick = (key, value) => (sent(key) ? value : existing[key])
      const pickBool = (key, value) => (sent(key) ? !!value : existing[key])
      const merged = {
        name: pick('name', name),
        bill_type: pick('bill_type', bill_type),
        due_day: pick('due_day', due_day),
        pay_same_as_due: pickBool('pay_same_as_due', pay_same_as_due),
        pay_day: pick('pay_day', rawPayDay),
        payment_method: pick('payment_method', payment_method),
        fixed_amount: pick('fixed_amount', fixed_amount),
        debits_from_account_id: pick('debits_from_account_id', debits_from_account_id),
        active: pickBool('active', active),
        display_order: pick('display_order', display_order),
        is_auto_funded: pickBool('is_auto_funded', is_auto_funded),
        auto_fund_account_id: pick('auto_fund_account_id', auto_fund_account_id),
        auto_fund_day: pick('auto_fund_day', auto_fund_day),
        auto_fund_amount: pick('auto_fund_amount', auto_fund_amount),
        forecast_category_id: pick('forecast_category_id', forecast_category_id),
        forecast_divisor: pick('forecast_divisor', forecast_divisor),
        statement_close_day: pick('statement_close_day', statement_close_day),
        credit_card_id: pick('credit_card_id', credit_card_id),
        actuals_category: pick('actuals_category', actuals_category),
        exclude_from_schedule: pickBool('exclude_from_schedule', exclude_from_schedule),
      }
      // Re-apply the business rule against the merged row, in case only
      // pay_same_as_due (or only due_day) was part of this update.
      merged.pay_day = merged.pay_same_as_due ? merged.due_day : merged.pay_day

      const [row] = await sql`
        UPDATE bills
        SET
          name = ${merged.name},
          bill_type = ${merged.bill_type},
          due_day = ${merged.due_day},
          pay_same_as_due = ${merged.pay_same_as_due},
          pay_day = ${merged.pay_day},
          payment_method = ${merged.payment_method},
          fixed_amount = ${merged.fixed_amount},
          debits_from_account_id = ${merged.debits_from_account_id},
          active = ${merged.active},
          display_order = ${merged.display_order},
          is_auto_funded = ${merged.is_auto_funded},
          auto_fund_account_id = ${merged.auto_fund_account_id},
          auto_fund_day = ${merged.auto_fund_day},
          auto_fund_amount = ${merged.auto_fund_amount},
          forecast_category_id = ${merged.forecast_category_id},
          forecast_divisor = ${merged.forecast_divisor},
          statement_close_day = ${merged.statement_close_day},
          credit_card_id = ${merged.credit_card_id},
          actuals_category = ${merged.actuals_category},
          exclude_from_schedule = ${merged.exclude_from_schedule}
        WHERE id = ${existing.id} AND user_id = ${userId}
        RETURNING *
      `
      return Response.json(row)
    }

    const [row] = await sql`
      INSERT INTO bills
        (user_id, name, bill_type, due_day, pay_same_as_due, pay_day, payment_method,
         fixed_amount, debits_from_account_id, active, display_order, is_auto_funded,
         auto_fund_account_id, auto_fund_day, auto_fund_amount, forecast_category_id,
         forecast_divisor, statement_close_day, credit_card_id, actuals_category,
         exclude_from_schedule)
      VALUES
        (${userId}, ${name}, ${bill_type}, ${due_day}, ${!!pay_same_as_due}, ${pay_day}, ${payment_method},
         ${fixed_amount}, ${debits_from_account_id}, ${active !== undefined ? !!active : true}, ${display_order},
         ${!!is_auto_funded}, ${auto_fund_account_id}, ${auto_fund_day}, ${auto_fund_amount},
         ${forecast_category_id}, ${forecast_divisor}, ${statement_close_day}, ${credit_card_id},
         ${actuals_category}, ${!!exclude_from_schedule})
      RETURNING *
    `
    return Response.json(row, { status: 201 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
