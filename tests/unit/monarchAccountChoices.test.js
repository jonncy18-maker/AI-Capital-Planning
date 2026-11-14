import { describe, it, expect } from 'vitest'
import { buildMonarchAccountChoices } from '../../src/lib/payperiods/checkingHistory.js'

const rows = names => names.map(account => ({ account }))

describe('buildMonarchAccountChoices', () => {
  it('dedupes, counts and trims names', () => {
    const out = buildMonarchAccountChoices(rows(['Visa', ' Visa ', 'Visa', 'Amex']), null)
    expect(out).toEqual([{ name: 'Amex', count: 1 }, { name: 'Visa', count: 3 }])
  })

  it('lists names containing "check" first, each group alphabetical (case-insensitive)', () => {
    const out = buildMonarchAccountChoices(
      rows(['zeta', 'Savings', 'Joint CHECKING', 'apple card', 'Checking - 9377']),
      null,
    )
    expect(out.map(o => o.name)).toEqual(['Checking - 9377', 'Joint CHECKING', 'apple card', 'Savings', 'zeta'])
  })

  it('ignores blank names and handles null/undefined/empty input', () => {
    expect(buildMonarchAccountChoices(null, null)).toEqual([])
    expect(buildMonarchAccountChoices(undefined, undefined)).toEqual([])
    expect(buildMonarchAccountChoices([], '')).toEqual([])
    expect(buildMonarchAccountChoices([{ account: '  ' }, { account: null }, {}, null], null)).toEqual([])
  })

  it('puts a saved name missing from the data at the top', () => {
    const out = buildMonarchAccountChoices(rows(['Checking A', 'Other']), '  Old Checking ')
    expect(out[0]).toEqual({ name: 'Old Checking', count: 0, saved: true })
    expect(out).toHaveLength(3)
  })

  it('does not duplicate a saved name already in the data', () => {
    const out = buildMonarchAccountChoices(rows(['Checking A', 'Checking A']), 'Checking A')
    expect(out).toEqual([{ name: 'Checking A', count: 2 }])
  })

  it('adds nothing for a blank saved name', () => {
    expect(buildMonarchAccountChoices(rows(['A']), '   ')).toEqual([{ name: 'A', count: 1 }])
    expect(buildMonarchAccountChoices(rows(['A']), null)).toEqual([{ name: 'A', count: 1 }])
  })
})
