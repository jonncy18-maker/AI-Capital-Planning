// Monarch Money CSV parser.
// Expected columns: Date, Merchant, Category, Account, Original Statement, Notes, Amount, Tags, Owner

import { parseLooseMoney } from '../money.js'

const REQUIRED_COLS = ['Date', 'Merchant', 'Category', 'Account', 'Original Statement', 'Notes', 'Amount', 'Tags', 'Owner']

function parseCSVLine(line) {
  const result = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}

function stripQuotes(s) {
  s = s.trim()
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).trim()
  return s
}

export function detectMonarchFormat(headers) {
  const norm = headers.map(h => stripQuotes(h))
  return REQUIRED_COLS.every(col => norm.includes(col))
}

// Split raw CSV text into logical records. A newline only ends a record when it
// is outside quotes, so quoted fields (Notes, Merchant) may span several lines.
// Blank records are dropped. `unterminated` is true when a quote is still open at
// the end of the text; the last entry in `records` is then that unfinished record.
function splitRecords(raw) {
  const records = []
  let current = ''
  let inQuotes = false

  const flush = () => {
    if (current.trim()) records.push(current)
    current = ''
  }

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '"') {
      inQuotes = !inQuotes // a doubled quote ("") toggles twice, so it stays inside the field
      current += ch
    } else if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && raw[i + 1] === '\n') i++
      flush()
    } else {
      current += ch
    }
  }
  const unterminated = inQuotes
  flush()
  return { records, unterminated }
}

// Parse a Monarch Money CSV string into an array of row objects.
// Returns { rows, errors, headers }.
export function parseMonarchCSV(raw) {
  const { records: nonEmpty, unterminated } = splitRecords(raw)

  if (nonEmpty.length < 2) {
    return { rows: [], errors: ['CSV file has no data rows.'], headers: [] }
  }

  const headers = parseCSVLine(nonEmpty[0]).map(stripQuotes)
  const colIdx = {}
  headers.forEach((h, i) => { colIdx[h] = i })

  const missing = REQUIRED_COLS.filter(c => !(c in colIdx))
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [`Missing expected columns: ${missing.join(', ')}. Found: ${headers.join(', ')}`],
      headers,
    }
  }

  const rows = []
  const errors = []

  // An unterminated quote leaves the last record unfinished; report it instead of importing it.
  const parseEnd = unterminated ? nonEmpty.length - 1 : nonEmpty.length

  for (let i = 1; i < parseEnd; i++) {
    const line = nonEmpty[i].trim()
    if (!line) continue

    try {
      const cols = parseCSVLine(line).map(stripQuotes)

      const date = cols[colIdx['Date']] || ''
      const merchant = cols[colIdx['Merchant']] || ''
      const category = cols[colIdx['Category']] || ''
      const account = cols[colIdx['Account']] || ''
      const originalStatement = cols[colIdx['Original Statement']] || ''
      const notes = cols[colIdx['Notes']] || ''
      const amountRaw = cols[colIdx['Amount']] || '0'
      const tags = cols[colIdx['Tags']] || ''
      const owner = cols[colIdx['Owner']] || ''

      if (!date) {
        errors.push(`Row ${i + 1}: missing date — skipped.`)
        continue
      }
      if (!merchant) {
        errors.push(`Row ${i + 1}: missing merchant — skipped.`)
        continue
      }

      // A record that ends before the Amount column is truncated, not a zero-dollar row.
      // (A present-but-blank Amount still means 0, and trailing Tags/Owner may be absent.)
      if (cols.length <= colIdx['Amount']) {
        errors.push(`Row ${i + 1}: no amount column — skipped.`)
        continue
      }

      // Parse amount — Monarch exports expenses as negative, income as positive.
      const amount = parseLooseMoney(amountRaw)
      if (amount === null) {
        errors.push(`Row ${i + 1}: invalid amount "${amountRaw}" — skipped.`)
        continue
      }

      rows.push({
        date,
        merchant,
        category,
        account,
        originalStatement,
        notes,
        amount,
        tags,
        owner,
        importSource: 'monarch_csv',
      })
    } catch (err) {
      errors.push(`Row ${i + 1}: parse error — ${err.message}`)
    }
  }

  if (unterminated) {
    errors.push(`Row ${nonEmpty.length}: unterminated quote — this row and anything after it were not imported.`)
  }

  return { rows, errors, headers }
}
