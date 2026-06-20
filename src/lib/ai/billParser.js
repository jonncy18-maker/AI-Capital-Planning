import { supabase } from '../supabase.js'
import { AI_MODEL_FAMILIES } from './models.js'
import { readXlsx } from '../xlsx/xlsxReader.js'

// Convert xlsx sheets to a compact, readable text representation for Claude.
function sheetsToText(sheets) {
  return sheets.map(sheet => {
    const nonEmpty = sheet.rows.filter(r => r.some(c => c !== '' && c != null))
    const lines = nonEmpty.map(r => r.join('\t'))
    return `=== Sheet: ${sheet.name} ===\n${lines.join('\n')}`
  }).join('\n\n')
}

const SYSTEM = `You are a financial data parser. Your only job is to extract recurring bills from spreadsheet content and return valid JSON. No explanation, no markdown fences, no extra text — just the raw JSON array.`

const BILL_TYPES = ['credit_card', 'loan', 'rent', 'investment', 'subscription', 'other']

export async function parseBillsFromFile(file) {
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

  // Truncate generously but not excessively
  if (text.length > 18000) text = text.slice(0, 18000) + '\n... [truncated]'

  const userPrompt = `Extract every recurring bill or payment from this spreadsheet.

For each bill return a JSON object with these exact keys:
- "name": string — the bill or payment name (e.g. "Chase Sapphire", "Rent", "Vanguard IRA")
- "bill_type": one of ${BILL_TYPES.map(t => `"${t}"`).join(', ')}
- "due_day": integer 1–31 — day of month the bill is due
- "pay_same_as_due": boolean — true if the payment date equals the due date
- "pay_day": integer 1–31 — day of month payment is actually made (equals due_day when pay_same_as_due is true)
- "payment_method": "auto" if automatic/autopay, "manual" if manually initiated
- "fixed_amount": number or null — the fixed monthly amount, or null if the amount varies month to month (e.g. credit card balances)

Rules:
- Only include recurring bills (monthly or more frequent). Skip one-off transfers.
- If a bill appears twice (e.g. rent paid on 5th and 20th), include it as two separate entries.
- Credit card payments are almost always variable (fixed_amount: null).
- Investment contributions and loan payments are usually fixed.
- If a bill is marked "Auto" or "Automatic", set payment_method to "auto".

Return ONLY a JSON array. No explanation. No markdown. No wrapper object. Start your response with [ and end with ].

Spreadsheet content:
${text}`

  // Route through the ai-chat Edge Function (same path as the rest of the app),
  // which holds the Anthropic key server-side. The browser never sees the key.
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

  // Extract JSON array robustly — Claude may emit minor surrounding text
  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('AI did not return a recognisable bill list. Try again or enter bills manually.')

  const parsed = JSON.parse(match[0])
  if (!Array.isArray(parsed)) throw new Error('Unexpected response format from AI.')

  // Sanitise each entry so the caller gets clean data
  return parsed.map((b, i) => ({
    name:            String(b.name || `Bill ${i + 1}`).trim(),
    bill_type:       BILL_TYPES.includes(b.bill_type) ? b.bill_type : 'other',
    due_day:         Math.max(1, Math.min(31, parseInt(b.due_day) || 1)),
    pay_same_as_due: b.pay_same_as_due !== false,
    pay_day:         Math.max(1, Math.min(31, parseInt(b.pay_day) || parseInt(b.due_day) || 1)),
    payment_method:  b.payment_method === 'auto' ? 'auto' : 'manual',
    fixed_amount:    b.fixed_amount != null && !isNaN(Number(b.fixed_amount)) ? Number(b.fixed_amount) : null,
  }))
}
