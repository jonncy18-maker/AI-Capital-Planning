import * as F from './fixtures.mjs'

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

export const unmocked = new Set()

// Resolve one /api request to a response body. Returns undefined when not modelled.
function resolve(method, url) {
  const u = new URL(url)
  const p = u.pathname.replace(/^\/api/, '')
  const q = u.searchParams
  const seg = p.split('/').filter(Boolean)

  if (method !== 'GET') {
    if (p === '/ai-chat') return { content: [{ type: 'text', text: 'Canned assistant answer for layout testing.' }] }
    return {}
  }
  if (p === '/auth/get-session') {
    return { session: { id: 's1', userId: F.USER_ID, token: 'x', expiresAt: new Date(Date.now() + 864e5).toISOString(), createdAt: F.TODAY.toISOString(), updatedAt: F.TODAY.toISOString() }, user: F.user }
  }
  switch (seg[0]) {
    case 'profile': return F.profile
    case 'budget-categories': return F.categories
    case 'budget-line-items':
      if (seg[1] === 'years') return Object.keys(F.budgetItemsByYear).map(Number)
      return q.get('year') ? (F.budgetItemsByYear[q.get('year')] ?? []) : Object.values(F.budgetItemsByYear).flat()
    case 'budget-status': return { status: 'draft', finalized_at: null }
    case 'transactions': {
      const t = F.transactions
      if (seg[1] === 'by-month' || seg[1] === undefined) {
        const from = q.get('from'), to = q.get('to')
        let r = t.filter(x => (!from || x.date >= from) && (!to || x.date <= to))
        if (seg[1] === 'by-month') r = r.map(({ date, amount, group, category, merchant, account }) => ({ date, amount, group, category, merchant, account })).reverse()
        return r.slice(0, Number(q.get('limit')) || 5000)
      }
      if (seg[1] === 'recent') return t.map(({ date, merchant, category, group, amount, account }) => ({ date, merchant, category, group, amount, account }))
      if (seg[1] === 'analysis') return t.map(({ date, amount, category, group }) => ({ date, amount, category, group })).reverse()
      if (seg[1] === 'year') return t.filter(x => x.date.startsWith(seg[2]) && Number(x.amount) < 0).map(({ date, amount, category, group }) => ({ date, amount, category, group })).reverse()
      if (seg[1] === 'by-category') { const cs = (q.get('categories') || '').split(','); return t.filter(x => cs.includes(x.category) && Number(x.amount) < 0).map(({ date, category, amount }) => ({ date, category, amount })) }
      return undefined
    }
    case 'income-actuals':
      if (seg[1] === 'transactions') return F.transactions.filter(x => Number(x.amount) > 0).map(({ date, amount, category }) => ({ date, amount, category }))
      return F.incomeActuals
    case 'commitments': return F.commitments.filter(c => !q.has('status') || !q.get('status') || c.status === q.get('status'))
    case 'credit-cards':
      if (!seg[1]) return F.cards
      if (seg[1] === 'earn-rates') return F.earnRates
      if (seg[1] === 'points') return F.pointsLatest
      if (seg[1] === 'redemptions') return F.redemptions
      if (seg[1] === 'settings') return { coveragePct: 80, optimizationPct: 100 }
      if (seg[1] === 'transaction-accounts') return F.txnAccounts
      return undefined
    case 'accounts': return F.accounts
    case 'bills': return F.bills
    case 'bill-amounts': {
      if (q.get('billId')) return F.billAmounts.filter(b => b.bill_id === q.get('billId'))
      if (q.get('startYear')) return F.billAmounts
      return F.billAmounts.filter(b => b.year === Number(q.get('year')) && b.month === Number(q.get('month')))
    }
    case 'account-balances': return F.accountBalances
    case 'forecast-line-items':
      if (q.get('hasForecast') === 'true') return { hasForecast: true }
      return Number(q.get('year')) === F.YEAR ? F.forecastItems : []
    case 'forecast-overrides': return Number(q.get('year')) === F.YEAR ? F.forecastOverrides : []
    case 'scenarios':
      if (!seg[1]) return F.scenarios
      if (seg[1] === 'outlook-adjustments') return q.get('committed') === '1' ? F.outlookAdj : F.outlookAdj
      if (seg[2] === 'adjustments') return F.adjustments[seg[1]] ?? []
      if (seg[2] === 'outlook-adjustments') return F.outlookAdj.filter(a => a.scenario_id === seg[1])
      return F.scenarios.find(s => s.id === seg[1]) ?? {}
    case 'outlook':
      if (seg[1] === 'assumptions') return { inflation_rate: 0.03, income_growth_rate: 0.03, group_rates: { Housing: 0.04, 'Food & Dining': 0.045 } }
      if (seg[1] === 'events') return F.outlookEvents
      return undefined
    case 'wealth-snapshots': return q.get('latest') === 'true' ? F.wealthSnapshots[0] : F.wealthSnapshots.slice(0, Number(q.get('limit')) || 24)
    case 'wealth-plans': return F.wealthPlans
    case 'tax-brackets': return F.taxBrackets
    case 'ai-preferences': return { preferences: {}, interview: null, grill_enabled: false }
    case 'ai-briefings': return null
    case 'import-logs': return [{ id: 'il1', user_id: F.USER_ID, filename: 'monarch-transactions-2026.csv', total_rows: 412, inserted: 400, skipped: 12, unmapped_count: 0, created_at: new Date().toISOString() }]
    case 'monarch-sync': return { connected: false }
    default: return undefined
  }
}

export async function installMocks(page) {
  await page.route('**/api/**', route => {
    const req = route.request()
    const method = req.method()
    const body = resolve(method, req.url())
    if (body === undefined) {
      unmocked.add(`${method} ${new URL(req.url()).pathname}${new URL(req.url()).search}`)
      return json(route, method === 'GET' ? [] : {})
    }
    return json(route, body)
  })
}
