import { invokeAIChatRaw } from './aiChatRaw.js'
import { AI_MODEL_FAMILIES } from './models.js'
import { readXlsx } from '../xlsx/xlsxReader.js'
import { parserSystem, sheetsToText } from './parserBase.js'

const SYSTEM = parserSystem('extract credit card information')

const NETWORKS = ['visa', 'mastercard', 'amex', 'discover', 'other']

function sanitize(cards) {
  return cards.map((c, i) => {
    // Sanitize earn_rates: only keep known slugs with numeric values
    const rawRates = c.earn_rates && typeof c.earn_rates === 'object' ? c.earn_rates : {}
    const earn_rates = {}
    for (const slug of CC_CATEGORY_SLUGS) {
      const v = rawRates[slug]
      if (v != null && !isNaN(Number(v))) earn_rates[slug] = Number(v)
    }
    if (!earn_rates.other) earn_rates.other = 1.0

    return {
      name:                 String(c.name || `Card ${i + 1}`).trim(),
      issuer:               c.issuer ? String(c.issuer).trim() : null,
      network:              NETWORKS.includes(c.network) ? c.network : 'other',
      last_four:            c.last_four ? String(c.last_four).replace(/\D/g, '').slice(-4) : null,
      points_program:       c.points_program ? String(c.points_program).trim() : null,
      is_default:           c.is_default === true,
      statement_close_day:  c.statement_close_day ? Math.max(1, Math.min(31, parseInt(c.statement_close_day))) : null,
      due_days_after_close: c.due_days_after_close ? Math.max(1, parseInt(c.due_days_after_close)) : 21,
      annual_fee:           c.annual_fee != null && !isNaN(Number(c.annual_fee)) ? Number(c.annual_fee) : null,
      annual_fee_month:     c.annual_fee_month ? Math.max(1, Math.min(12, parseInt(c.annual_fee_month))) : null,
      points_value_cents:   c.points_value_cents != null && !isNaN(Number(c.points_value_cents)) ? Number(c.points_value_cents) : 1.0,
      earn_rates,
      color:                null,
    }
  })
}

// CC reward category slugs used by the points engine
const CC_CATEGORY_SLUGS = ['dining', 'travel', 'groceries', 'gas', 'streaming', 'transit', 'online_shopping', 'drugstore', 'other']

const SHARED_PROMPT_SUFFIX = `
For each credit card return a JSON object with these exact keys:
- "name": string — clean, short card name (e.g. "Sapphire Preferred", "Venture X", "Amex Gold")
- "issuer": string — card issuer (e.g. "Chase", "Capital One", "American Express", "Citi", "Discover")
- "network": one of "visa", "mastercard", "amex", "discover", "other"
- "last_four": string or null — last 4 digits of card number if present
- "points_program": string or null — rewards program name (e.g. "Chase Ultimate Rewards", "Amex Membership Rewards", "Capital One Miles", "World of Hyatt")
- "is_default": boolean — true if this is labeled as primary, default, or main everyday card
- "statement_close_day": integer 1–31 or null — day of month statement closes
- "due_days_after_close": integer or null — days after statement close that payment is due (typically 21)
- "annual_fee": number or null — annual fee in dollars
- "annual_fee_month": integer 1–12 or null — month the annual fee is charged
- "points_value_cents": number — estimated cents per point value:
    1.0 = flat cash-back or basic rewards
    1.85 = Capital One Venture X / Venture
    2.0 = Chase Sapphire Preferred/Reserve (transfer partner redemptions)
    2.2 = Amex Membership Rewards (transfer partners)
    1.5 = World of Hyatt / mid-tier travel
    0.5 = Amazon/store rewards at face value
- "earn_rates": object — earn multipliers per spend category (use your knowledge of each card's actual rewards structure).
    Keys must be from: ${CC_CATEGORY_SLUGS.map(s => `"${s}"`).join(', ')}
    Values are multipliers (e.g. 3.0 = 3x points). Always include "other" as the base earn rate.
    Examples:
      Chase Sapphire Preferred: {"dining":3,"travel":2,"groceries":3,"streaming":2,"online_shopping":3,"other":1}
      Chase Sapphire Reserve: {"dining":3,"travel":3,"groceries":1,"streaming":1,"other":1}
      Capital One Venture X: {"travel":10,"dining":2,"groceries":2,"other":2}
      Amex Gold: {"dining":4,"groceries":4,"travel":3,"other":1}
      Chase Freedom Flex: {"dining":3,"drugstore":3,"travel":5,"other":1}
      Chase Freedom Unlimited: {"dining":3,"drugstore":3,"travel":5,"other":1.5}
      Hyatt Visa: {"travel":4,"dining":2,"groceries":2,"other":1}
      Amazon Prime Card: {"online_shopping":5,"dining":2,"gas":2,"transit":2,"other":1}
      Capital One Savor: {"dining":4,"groceries":3,"streaming":4,"transit":3,"other":1}
      Discover it: {"other":1}

Rules:
- Only include credit cards, not bank accounts or loans.
- Infer issuer and network from card name when not explicit (Chase → Visa, Amex → Amex network, Capital One → Visa).
- For earn_rates, use the card's actual published rewards structure. If the card has rotating categories, use the base/non-rotating rates.
- Return ONLY a JSON array. No explanation. No markdown. Start with [ and end with ].`

