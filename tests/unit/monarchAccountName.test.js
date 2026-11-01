import { describe, it, expect } from 'vitest'
import { normalizeMonarchAccountName, MONARCH_NAME_MAX } from '../../src/lib/accounts/monarchAccountName.js'

describe('normalizeMonarchAccountName', () => {
  it('maps null, empty and whitespace to null', () => {
    for (const v of [null, undefined, '', '   ', '\t ']) {
      expect(normalizeMonarchAccountName(v)).toEqual({ ok: true, value: null })
    }
  })

  it('trims the value', () => {
    expect(normalizeMonarchAccountName('  Checking - 9377 (...9377) ')).toEqual({
      ok: true, value: 'Checking - 9377 (...9377)',
    })
  })

  it('accepts 120 characters and rejects 121', () => {
    expect(MONARCH_NAME_MAX).toBe(120)
    expect(normalizeMonarchAccountName('a'.repeat(120)).ok).toBe(true)
    expect(normalizeMonarchAccountName('a'.repeat(121)).ok).toBe(false)
  })

  it('rejects control characters', () => {
    expect(normalizeMonarchAccountName('bad\nname').ok).toBe(false)
    expect(normalizeMonarchAccountName('bad\u0000name').ok).toBe(false)
    expect(normalizeMonarchAccountName('bad\u007fname').ok).toBe(false)
  })

  it('rejects non-strings', () => {
    expect(normalizeMonarchAccountName(42)).toEqual({
      ok: false, error: 'monarch_account_name must be a string or null.',
    })
    expect(normalizeMonarchAccountName({}).ok).toBe(false)
  })
})
