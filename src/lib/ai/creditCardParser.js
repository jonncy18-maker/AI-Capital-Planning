import { supabase } from '../supabase.js'
import { AI_MODEL_FAMILIES } from './models.js'
import { readXlsx } from '../xlsx/xlsxReader.js'

function sheetsToText(sheets) {
  return sheets.map(sheet => {
    const nonEmpty = sheet.rows.filter(r => r.some(c => c !== '' && c != null))
    const lines = nonEmpty.map(r => r.join('\t'))
    return `=== Sheet: ${sheet.name} ===\n${lines.join('\n')}`
  }).join('\n\n')
}

const SYSTEM = `You are a financial data parser. Your only job is to extract credit card information and return valid JSON. No explanation, no markdown fences, no extra text — just the raw JSON array.`

const NETWORKS = ['visa', 'mastercard', 'amex', 'discover', 'other']

function sanitize(cards) {
  return cards.map((c, i) => ({
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
    color:                null,
  }))
}

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
    1.5 = mid-tier travel card
    1.85 = Capital One Venture X
    2.0 = Chase Sapphire (transfer partner redemptions)
    2.2 = Amex Membership Rewards (transfer partners)
    1.5 = World of Hyatt points
    0.5 = Amazon/store rewards at face value

Rules:
- Only include credit cards, not bank accounts or loans.
- Infer issuer and network from card name when not explicit (Chase → Visa, Amex → Amex network, Capital One → Visa).
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

  const { data, error } = await supabase.functions.invoke('ai-chat', {
    body: {
      system: SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 2048,
      modelFamily: AI_MODEL_FAMILIES.assistant,
    },
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

  const { data, error } = await supabase.functions.invoke('ai-chat', {
    body: {
      system: SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 2048,
      modelFamily: AI_MODEL_FAMILIES.assistant,
    },
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
