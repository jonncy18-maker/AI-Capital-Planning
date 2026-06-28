// Supabase Edge Function: monarch-sync
//
// Pulls transactions from Monarch Money's private GraphQL API (the same backend
// the Monarch web app uses) and returns them normalized to the column shape the
// app's Monarch CSV import already understands. Monarch has no official public
// API; this mirrors the community connectors (e.g. the `monarchmoney` Python
// library). It is therefore UNOFFICIAL and may break if Monarch changes its
// schema or auth — the Monarch CSV export remains the supported fallback.
//
// Why server-side: Monarch's endpoint is not CORS-enabled and the session token
// must never live in browser JS. Credentials are received over the function's
// authenticated channel (Supabase verifies the user's JWT at the gateway), used
// once to obtain a short-lived token, and never persisted.
//
// Deploy:
//   supabase functions deploy monarch-sync
//
// Invoked from the app via supabase.functions.invoke('monarch-sync', { body }).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

const MONARCH_GRAPHQL = 'https://api.monarchmoney.com/graphql'
const MONARCH_LOGIN = 'https://api.monarchmoney.com/auth/login/'
const DEVICE_UUID = crypto.randomUUID()

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

function baseHeaders(token?: string) {
  const h: Record<string, string> = {
    'content-type': 'application/json',
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'en-US,en;q=0.9',
    'client-platform': 'web',
    'device-uuid': DEVICE_UUID,
    'origin': 'https://app.monarchmoney.com',
    'referer': 'https://app.monarchmoney.com/',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'sec-ch-ua': '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
  }
  if (token) h['authorization'] = `Token ${token}`
  return h
}

// Exchange email/password (+ optional MFA) for a session token.
async function login(email: string, password: string, mfaCode?: string | null): Promise<string> {
  const res = await fetch(MONARCH_LOGIN, {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify({
      username: email,
      password,
      trusted_device: true,
      supports_mfa: true,
      ...(mfaCode ? { totp: mfaCode } : {}),
    }),
  })

  if (res.status === 429) {
    throw new Error('Monarch is rate-limiting login attempts. Wait at least 30 minutes before trying again — each attempt resets the window.')
  }
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
async function fetchTransactions(token: string, since?: string | null) {
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
  const out: Array<Record<string, unknown>> = []

  // Hard cap pages to keep a single sync bounded.
  for (let page = 0; page < 40; page++) {
    const res = await fetch(MONARCH_GRAPHQL, {
      method: 'POST',
      headers: baseHeaders(token),
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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let payload: { email?: string; password?: string; mfaCode?: string | null; since?: string | null }
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400)
  }

  const { email, password, mfaCode, since } = payload
  if (!email || !password) {
    return json({ error: 'email and password are required.' }, 400)
  }

  try {
    const token = await login(email, password, mfaCode)
    const transactions = await fetchTransactions(token, since)
    return json({ transactions, count: transactions.length })
  } catch (e) {
    return json({ error: (e as Error).message }, 400)
  }
})
