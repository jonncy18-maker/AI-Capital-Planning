import { describe, it, expect } from 'vitest'
import { analyzeTransactions, generateBudgetDraft, MONTHS } from '../../src/lib/budget/patternAnalyzer.js'

const t = (date, category, amount) => ({ date, category, amount })
const find = (analysis, name) => analysis.categories.find(c => c.category === name)

describe('analyzeTransactions', () => {
  it('handles no transactions', () => {
    // spanMonths floors at 1 so later divisions never hit 0
    expect(analyzeTransactions([])).toEqual({ spanMonths: 1, categories: [] })
  })

  describe('single month', () => {
    const txns = [
      t('2026-03-04', 'Groceries', -100),
      t('2026-03-18', 'Groceries', -50),
      t('2026-03-20', 'Salary', 5000), // income ignored
      t('2026-03-21', 'Refund', 0), // zero ignored
    ]
    const a = analyzeTransactions(txns)

    it('only reports outflow categories', () => {
      expect(a.categories.map(c => c.category)).toEqual(['Groceries'])
    })

    it('counts the span from every transaction, income included', () => {
      expect(a.spanMonths).toBe(1)
    })

    it('computes stats by hand: total 150, annual 150/1*12 = 1800, monthly 150', () => {
      const g = find(a, 'Groceries')
      expect(g.total).toBe(150)
      expect(g.activeMonths).toBe(1)
      expect(g.frequency).toBe(1)
      expect(g.avgWhenActive).toBe(150)
      expect(g.cov).toBe(0)
      expect(g.annualTotal).toBe(1800)
      expect(g.monthlyAvg).toBe(150)
      expect(g.type).toBe('Fixed')
    })

    it('puts the spend in the right histogram bucket (March = index 2)', () => {
      const h = find(a, 'Groceries').monthHistogram
      expect(h).toHaveLength(12)
      expect(h[2]).toBe(150)
      expect(h.reduce((x, y) => x + y, 0)).toBe(150)
    })
  })

  describe('multi-month classification (Jan-Jun 2026 span = 6)', () => {
    const txns = [
      // Rent: 1000 every month -> Fixed
      ...[1, 2, 3, 4, 5, 6].map(m => t(`2026-0${m}-01`, 'Rent', -1000)),
      // Groceries: 100,300,100,300 in Jan-Apr. mean 200, sd 100, cov 0.5, freq 4/6 -> Flexible
      t('2026-01-10', 'Groceries', -100),
      t('2026-02-10', 'Groceries', -300),
      t('2026-03-10', 'Groceries', -100),
      t('2026-04-10', 'Groceries', -300),
      // Insurance: one 600 hit in June, freq 1/6 -> Non-Monthly
      t('2026-06-15', 'Insurance', -600),
    ]
    const a = analyzeTransactions(txns)

    it('spans six distinct months', () => {
      expect(a.spanMonths).toBe(6)
    })

    it('classifies Rent as Fixed with annual 12000', () => {
      const r = find(a, 'Rent')
      expect(r.type).toBe('Fixed')
      expect(r.total).toBe(6000)
      expect(r.annualTotal).toBe(12000)
      expect(r.monthlyAvg).toBe(1000)
      expect(r.cov).toBe(0)
    })

    it('classifies Groceries as Flexible: total 800, annual 800/6*12 = 1600', () => {
      const g = find(a, 'Groceries')
      expect(g.type).toBe('Flexible')
      expect(g.frequency).toBeCloseTo(4 / 6)
      expect(g.avgWhenActive).toBe(200)
      expect(g.cov).toBeCloseTo(0.5)
      expect(g.annualTotal).toBeCloseTo(1600)
      expect(g.monthlyAvg).toBeCloseTo(1600 / 12)
    })

    it('classifies Insurance as Non-Monthly: annual 600/6*12 = 1200', () => {
      const i = find(a, 'Insurance')
      expect(i.type).toBe('Non-Monthly')
      expect(i.annualTotal).toBeCloseTo(1200)
      expect(i.monthHistogram[5]).toBe(600)
    })

    it('sorts by annual total, biggest first', () => {
      expect(a.categories.map(c => c.category)).toEqual(['Rent', 'Groceries', 'Insurance'])
    })
  })

  describe('classification thresholds', () => {
    it('frequency exactly 0.6 with zero variance is still Fixed (3 of 5 months)', () => {
      const txns = [
        ...[1, 2, 3, 4, 5].map(m => t(`2026-0${m}-01`, 'Rent', -1000)),
        t('2026-01-05', 'Gym', -40), t('2026-03-05', 'Gym', -40), t('2026-05-05', 'Gym', -40),
      ]
      const gym = find(analyzeTransactions(txns), 'Gym')
      expect(gym.frequency).toBeCloseTo(0.6)
      expect(gym.type).toBe('Fixed')
    })

    it('frequency exactly 0.5 is Flexible even with zero variance (3 of 6)', () => {
      const txns = [
        ...[1, 2, 3, 4, 5, 6].map(m => t(`2026-0${m}-01`, 'Rent', -1000)),
        t('2026-01-05', 'Gym', -40), t('2026-03-05', 'Gym', -40), t('2026-05-05', 'Gym', -40),
      ]
      expect(find(analyzeTransactions(txns), 'Gym').type).toBe('Flexible')
    })

    it('high variance at full frequency is Flexible, not Fixed', () => {
      const txns = [t('2026-01-05', 'Power', -50), t('2026-02-05', 'Power', -150)]
      // mean 100, sd 50, cov 0.5
      const p = find(analyzeTransactions(txns), 'Power')
      expect(p.cov).toBeCloseTo(0.5)
      expect(p.type).toBe('Flexible')
    })

    it('cov about 0.15 at full frequency is Fixed', () => {
      // 85 and 115: mean 100, population sd = sqrt((15^2 + 15^2) / 2) = 15, cov = 0.15 < 0.2
      const txns = [t('2026-01-05', 'Power', -85), t('2026-02-05', 'Power', -115)]
      const p = find(analyzeTransactions(txns), 'Power')
      expect(p.cov).toBeCloseTo(0.15)
      expect(p.type).toBe('Fixed')
    })

    it('cov about 0.25 at full frequency is Flexible', () => {
      // 75 and 125: mean 100, sd = 25, cov = 0.25 >= 0.2
      const txns = [t('2026-01-05', 'Power', -75), t('2026-02-05', 'Power', -125)]
      const p = find(analyzeTransactions(txns), 'Power')
      expect(p.cov).toBeCloseTo(0.25)
      expect(p.type).toBe('Flexible')
    })

    it('frequency just below 0.5 is Non-Monthly (2 of 5 months = 0.4)', () => {
      const txns = [
        ...[1, 2, 3, 4, 5].map(m => t(`2026-0${m}-01`, 'Rent', -1000)),
        t('2026-01-05', 'Gym', -40), t('2026-03-05', 'Gym', -40),
      ]
      const gym = find(analyzeTransactions(txns), 'Gym')
      expect(gym.frequency).toBeCloseTo(0.4)
      expect(gym.type).toBe('Non-Monthly')
    })

    it('sums several transactions in one month before measuring variance', () => {
      const txns = [
        t('2026-01-05', 'Fuel', -30), t('2026-01-20', 'Fuel', -70),
        t('2026-02-10', 'Fuel', -100),
      ]
      // Jan 100 + Feb 100 -> cov 0
      const f = find(analyzeTransactions(txns), 'Fuel')
      expect(f.total).toBe(200)
      expect(f.cov).toBe(0)
      expect(f.type).toBe('Fixed')
    })
  })

  describe('input hygiene', () => {
    it('buckets a null category under Uncategorized', () => {
      const a = analyzeTransactions([t('2026-01-05', null, -20)])
      expect(a.categories[0].category).toBe('Uncategorized')
    })

    it('skips transactions with an unparseable date everywhere', () => {
      const a = analyzeTransactions([t('not-a-date', 'Rent', -1000), t('2026-01-05', 'Food', -10)])
      expect(a.spanMonths).toBe(1)
      expect(a.categories.map(c => c.category)).toEqual(['Food'])
    })

    it('reads string amounts', () => {
      const a = analyzeTransactions([t('2026-01-05', 'Food', '-25.50')])
      expect(find(a, 'Food').total).toBeCloseTo(25.5)
    })

    it('counts income-only months toward the span', () => {
      // BUG?: a month with only income still widens spanMonths, which dilutes
      // every category's frequency and annualized total.
      const a = analyzeTransactions([t('2026-01-05', 'Food', -120), t('2026-02-05', 'Salary', 3000)])
      expect(a.spanMonths).toBe(2)
      expect(find(a, 'Food').annualTotal).toBe(720) // 120 / 2 * 12
    })
  })

  describe('category join and exclusions', () => {
    const categories = [
      { id: 'c1', category: 'Rent', group: 'Housing', type: 'Non-Monthly' },
      { id: 'c2', category: 'Groceries', group: 'Food' },
      { id: 'c3', category: 'Transfer', group: 'Transfers', exclude_from_totals: true },
    ]
    const txns = [
      t('2026-01-01', 'Rent', -1000), t('2026-02-01', 'Rent', -1000),
      t('2026-01-10', 'Groceries', -200),
      t('2026-01-15', 'Transfer', -5000), // excluded
      t('2026-01-16', 'Mystery', -10), // no budget_categories row
    ]
    const a = analyzeTransactions(txns, categories)

    it('drops categories flagged exclude_from_totals', () => {
      expect(find(a, 'Transfer')).toBeUndefined()
    })

    it('attaches id and group from the matching row', () => {
      expect(find(a, 'Groceries').category_id).toBe('c2')
      expect(find(a, 'Groceries').group).toBe('Food')
    })

    it('ignores the configured type: the inferred one wins', () => {
      // BUG?: the code comment says a user-configured type is honored, but
      // `...stats` is spread after `type: matched?.type ?? stats.type` and
      // stats.type overwrites it. Rent is configured Non-Monthly yet reports Fixed.
      const r = find(a, 'Rent')
      expect(r.type).toBe('Fixed')
      expect(r.inferredType).toBe('Fixed')
    })

    it('leaves unmatched categories with null id and group', () => {
      const m = find(a, 'Mystery')
      expect(m.category_id).toBeNull()
      expect(m.group).toBeNull()
    })

    it('still counts an excluded category toward the span', () => {
      const b = analyzeTransactions([t('2026-01-05', 'Food', -10), t('2026-03-05', 'Transfer', -500)], categories)
      expect(b.spanMonths).toBe(2)
    })
  })
})

