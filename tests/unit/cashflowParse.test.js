import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { transformWithOxc } from 'vite'

// Smoke test: a syntax error in these files must fail `npm test`.
describe('cash flow sources parse', () => {
  for (const f of ['src/modules/cashflow/CashFlow.jsx', 'src/lib/db/transactions.js', 'src/lib/money.js']) {
    it(`${f} parses`, async () => {
      const code = readFileSync(f, 'utf8')
      const out = await transformWithOxc(code, f, { lang: f.endsWith('.jsx') ? 'jsx' : 'js' })
      expect(out.code.length).toBeGreaterThan(0)
    })
  }
})
