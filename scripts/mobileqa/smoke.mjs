import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
import { installMocks, unmocked } from './mock.mjs'
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
await installMocks(page)
page.on('console', m => { if (['error','warning'].includes(m.type())) console.log('CONSOLE', m.type(), m.text().slice(0,200)) })
page.on('pageerror', e => console.log('PAGEERROR', e.message.slice(0,300)))
await page.goto('http://localhost:3100/dashboard', { waitUntil: 'networkidle', timeout: 120000 })
await page.waitForTimeout(2500)
await page.screenshot({ path: 'shots/smoke.png' })
console.log([...unmocked])
await b.close()