// ─── Parse from uploaded file (xlsx/csv) ─────────────────────────────────────

export async function parseCreditCardsFromFile(file) {
  let text = ''
  const name = file.name.toLowerCase()

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const buffer = await file.arrayBuffer()
    const { sheets } = await readXlsx(buffer)
    text = sheetsToText(sheets)
  } else if (name.endsWith('.csv')) {
    text = await file.text()
  } else {
    throw new Error('Please upload an .xlsx, .xls, or .csv file.')
  }

  if (text.length > 18000) text = text.slice(0, 18000) + '\n... [truncated]'

  const userPrompt = `Extract every credit card from this spreadsheet.
${SHARED_PROMPT_SUFFIX}

Spreadsheet content:
${text}`

  const { data, error } = await invokeAIChatRaw({
    system: SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
    maxTokens: 2048,
    modelFamily: AI_MODEL_FAMILIES.assistant,
  })

  if (error) throw new Error(`Could not reach the AI service: ${error.message}`)
  if (data?.error) throw new Error(data.error)

  const raw = data?.text ?? ''
  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('AI did not return a recognisable card list. Try again or enter cards manually.')

  const parsed = JSON.parse(match[0])
  if (!Array.isArray(parsed)) throw new Error('Unexpected response format from AI.')
  return sanitize(parsed)
}

// ─── Detect from Monarch transaction accounts ─────────────────────────────────

export async function parseCreditCardsFromTransactions(accountNames) {
  if (!accountNames || accountNames.length === 0) return []

  const userPrompt = `These are account names from my personal finance transaction history. Identify which are credit cards and return enriched card details for each one.

Account names (with transaction counts):
${accountNames.map(a => `- ${a.account} (${a.txn_count} transactions)`).join('\n')}
${SHARED_PROMPT_SUFFIX}

Additional rule: include an "account_name" key with the exact original account name string so I can match back to the source.`

  const { data, error } = await invokeAIChatRaw({
    system: SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
    maxTokens: 2048,
    modelFamily: AI_MODEL_FAMILIES.assistant,
  })

  if (error) throw new Error(`Could not reach the AI service: ${error.message}`)
  if (data?.error) throw new Error(data.error)

  const raw = data?.text ?? ''
  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('AI did not find any credit cards in your transaction accounts.')

  const parsed = JSON.parse(match[0])
  if (!Array.isArray(parsed)) throw new Error('Unexpected response format from AI.')

  return sanitize(parsed).map((c, i) => ({
    ...c,
    account_name: parsed[i]?.account_name ?? null,
  }))
}
