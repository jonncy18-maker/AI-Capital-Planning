import { auth } from '../../../src/lib/neon/authServer.js'

// Next.js port of supabase/functions/monarch-sync (Deno edge function).
// Pulls transactions from Monarch Money's private GraphQL API server-side —
// Monarch's endpoint isn't CORS-enabled and the session token must never
// live in browser JS. UNOFFICIAL, may break if Monarch changes its schema;
// the Monarch CSV export remains the supported fallback (see
// src/lib/integrations/monarch.js).
//
// The Supabase version relied on the platform gateway to verify the caller's
// JWT before invocation. Neon Auth has no equivalent gateway, so this route
// does the same check itself, matching every other route in this migration
// — this gates who can trigger an outbound Monarch login attempt through
// this server, independent of the Monarch credentials themselves.
//
// Invoked from src/lib/integrations/monarch.js#syncMonarchTransactions.
// Request/response shape unchanged from the Supabase version: { email,
// password, mfaCode, since } in, { transactions, count } (or { error }) out.

const MONARCH_GRAPHQL = 'https://api.monarchmoney.com/graphql'
const MONARCH_LOGIN = 'https://api.monarchmoney.com/auth/login/'

function baseHeaders(deviceUuid, token) {
  const h = {
    'content-type': 'application/json',
    accept: 'application/json',
    'client-platform': 'web',
    'device-uuid': deviceUuid,
    origin: 'https://app.monarchmoney.com',
  }
  if (token) h['authorization'] = `Token ${token}`
  return h
}

// Exchange email/password (+ optional MFA) for a session token.
async function login(deviceUuid, email, password, mfaCode) {
  const res = await fetch(MONARCH_LOGIN, {
    method: 'POST',
    headers: baseHeaders(deviceUuid),
    body: JSON.stringify({
      username: email,
      password,
      trusted_device: true,
      supports_mfa: true,
      ...(mfaCode ? { totp: mfaCode } : {}),
    }),
  })

  if (res.status === 403 || res.status === 401) {
    const body = await res.json().catch(() => ({}))
    if (JSON.stringify(body).toLowerCase().includes('mfa') || JSON.stringify(body).toLowerCase().includes('totp')) {
      throw new Error('Monarch requires a multi-factor code. Enter the current code from your authenticator and try again.')
    }
    throw new Error('Monarch rejected those credentials. Double-check your email and password.')
  }
  if (!res.ok) {
    throw new Error(`Monarch login failed (${res.status}).`)
  }

  const data = await res.json()
  const token = data?.token
  if (!token) throw new Error('Monarch login did not return a session token.')
  return token
}

// Page through transactions via GraphQL, normalized to the Monarch CSV columns.
async function fetchTransactions(deviceUuid, token, since) {
  const query = `
    query Web_GetTransactionsList($filters: TransactionFilterInput, $offset: Int, $limit: Int) {
      allTransactions(filters: $filters) {
        totalCount
        results(offset: $offset, limit: $limit) {
          date
          amount
          notes
          merchant { name }
          category { name }
          account { displayName }
        }
      }
    }`

  const limit = 500
  let offset = 0
  const out = []

  // Hard cap pages to keep a single sync bounded.
  for (let page = 0; page < 40; page++) {
    const res = await fetch(MONARCH_GRAPHQL, {
      method: 'POST',
      headers: baseHeaders(deviceUuid, token),
      body: JSON.stringify({
        operationName: 'Web_GetTransactionsList',
        query,
        variables: { offset, limit, filters: since ? { startDate: since } : {} },
      }),
    })
    if (!res.ok) throw new Error(`Monarch transactions query failed (${res.status}).`)

    const data = await res.json()
    if (data?.errors?.length) {
      throw new Error(data.errors[0]?.message || 'Monarch GraphQL returned an error.')
    }

    const results = data?.data?.allTransactions?.results ?? []
    for (const t of results) {
      out.push({
        date: t.date,
        merchant: t.merchant?.name ?? '',
        category: t.category?.name ?? '',
        account: t.account?.displayName ?? '',
        originalStatement: '',
        notes: t.notes ?? '',
        amount: t.amount,
        tags: '',
        owner: '',
      })
    }

    if (results.length < limit) break
    offset += limit
  }

  return out
}

export async function POST(request) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }

  let payload
  try {
    payload = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const { email, password, mfaCode, since } = payload || {}
  if (!email || !password) {
    return Response.json({ error: 'email and password are required.' }, { status: 400 })
  }

  // Regenerated per request rather than module-scoped like the Deno version's
  // top-level `crypto.randomUUID()` — a serverless instance can be reused
  // across different users' requests, so this must not be shared state.
  const deviceUuid = crypto.randomUUID()

  try {
    const token = await login(deviceUuid, email, password, mfaCode)
    const transactions = await fetchTransactions(deviceUuid, token, since)
    return Response.json({ transactions, count: transactions.length })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 })
  }
}
