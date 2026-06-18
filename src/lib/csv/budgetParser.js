// Parser for a user's existing budget / category-map file.
//
// Many users already maintain a spreadsheet that maps their categories to
// higher-level buckets. Importing it is authoritative — it seeds the user's own
// groups so transaction imports map cleanly without AI guessing.
//
// Accepts either a CSV or an .xlsx workbook (see parseBudgetFile). Header
// detection is flexible: case-insensitive, punctuation-insensitive, and we
// scan the first rows for the header instead of assuming it's row one — real
// spreadsheets often have a title or blank rows above the table. Only a
// category column and a group column are required:
//   category : category, subcategory, name
//   group    : group, bucket, parent, category group, parent category
//   target   : monthly target, monthly budget, budget, target, amount
//   type     : type, expense type   (normalized to Fixed | Flexible | Non-Monthly)

import { readXlsx } from '../xlsx/xlsxReader.js'

const CATEGORY_ALIASES = ['category', 'subcategory', 'name']
const GROUP_ALIASES = ['group', 'bucket', 'parent', 'category group', 'parent category']
const TARGET_ALIASES = [
  'monthly target', 'monthly budget', 'monthly amount', 'monthly', 'per month',
  'avg monthly', 'monthly avg', 'budget', 'target', 'amount',
]
const ANNUAL_ALIASES = [
  'yearly', 'annual', 'yearly total', 'annual total', 'yearly budget',
  'annual budget', 'yearly amount', 'annual amount', 'year total',
]
const TYPE_ALIASES = ['type', 'expense type']

// How many rows to scan looking for the header row (title/blank rows above it).
const HEADER_SCAN_ROWS = 25

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
  return stripQuotes(String(h ?? '')).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
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

// Scan the top rows of a grid for the first row that contains both a category
// and a group column. Returns the column indices, or null if none qualifies.
function locateHeader(grid) {
  const limit = Math.min(grid.length, HEADER_SCAN_ROWS)
  for (let r = 0; r < limit; r++) {
    const headers = (grid[r] || []).map(normHeader)
    const catIdx = findCol(headers, CATEGORY_ALIASES)
    const groupIdx = findCol(headers, GROUP_ALIASES)
    if (catIdx !== -1 && groupIdx !== -1) {
      return {
        headerRow: r,
        catIdx,
        groupIdx,
        targetIdx: findCol(headers, TARGET_ALIASES),
        annualIdx: findCol(headers, ANNUAL_ALIASES),
        typeIdx: findCol(headers, TYPE_ALIASES),
        rawHeaders: grid[r],
      }
    }
  }
  return null
}

// Pull mapping rows out of a grid given a located header. First occurrence of a
// category wins; rows missing a category or group are skipped.
function extractRows(grid, loc) {
  const rows = []
  const seen = new Set()
  for (let i = loc.headerRow + 1; i < grid.length; i++) {
    const cols = grid[i] || []
    const category = String(cols[loc.catIdx] ?? '').trim()
    const group = String(cols[loc.groupIdx] ?? '').trim()
    if (!category || !group) continue
    if (seen.has(category)) continue
    seen.add(category)
    rows.push({
      category,
      group,
      type: loc.typeIdx >= 0 ? normType(cols[loc.typeIdx]) : null,
      monthlyTarget: loc.targetIdx >= 0 ? parseAmount(cols[loc.targetIdx]) : null,
      annual: loc.annualIdx >= 0 ? parseAmount(cols[loc.annualIdx]) : null,
    })
  }
  return rows
}

// Returns { rows: [{ category, group, type, monthlyTarget }], errors, headers }.
export function parseBudgetCSV(raw) {
  const lines = (raw ?? '').split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) {
    return { rows: [], errors: ['CSV file has no data rows.'], headers: [] }
  }

  const grid = lines.map(l => parseCSVLine(l).map(stripQuotes))
  const loc = locateHeader(grid)
  if (!loc) {
    const rawHeaders = grid[0] ?? []
    return {
      rows: [],
      errors: [`Need at least a "category" and a "group" column. Found: ${rawHeaders.join(', ')}`],
      headers: rawHeaders,
    }
  }

  const rows = extractRows(grid, loc)
  const errors = rows.length === 0 ? ['No rows with both a category and a group.'] : []
  return { rows, errors, headers: loc.rawHeaders }
}

