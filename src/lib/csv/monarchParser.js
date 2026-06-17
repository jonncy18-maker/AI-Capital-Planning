// Monarch Money CSV parser.
// Expected columns: Date, Merchant, Category, Account, Original Statement, Notes, Amount, Tags, Owner

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

// Parse a Monarch Money CSV string into an array of row objects.
// Returns { rows, errors, headers }.
export function parseMonarchCSV(raw) {
  const lines = raw.split(/\r?\n/)
  const nonEmpty = lines.filter(l => l.trim())

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

  for (let i = 1; i < nonEmpty.length; i++) {
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

      // Parse amount — Monarch exports expenses as negative, income as positive.
      const amount = parseFloat(amountRaw.replace(/[^-\d.]/g, ''))
      if (isNaN(amount)) {
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

  return { rows, errors, headers }
}
