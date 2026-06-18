// Parser for a user's existing budget / category-map CSV.
//
// Many users already maintain a spreadsheet that maps their categories to
// higher-level buckets. Importing it is authoritative — it seeds the user's own
// groups so transaction imports map cleanly without AI guessing.
//
// Flexible header detection (case-insensitive, punctuation-insensitive). Only a
// category column and a group column are required:
//   category : category, subcategory, name
//   group    : group, bucket, parent, category group, parent category
//   target   : monthly target, monthly budget, budget, target, amount
//   type     : type, expense type   (normalized to Fixed | Flexible | Non-Monthly)

function parseCSVLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(current); current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}

function stripQuotes(s) {
  s = (s ?? '').trim()
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).trim()
  return s
}

function normHeader(h) {
  return stripQuotes(h).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function findCol(headers, candidates) {
  for (let i = 0; i < headers.length; i++) {
    if (candidates.includes(headers[i])) return i
  }
  return -1
}

function normType(raw) {
  const t = (raw ?? '').trim().toLowerCase()
  if (t.startsWith('fix')) return 'Fixed'
  if (t.startsWith('non')) return 'Non-Monthly'
  if (t.startsWith('flex')) return 'Flexible'
  return null
}

function parseAmount(raw) {
  if (raw == null || raw === '') return null
  const n = parseFloat(String(raw).replace(/[^-\d.]/g, ''))
  return isNaN(n) ? null : n
}

// Returns { rows: [{ category, group, type, monthlyTarget }], errors, headers }.
export function parseBudgetCSV(raw) {
  const lines = (raw ?? '').split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) {
    return { rows: [], errors: ['CSV file has no data rows.'], headers: [] }
  }

  const rawHeaders = parseCSVLine(lines[0]).map(stripQuotes)
  const headers = rawHeaders.map(normHeader)

  const catIdx = findCol(headers, ['category', 'subcategory', 'name'])
  const groupIdx = findCol(headers, ['group', 'bucket', 'parent', 'category group', 'parent category'])
  const targetIdx = findCol(headers, ['monthly target', 'monthly budget', 'budget', 'target', 'amount'])
  const typeIdx = findCol(headers, ['type', 'expense type'])

  if (catIdx === -1 || groupIdx === -1) {
    return {
      rows: [],
      errors: [`Need at least a "category" and a "group" column. Found: ${rawHeaders.join(', ')}`],
      headers: rawHeaders,
    }
  }

  const rows = []
  const errors = []
  const seen = new Set()

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]).map(stripQuotes)
    const category = (cols[catIdx] ?? '').trim()
    const group = (cols[groupIdx] ?? '').trim()
    if (!category || !group) continue        // need both to form a mapping
    if (seen.has(category)) continue          // first occurrence wins
    seen.add(category)
    rows.push({
      category,
      group,
      type: typeIdx >= 0 ? normType(cols[typeIdx]) : null,
      monthlyTarget: targetIdx >= 0 ? parseAmount(cols[targetIdx]) : null,
    })
  }

  if (rows.length === 0) errors.push('No rows with both a category and a group.')
  return { rows, errors, headers: rawHeaders }
}