// Normalize a name for matching a category to its detail tab: case-, space-,
// and punctuation-insensitive, with "&" treated as "and".
function normName(s) {
  return String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '')
}

// A detail tab lays out a single category month-by-month: a "Period" row of
// 1..12 marks the month columns, then each line item carries an amount per
// month. Sum every line item's month columns to get the category's true 12-month
// distribution. Returns number[12] or null if no Period 1..12 grid is found.
function extractMonthlyDetail(sheetRows) {
  let periodRow = -1
  let monthCols = null
  const scan = Math.min(sheetRows.length, 12)
  for (let r = 0; r < scan && !monthCols; r++) {
    const row = sheetRows[r] || []
    for (let s = 0; s + 12 <= row.length; s++) {
      let ok = true
      for (let k = 0; k < 12; k++) {
        if (parseAmount(row[s + k]) !== k + 1) { ok = false; break }
      }
      if (ok) {
        periodRow = r
        monthCols = Array.from({ length: 12 }, (_, k) => s + k)
        break
      }
    }
  }
  if (!monthCols) return null

  const labelCol = monthCols[0] - 1
  const months = Array(12).fill(0)
  for (let r = periodRow + 1; r < sheetRows.length; r++) {
    const row = sheetRows[r] || []
    const label = labelCol >= 0 ? normHeader(row[labelCol]) : ''
    if (label === 'quarter' || label === 'total' || label === 'period') continue
    for (let k = 0; k < 12; k++) {
      const v = parseAmount(row[monthCols[k]])
      if (v > 0) months[k] += v
    }
  }
  return months.some(v => v > 0) ? months : null
}

// Returns { rows, errors, headers, sheet } — scans every worksheet and keeps
// the one yielding the most mapping rows, so multi-tab workbooks "just work".
// Non-Monthly rows that have a matching detail tab (a sheet named after the
// category with a Period 1..12 grid) gain a `monthly12` array carrying their
// true month-by-month amounts; callers without one spread the annual evenly.
export async function parseBudgetWorkbook(arrayBuffer) {
  let wb
  try {
    wb = await readXlsx(arrayBuffer)
  } catch (e) {
    return { rows: [], errors: [e.message || 'Could not read that Excel file.'], headers: [] }
  }

  let best = null
  for (const sheet of wb.sheets) {
    const loc = locateHeader(sheet.rows)
    if (!loc) continue
    const rows = extractRows(sheet.rows, loc)
    if (rows.length && (!best || rows.length > best.rows.length)) {
      best = { rows, headers: loc.rawHeaders, sheet: sheet.name }
    }
  }

  if (!best) {
    const names = wb.sheets.map(s => s.name).filter(Boolean).join(', ')
    return {
      rows: [],
      errors: [`No sheet had both a "category" and a "group" column. Sheets checked: ${names || '(none)'}`],
      headers: [],
    }
  }

  // Pull true month-by-month detail for Non-Monthly categories backed by a tab.
  const detailByName = new Map()
  for (const sheet of wb.sheets) {
    if (sheet.name === best.sheet) continue
    detailByName.set(normName(sheet.name), sheet.rows)
  }
  for (const row of best.rows) {
    if (row.type !== 'Non-Monthly') continue
    const sheetRows = detailByName.get(normName(row.category))
    if (!sheetRows) continue
    const months = extractMonthlyDetail(sheetRows)
    if (months) row.monthly12 = months
  }

  return { rows: best.rows, errors: [], headers: best.headers, sheet: best.sheet }
}

// Routes a dropped/selected File to the right parser. Handles .xlsx workbooks,
// CSV/text, and a mislabeled file whose bytes are actually a ZIP (xlsx). Async.
export async function parseBudgetFile(file) {
  const buf = await file.arrayBuffer()
  const name = (file?.name || '').toLowerCase()
  const head = new Uint8Array(buf.slice(0, 2))
  const looksZip = head[0] === 0x50 && head[1] === 0x4b // "PK" — every .xlsx starts here

  if (name.endsWith('.xlsx') || name.endsWith('.xlsm') || looksZip) {
    return parseBudgetWorkbook(buf)
  }
  return parseBudgetCSV(new TextDecoder('utf-8').decode(buf))
}
