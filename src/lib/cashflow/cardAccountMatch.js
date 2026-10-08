// Attributes Monarch account names to credit_cards rows. There is no explicit
// mapping column, so match on the "(...dddd)" last four first, then on the
// normalized name tokens. Pure.

const STOPWORDS = new Set([
  'the', 'card', 'visa', 'mastercard', 'credit', 'chase', 'world', 'of', 'signature', 'rewards',
])

function lastFourOf(name) {
  const m = /\(\.\.\.(\d{4})\)/.exec(name)
  return m ? m[1] : null
}

function tokenKey(name) {
  const tokens = String(name ?? '')
    .toLowerCase()
    .replace(/american express/g, 'amex')
    .replace(/\([^)]*\)/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter(t => t && !STOPWORDS.has(t))
  return tokens.length ? [...new Set(tokens)].sort().join(' ') : null
}

// Returns Map<accountName, cardId>. An account that fits more than one card, or
// none, is left out.
export function matchAccountsToCards(cards, accountNames) {
  const out = new Map()
  const list = cards ?? []
  const cardKeys = list.map(c => tokenKey(c.name))

  for (const account of new Set(accountNames ?? [])) {
    if (typeof account !== 'string' || !account) continue

    const four = lastFourOf(account)
    if (four) {
      const hits = list.filter(c => c.last_four && String(c.last_four) === four)
      if (hits.length === 1) out.set(account, hits[0].id)
      if (hits.length > 0) continue
    }

    const key = tokenKey(account)
    if (!key) continue
    const hits = list.filter((_, i) => cardKeys[i] === key)
    if (hits.length === 1) out.set(account, hits[0].id)
  }
  return out
}