describe('generateBudgetDraft', () => {
  it('returns [] for an empty analysis', () => {
    expect(generateBudgetDraft({ categories: [] }, 2027)).toEqual([])
    expect(generateBudgetDraft(analyzeTransactions([]), 2027)).toEqual([])
  })

  it('spreads a Fixed category evenly over 12 months at the rounded monthly average', () => {
    const analysis = analyzeTransactions(
      [1, 2, 3, 4, 5, 6].map(m => t(`2026-0${m}-01`, 'Rent', -1000)),
      [{ id: 'c1', category: 'Rent', group: 'Housing' }],
    )
    const items = generateBudgetDraft(analysis, 2027)
    expect(items).toHaveLength(12)
    expect(items.map(i => i.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(items.every(i => i.amount === 1000 && i.year === 2027 && i.label === null)).toBe(true)
    expect(items[0]).toMatchObject({ category_id: 'c1', category: 'Rent', group: 'Housing', type: 'Fixed' })
  })

  it('works from a single month of history (150 spent -> 150 x 12)', () => {
    const analysis = analyzeTransactions(
      [t('2026-03-04', 'Groceries', -100), t('2026-03-18', 'Groceries', -50)],
      [{ id: 'g', category: 'Groceries', group: 'Food' }],
    )
    const items = generateBudgetDraft(analysis, 2027)
    expect(items).toHaveLength(12)
    expect(items.every(i => i.amount === 150)).toBe(true)
  })

  it('rounds a Flexible monthly average: 1600/12 = 133.33 -> 133', () => {
    const analysis = analyzeTransactions(
      [
        ...[1, 2, 3, 4, 5, 6].map(m => t(`2026-0${m}-01`, 'Rent', -1000)),
        t('2026-01-10', 'Groceries', -100), t('2026-02-10', 'Groceries', -300),
        t('2026-03-10', 'Groceries', -100), t('2026-04-10', 'Groceries', -300),
      ],
      [{ id: 'g', category: 'Groceries', group: 'Food' }],
    )
    const items = generateBudgetDraft(analysis, 2027)
    expect(items).toHaveLength(12)
    expect(items.every(i => i.amount === 133)).toBe(true)
  })

  it('places a Non-Monthly category only in its historical months', () => {
    const analysis = analyzeTransactions(
      [
        ...[1, 2, 3, 4, 5, 6].map(m => t(`2026-0${m}-01`, 'Rent', -1000)),
        t('2026-06-15', 'Insurance', -600),
      ],
      [{ id: 'i', category: 'Insurance', group: 'Bills' }],
    )
    const items = generateBudgetDraft(analysis, 2027)
    // annual = 600/6*12 = 1200, all of it in June
    expect(items).toEqual([{
      category_id: 'i', category: 'Insurance', group: 'Bills', type: 'Non-Monthly',
      month: 6, year: 2027, amount: 1200, label: `Insurance — ${MONTHS[5]}`,
    }])
  })

  it('splits a Non-Monthly annual total by histogram share', () => {
    const hist = Array(12).fill(0)
    hist[2] = 300 // Mar
    hist[8] = 100 // Sep
    const analysis = {
      categories: [{ category_id: 'x', category: 'Tax', group: 'G', type: 'Non-Monthly', annualTotal: 1000, monthHistogram: hist }],
    }
    const items = generateBudgetDraft(analysis, 2027)
    // shares 0.75 / 0.25 of 1000
    expect(items.map(i => [i.month, i.amount])).toEqual([[3, 750], [9, 250]])
  })

  it('rounds each Non-Monthly month independently: 100 over three equal months -> 33 each', () => {
    const hist = Array(12).fill(0)
    hist[0] = hist[1] = hist[2] = 1
    const items = generateBudgetDraft({
      categories: [{ category_id: 'x', category: 'T', group: null, type: 'Non-Monthly', annualTotal: 100, monthHistogram: hist }],
    }, 2027)
    expect(items.map(i => i.amount)).toEqual([33, 33, 33])
  })

  it('emits nothing for Non-Monthly with an empty histogram', () => {
    const items = generateBudgetDraft({
      categories: [{ category_id: 'x', category: 'T', type: 'Non-Monthly', annualTotal: 500, monthHistogram: Array(12).fill(0) }],
    }, 2027)
    expect(items).toEqual([])
  })

  it('skips categories without a category_id, under $1/yr, or rounding to $0/mo', () => {
    const base = { group: null, type: 'Fixed', monthHistogram: Array(12).fill(0) }
    const items = generateBudgetDraft({
      categories: [
        { ...base, category_id: null, category: 'NoId', annualTotal: 1200, monthlyAvg: 100 },
        { ...base, category_id: 'a', category: 'Tiny', annualTotal: 0.5, monthlyAvg: 0.04 },
        { ...base, category_id: 'b', category: 'RoundsToZero', annualTotal: 5, monthlyAvg: 5 / 12 }, // 0.4167 -> 0
        { ...base, category_id: 'c', category: 'RoundsToOne', annualTotal: 6, monthlyAvg: 0.5 }, // Math.round(0.5) = 1
      ],
    }, 2027)
    expect(new Set(items.map(i => i.category))).toEqual(new Set(['RoundsToOne']))
    expect(items).toHaveLength(12)
    expect(items.every(i => i.amount === 1)).toBe(true)
  })

  it('does not draft lines for excluded categories end to end', () => {
    const categories = [
      { id: 'r', category: 'Rent', group: 'Housing' },
      { id: 'x', category: 'Transfer', group: 'T', exclude_from_totals: true },
    ]
    const analysis = analyzeTransactions(
      [t('2026-01-01', 'Rent', -900), t('2026-01-02', 'Transfer', -4000)],
      categories,
    )
    const items = generateBudgetDraft(analysis, 2027)
    expect(new Set(items.map(i => i.category))).toEqual(new Set(['Rent']))
    expect(items.every(i => i.amount === 900)).toBe(true)
  })
})
