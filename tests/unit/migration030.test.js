import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const sql = readFileSync(new URL('../../db/migrations/030_import_undo.sql', import.meta.url), 'utf8')
// Comments can mention anything; the checks are about executable statements.
const code = sql.split('\n').map(l => l.replace(/--.*$/, '')).join('\n')

describe('migration 030', () => {
  it('states it is not applied by the build', () => {
    expect(sql).toMatch(/NOT APPLIED to any Neon branch by the build/)
  })
  it('creates tables and indexes idempotently', () => {
    const bad = code.match(/create\s+(?:unique\s+)?(?:table|index)\s+(?!if not exists)/gi)
    expect(bad).toBeNull()
    expect(code).toMatch(/create table if not exists import_log_rows/)
    expect(code).toMatch(/create table if not exists import_log_categories/)
  })
  it('adds every column idempotently', () => {
    const adds = code.match(/add column/gi) ?? []
    const safe = code.match(/add column if not exists/gi) ?? []
    expect(adds.length).toBeGreaterThan(0)
    expect(safe.length).toBe(adds.length)
  })
  it('guards the status constraint', () => {
    expect(code).toMatch(/if not exists \(select 1 from pg_constraint where conname = 'import_logs_status_check'\)/)
    expect(code).toMatch(/status is null or status in \('committed', 'undone'\)/)
  })
  it('is non-destructive', () => {
    expect(code).not.toMatch(/\bdrop\b/i)
    expect(code).not.toMatch(/\bdelete\s+from\b/i)
    expect(code).not.toMatch(/^\s*update\b/im)
  })
  it('gives status no default and leaves 028 columns alone', () => {
    expect(code).not.toMatch(/default\s+'committed'/i)
    expect(code).not.toMatch(/mapping_source|mapping_note/)
    expect(code).not.toMatch(/\btags\b/)
  })
})
