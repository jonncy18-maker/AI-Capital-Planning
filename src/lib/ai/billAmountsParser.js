import { supabase } from '../supabase.js'
import { AI_MODEL_FAMILIES } from './models.js'
import { readXlsx } from '../xlsx/xlsxReader.js'
import { parserSystem, JSON_ARRAY_RULE, sheetsToText } from './parserBase.js'

const SYSTEM = parserSystem('extract historical bill amounts from spreadsheet content')

export async function parseBillAmountsFromFile(file) {
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

  const userPrompt = `Extract every bill or payment amount from this spreadsheet.

For each entry return a JSON object with these exact keys:
- "billName": string — the bill or payee name
- "year": integer — 4-digit year
- "month": integer — month number 1–12
- "amount": number — the positive dollar amount paid

Rules:
- Skip header rows, totals rows, and any row without a clear payee + date + amount.
- If the same bill appears multiple times in the same month, keep the most recent or largest amount.
- Convert all amounts to positive numbers (no negative values).

${JSON_ARRAY_RULE}

Spreadsheet content:
${text}`

  const { data, error } = await supabase.functions.invoke('ai-chat', {
    body: {
      system: SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 4096,
      modelFamily: AI_MODEL_FAMILIES.assistant,
    },
  })

  if (error) throw new Error(`Could not reach the AI service: ${error.message}`)
  if (data?.error) throw new Error(data.error)

  const raw = data?.text ?? ''

  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('AI did not return a recognisable amounts list. Try again or enter amounts manually.')

  const parsed = JSON.parse(match[0])
  if (!Array.isArray(parsed)) throw new Error('Unexpected response format from AI.')

  return parsed.map(r => ({
    billName: String(r.billName || '').trim(),
    year:     Math.max(2000, Math.min(2100, parseInt(r.year) || new Date().getFullYear())),
    month:    Math.max(1, Math.min(12, parseInt(r.month) || 1)),
    amount:   Math.max(0, Number(r.amount) || 0),
  })).filter(r => r.billName && r.amount > 0)
}
