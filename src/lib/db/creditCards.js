// Neon-backed client seam for credit card data, fronting app/api/credit-cards/*
// routes (Neon Auth session cookie via credentials: 'include' — no token
// handling). `userId` params are kept for signature compatibility with
// existing callers even though the routes derive the real identity from the
// session itself.

async function parseJsonOrThrow(res) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return body
}

async function noContentOrThrow(res) {
  if (res.status === 204) return
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
}

// ─── Credit Cards ─────────────────────────────────────────────────────────────

export async function getCreditCards(_userId) {
  const res = await fetch('/api/credit-cards', { credentials: 'include' })
  const data = await parseJsonOrThrow(res)
  return data ?? []
}

export async function upsertCreditCard(_userId, card) {
  const res = await fetch('/api/credit-cards', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(card),
  })
  return parseJsonOrThrow(res)
}

export async function deleteCreditCard(id) {
  const res = await fetch(`/api/credit-cards/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  await noContentOrThrow(res)
}

// ─── Earn Rates ───────────────────────────────────────────────────────────────

export async function getEarnRates(_userId) {
  const res = await fetch('/api/credit-cards/earn-rates', { credentials: 'include' })
  const data = await parseJsonOrThrow(res)
  return data ?? []
}

export async function upsertEarnRate(_userId, cardId, ccCategory, earnRate) {
  const res = await fetch('/api/credit-cards/earn-rates', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cardId, ccCategory, earnRate }),
  })
  return parseJsonOrThrow(res)
}

export async function deleteEarnRate(cardId, ccCategory) {
  const params = new URLSearchParams({ cardId, ccCategory })
  const res = await fetch(`/api/credit-cards/earn-rates?${params.toString()}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  await noContentOrThrow(res)
}

// Returns a nested map: { [cardId]: { [cc_category]: earn_rate } }
// Pure in-memory helper — does not touch the network.
export function buildEarnRateMap(earnRates) {
  const map = {}
  for (const r of earnRates) {
    if (!map[r.card_id]) map[r.card_id] = {}
    map[r.card_id][r.cc_category] = Number(r.earn_rate)
  }
  return map
}

// ─── Points Balances ──────────────────────────────────────────────────────────

// Returns the latest snapshot per card as a map: { [cardId]: { balance, as_of_date } }
export async function getPointsBalances(_userId) {
  const res = await fetch('/api/credit-cards/points', { credentials: 'include' })
  return parseJsonOrThrow(res)
}

export async function upsertPointsBalance(_userId, cardId, balance, asOfDate) {
  const res = await fetch('/api/credit-cards/points', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cardId, balance, asOfDate }),
  })
  return parseJsonOrThrow(res)
}

// ─── Planned Redemptions ──────────────────────────────────────────────────────

export async function getPointRedemptions(_userId, year) {
  const params = new URLSearchParams({ year: String(year) })
  const res = await fetch(`/api/credit-cards/redemptions?${params.toString()}`, {
    credentials: 'include',
  })
  const data = await parseJsonOrThrow(res)
  return data ?? []
}

export async function upsertPointRedemption(_userId, redemption) {
  const res = await fetch('/api/credit-cards/redemptions', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(redemption),
  })
  return parseJsonOrThrow(res)
}

export async function deletePointRedemption(id) {
  const res = await fetch(`/api/credit-cards/redemptions/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  await noContentOrThrow(res)
}

// ─── Transaction account detection ───────────────────────────────────────────

// Returns distinct account names from transactions with their transaction counts,
// for the AI to classify as credit cards. Caller passes result to parseCreditCardsFromTransactions.
export async function getDistinctTransactionAccounts(_userId) {
  const res = await fetch('/api/credit-cards/transaction-accounts', { credentials: 'include' })
  const data = await parseJsonOrThrow(res)
  return data ?? []
}

// ─── CC Settings (from user_profiles) ────────────────────────────────────────

export async function getCCSettings(_userId) {
  const res = await fetch('/api/credit-cards/settings', { credentials: 'include' })
  return parseJsonOrThrow(res)
}

export async function updateCCSettings(_userId, { coveragePct, optimizationPct }) {
  const res = await fetch('/api/credit-cards/settings', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ coveragePct, optimizationPct }),
  })
  await parseJsonOrThrow(res)
}
