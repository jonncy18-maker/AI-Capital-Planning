import { supabase } from '../supabase.js'
import { AI_MODEL_FAMILIES } from './models.js'
import { readXlsx } from '../xlsx/xlsxReader.js'
import { parserSystem, JSON_ARRAY_RULE, sheetsToText } from './parserBase.js'

const SYSTEM = parserSystem('extract bank and financial accounts from spreadsheet content')

const ACCOUNT_TYPES = ['checking', 'savings', 'investment', 'other']

export async function parseAccountsFromFile(file) {
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

  const userPrompt = `Extract every bank or financial account from this spreadsheet.

For each account return a JSON object with these exact keys:
- "name": string — the account name (e.g. "SoFi Checking", "Ally HYSA", "Fidelity Brokerage")
- "type": one of ${ACCOUNT_TYPES.map(t => `"${t}"`).join(', ')}
- "is_primary_checking": boolean — true only for the single main checking account that bills are paid from (the one cash flows through for day-to-day bill payments). If ambiguous or multiple checking accounts exist, set false and let the user decide.

Rules:
- Include checking, savings, investment, brokerage, and money market accounts.
- Skip credit cards — those are bills, not accounts.
- If the spreadsheet mentions a "main", "primary", or "operating" checking account, set is_primary_checking to true for that one only.
- Set type to "checking" for checking/transactional accounts, "savings" for savings/HYSA/money market, "investment" for brokerage/IRA/401k, "other" for anything else.

${JSON_ARRAY_RULE}

Spreadsheet content:
${text}`

  const { data, error } = await supabase.functions.invoke('ai-chat', {
    body: {
      system: SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 1024,
      modelFamily: AI_MODEL_FAMILIES.assistant,
    },
  })

  if (error) throw new Error(`Could not reach the AI service: ${error.message}`)
  if (data?.error) throw new Error(data.error)

  const raw = data?.text ?? ''
  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('AI did not return a recognisable account list. Try again or enter accounts manually.')

  const parsed = JSON.parse(match[0])
  if (!Array.isArray(parsed)) throw new Error('Unexpected response format from AI.')

  return parsed.map((a, i) => ({
    name:                String(a.name || `Account ${i + 1}`).trim(),
    type:                ACCOUNT_TYPES.includes(a.type) ? a.type : 'other',
    is_primary_checking: a.is_primary_checking === true,
  }))
}
