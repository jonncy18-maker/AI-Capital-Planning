import { describe, it, expect } from 'vitest'
import { buildSpendMaps, resolveMonthlySpend } from '../../src/lib/creditcards/pointsEngine.js'

const oldBuild = (lineItems, forecastLines) => {
  const b = {}
  for (const li of (lineItems ?? [])) {
    if (!b[li.category_id]) b[li.category_id] = {}
    b[li.category_id][li.month] = (b[li.category_id][li.month] ?? 0) + Number(li.amount)
  }
  const f = {}
  for (const fi of (forecastLines ?? [])) {
    if (!f[fi.category_id]) f[fi.category_id] = {}
    f[fi.category_id][fi.month] = (f[fi.category_id][fi.month] ?? 0) + Number(fi.amount)
  }
  return { b, f }
}

describe('buildSpendMaps', () => {
  it('sums ten 0.1 amounts to exactly 1', () => {
    const items = Array.from({ length: 10 }, () => ({ category_id: 'c', month: 1, amount: 0.1 }))
    expect(buildSpendMaps(items, []).budgetByCategory.c[1]).toBe(1)
    expect(buildSpendMaps([], items).forecastByCategory.c[1]).toBe(1)
  })
  it('handles Neon numeric strings', () => {
    const items = [
      { category_id: 'c', month: 2, amount: '0.10' },
      { category_id: 'c', month: 2, amount: '0.20' },
      { category_id: 'c', month: 2, amount: '1234.50' },
    ]
    expect(buildSpendMaps(items, []).budgetByCategory.c[2]).toBe(1234.8)
  })
  it('treats null/undefined amounts as 0 and tolerates null inputs', () => {
    const items = [
      { category_id: 'c', month: 1, amount: null },
      { category_id: 'c', month: 1, amount: undefined },
      { category_id: 'c', month: 1, amount: 5 },
    ]
    expect(buildSpendMaps(items, null).budgetByCategory.c[1]).toBe(5)
    const empty = buildSpendMaps(undefined, undefined)
    expect(empty).toEqual({ budgetByCategory: {}, forecastByCategory: {}, forecastInitialized: false })
  })
  it('forecastInitialized follows forecast rows; resolveMonthlySpend returns dollars', () => {
    const maps = buildSpendMaps(
      [{ category_id: 'a', month: 1, amount: '10.10' }],
      [{ category_id: 'a', month: 1, amount: '20.20' }, { category_id: 'a', month: 1, amount: '0.05' }],
    )
    expect(maps.forecastInitialized).toBe(true)
    expect(resolveMonthlySpend('a', 1, maps)).toBe(20.25)
    expect(resolveMonthlySpend('a', 2, maps)).toBe(0)
  })
  it('matches the old float result within 1 cent on ordinary inputs', () => {
    let s = 7
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
    const items = Array.from({ length: 400 }, () => ({
      category_id: 'c' + Math.floor(rnd() * 5),
      month: 1 + Math.floor(rnd() * 12),
      amount: (Math.floor(rnd() * 200000) / 100) * (rnd() < 0.1 ? -1 : 1),
    }))
    const neu = buildSpendMaps(items, items)
    const old = oldBuild(items, items)
    for (const cat of Object.keys(old.b)) {
      for (const m of Object.keys(old.b[cat])) {
        expect(Math.abs(neu.budgetByCategory[cat][m] - old.b[cat][m])).toBeLessThan(0.01)
        expect(Math.abs(neu.forecastByCategory[cat][m] - old.f[cat][m])).toBeLessThan(0.01)
      }
    }
  })
})
