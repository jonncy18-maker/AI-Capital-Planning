// Pure planning step for the Monarch CSV import (no I/O): decides which parsed
// rows are new, already imported, reclassified or ambiguous, and how unknown
// categories get mapped. The route executes the plan; preview and commit share
// one plan so a dry run shows exactly what a commit will do.

import { buildDedupKey } from '../db/transactions.js'
import { applyMappings } from '../csv/categoryMap.js'

export const FALLBACK_GROUP = 'Uncategorized'
export const FALLBACK_TYPE = 'Flexible'
export const SIMILARITY_FLOOR = 0.5
export const NEW_SAMPLE_LIMIT = 20
export const LIST_LIMIT = 200

export const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const trimmed = (s) => String(s ?? '').trim()

function jaccard(a, b) {
  const A = new Set(norm(a).split(' ').filter(Boolean))
  const B = new Set(norm(b).split(' ').filter(Boolean))
  if (A.size === 0 || B.size === 0) return 0
  let shared = 0
  for (const t of A) if (B.has(t)) shared++
  return shared / (A.size + B.size - shared)
}

function mostCommonType(catMap, group) {
  const counts = {}
  for (const m of Object.values(catMap)) {
    if (m.group === group && m.type) counts[m.type] = (counts[m.type] ?? 0) + 1
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? FALLBACK_TYPE
}

// One distinct unknown Monarch category -> the group/type it borrows.
function autoMapCategory(cat, catMap, categoryGroups) {
  const names = Object.keys(catMap).sort((a, b) => a.localeCompare(b))
  const normCat = norm(cat)

  const exact = names.find(k => norm(k) === normCat)
  if (exact) {
    const { group, type } = catMap[exact]
    return { group, type, reason: 'name_match', matched_to: exact }
  }

  const supplied = categoryGroups?.[cat]
  if (supplied) {
    const groups = [...new Set(Object.values(catMap).map(m => m.group).filter(Boolean))].sort()
    const group = groups.find(g => norm(g) === norm(supplied))
    if (group) return { group, type: mostCommonType(catMap, group), reason: 'monarch_group', matched_to: group }
  }

  let best = null
  for (const k of names) {
    const similarity = jaccard(cat, k)
    if (similarity >= SIMILARITY_FLOOR && (!best || similarity > best.similarity)) best = { k, similarity }
  }
  if (best) {
    const { group, type } = catMap[best.k]
    return { group, type, reason: 'closest', matched_to: best.k, similarity: Math.round(best.similarity * 100) / 100 }
  }

  return { group: FALLBACK_GROUP, type: FALLBACK_TYPE, reason: 'fallback', matched_to: null }
}

export function buildImportPlan({
  parsedRows,
  parseErrors = [],
  existingByKey = new Map(),
  categories = [],
  seedData = [],
  categoryGroups = {},
  columns = {},
}) {
  const catMap = {}
  for (const s of seedData) catMap[s.category] = { group: s.group, type: s.type }
  for (const c of categories) {
    if (c.category && c.group) catMap[c.category] = { group: c.group, type: c.type }
  }
  const userNames = new Set(categories.map(c => c.category))
  const seedToInsert = seedData.filter(s => !userNames.has(s.category))

  const fileCategories = [...new Set(parsedRows.map(r => r.category).filter(Boolean))]
  const autoMappings = []
  const autoMapped = {}
  for (const cat of fileCategories) {
    if (userNames.has(cat) || Object.hasOwn(catMap, cat)) continue
    const m = autoMapCategory(cat, catMap, categoryGroups)
    autoMapped[cat] = { group: m.group, type: m.type }
    autoMappings.push({
      monarch_category: cat,
      category: cat,
      group: m.group,
      type: m.type,
      reason: m.reason,
      matched_to: m.matched_to,
      ...(m.similarity != null ? { similarity: m.similarity } : {}),
      created: false,
    })
  }

  const mapped = applyMappings(parsedRows, { ...catMap, ...autoMapped })

  const byKey = new Map()
  for (const r of mapped) {
    const key = buildDedupKey(r)
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(r)
  }

  const newRows = []
  const reclassifications = []
  const ambiguous = []
  let duplicate = 0
  let collapsedIdentical = 0
  let ambiguousRows = 0

  for (const [key, rows] of byKey) {
    const first = rows[0]
    const sameAll = rows.every(r =>
      trimmed(r.category) === trimmed(first.category) &&
      trimmed(r.notes) === trimmed(first.notes) &&
      trimmed(r.tags) === trimmed(first.tags))
    if (!sameAll) {
      ambiguousRows += rows.length
      ambiguous.push({
        key,
        rows: rows.length,
        categories: [...new Set(rows.map(r => r.category))],
        reason: 'same date/merchant/amount/account with different category, notes or tags',
      })
      continue
    }
    collapsedIdentical += rows.length - 1

    const existing = existingByKey.get(key)
    if (!existing) {
      newRows.push(first)
      continue
    }
    const tagsDiffer = !!columns.tags && existing.tags != null && trimmed(existing.tags) !== trimmed(first.tags)
    const changed = trimmed(existing.category) !== trimmed(first.category) ||
      trimmed(existing.notes) !== trimmed(first.notes) || tagsDiffer
    if (!changed) {
      duplicate++
      continue
    }
    reclassifications.push({
      id: existing.id,
      date: first.date,
      merchant: first.merchant,
      amount: first.amount,
      account: first.account,
      before: { category: existing.category ?? '', notes: existing.notes ?? '' },
      after: { category: first.category, notes: first.notes, group: first.group },
      update: {
        id: existing.id,
        dedup_key: key,
        category: first.category,
        group: first.group,
        notes: first.notes,
        ...(columns.tags ? { tags: first.tags } : {}),
      },
    })
  }

  return {
    counts: {
      parsed: parsedRows.length,
      parse_errors: parseErrors.length,
      new: newRows.length,
      duplicate,
      reclassified: reclassifications.length,
      ambiguous_rows: ambiguousRows,
      collapsed_identical: collapsedIdentical,
      inserted: 0,
      skipped_duplicate: 0,
    },
    newRows,
    reclassifications,
    ambiguous,
    autoMappings,
    seedToInsert,
    parseErrors,
  }
}

function capped(list) {
  return list.length > LIST_LIMIT
    ? { list: list.slice(0, LIST_LIMIT), truncated: list.length - LIST_LIMIT }
    : { list, truncated: 0 }
}

// Shapes the plan into the JSON returned to the caller. `commit` carries the
// real outcome (inserted, skipped_duplicate, reclassified, import_log_id) once
// the plan has been executed.
export function shapeImportResult(plan, { mode, filename, chunk, columns = {}, commit = null }) {
  const committed = !!commit
  const counts = { ...plan.counts }
  if (committed) {
    counts.inserted = commit.inserted
    counts.skipped_duplicate = commit.skipped_duplicate
    counts.reclassified = commit.reclassified
  }

  const rec = capped(plan.reclassifications.map(r => { const rest = { ...r }; delete rest.update; return rest }))
  const amb = capped(plan.ambiguous)

  const notes = ['Identical purchases on the same day/account collapse to one row (existing behaviour).']
  if (plan.counts.ambiguous_rows > 0) {
    notes.push('Ambiguous rows were skipped; fix them in Monarch or import them by hand.')
  }
  if (!columns.mappingSource) {
    notes.push('Migration 027 is not applied: auto-created categories carry no marker and are identifiable only from this result.')
  }
  if (!columns.tags) notes.push('Tags are not stored yet (migration 027 not applied); they were ignored.')
  if (chunk) {
    notes.push(
      'Chunk mode: each chunk needs the header row and a date boundary, ambiguity and collapsing are checked within one chunk only, ' +
      'a preview cannot see earlier uncommitted chunks (commit in order), and totals are the sum of per-chunk counts.'
    )
  }

  return {
    mode,
    committed,
    filename,
    ...(chunk ? { chunk } : {}),
    counts,
    new_sample: plan.newRows.slice(0, NEW_SAMPLE_LIMIT).map(r => ({
      date: r.date, merchant: r.merchant, amount: r.amount, account: r.account, category: r.category, group: r.group,
    })),
    reclassified: rec.list,
    ...(rec.truncated ? { reclassified_truncated: rec.truncated } : {}),
    ambiguous: amb.list,
    ...(amb.truncated ? { ambiguous_truncated: amb.truncated } : {}),
    auto_mappings: plan.autoMappings.map(a => ({ ...a, created: committed })),
    parse_errors: plan.parseErrors,
    marker_column_present: !!columns.mappingSource,
    tags_column_present: !!columns.tags,
    notes,
    ...(committed
      ? { import_log_id: commit.import_log_id ?? null }
      : { next: 'Nothing was saved. Call again with mode:"commit" to apply.' }),
  }
}
