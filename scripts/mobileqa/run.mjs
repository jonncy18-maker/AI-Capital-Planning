// Mobile QA harness: drives the app in headless Chromium with auth and /api faked by mock.mjs
// (synthetic data in fixtures.mjs), screenshots every scene in scenes.mjs and measures overflow,
// tap targets and text size (measure.mjs). Outputs go to ./shots and ./results (gitignored).
// Run:  scripts/mobileqa/start-dev.sh &   (wait for "Ready")   then   node scripts/mobileqa/run.mjs
//       python3 scripts/mobileqa/aggregate.py   (run from this folder) summarises results/.
// Needs the `playwright` package (or PLAYWRIGHT_MODULE=<path to playwright/index.mjs>) and
// CHROMIUM_PATH=<chrome binary> when Playwright cannot find its own browser.
// Measure <main>.scrollWidth, not the document: the app scrolls inside <main>.
// Usage: node run.mjs [--themes dark,light] [--vw 360,390,760,1100] [--scenes id1,id2] [--base http://localhost:3100]
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installMocks, unmocked } from './mock.mjs'
import { measureInPage } from './measure.mjs'
import { scenes, viewports } from './scenes.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : d }
const themes = arg('themes', 'dark,light').split(',')
const vwFilter = arg('vw', '').split(',').filter(Boolean).map(Number)
const sceneFilter = arg('scenes', '').split(',').filter(Boolean)
const base = arg('base', 'http://localhost:3100')
const vps = vwFilter.length ? vwFilter.map(w => viewports.find(v => v.w === w) ?? { w, h: 900 }) : viewports
fs.mkdirSync(path.join(here, 'shots'), { recursive: true })
fs.mkdirSync(path.join(here, 'results'), { recursive: true })

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const summary = []
for (const theme of themes) {
  for (const vp of vps) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, hasTouch: vp.w <= 760, isMobile: false })
    await ctx.addInitScript(t => { try { localStorage.setItem('acp-theme', t) } catch {} }, theme)
    for (const sc of scenes) {
      if (sceneFilter.length && !sceneFilter.includes(sc.id)) continue
      if (sc.mobileOnly && vp.w >= 760) continue
      const name = `${sc.id}__${vp.w}__${theme}`
      const page = await ctx.newPage()
      const errors = []
      page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 200)))
      page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|fonts\.g/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)) })
      await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort())
      await installMocks(page)
      try {
        await page.goto(base + sc.path, { waitUntil: 'networkidle', timeout: 120000 })
        await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' })
        await page.waitForTimeout(1800)
        if (sc.setup) await sc.setup(page)
        await page.waitForTimeout(500)
        const report = await page.evaluate(measureInPage)
        // grow the viewport so the inner scroller (<main>) shows all content, then screenshot
        const need = await page.evaluate(() => { const m = document.querySelector('main'); return m ? m.scrollHeight - m.clientHeight : 0 })
        const h = sc.id.startsWith('shell-commandbar') ? vp.h : Math.min(vp.h + Math.max(0, need), 12000)
        await page.setViewportSize({ width: vp.w, height: h })
        await page.waitForTimeout(400)
        await page.screenshot({ path: path.join(here, 'shots', name + '.png') })
        report.errors = errors
        report.scene = sc.id; report.theme = theme; report.viewport = vp.w
        report.contentHeight = vp.h + need
        fs.writeFileSync(path.join(here, 'results', name + '.json'), JSON.stringify(report, null, 1))
        summary.push({ name, docH: report.docHScroll, mainH: report.main?.hScroll, over: report.main?.overshootPx ?? 0, origins: report.overflowOrigins.length, tiny: report.smallTapTargetTotal, errs: errors.length, h: report.contentHeight })
        console.log(name.padEnd(44), 'doc', report.docHScroll ? 'H!' : '- ', 'main', report.main?.hScroll ? `H+${report.main.overshootPx}` : '-', 'origins', report.overflowOrigins.length, 'tiny', report.smallTapTargetTotal, 'errs', errors.length)
      } catch (e) {
        console.log(name, 'FAILED', e.message.split('\n')[0])
        summary.push({ name, failed: e.message.split('\n')[0] })
      }
      await page.close()
    }
    await ctx.close()
  }
}
fs.writeFileSync(path.join(here, 'results', '_summary.json'), JSON.stringify(summary, null, 1))
fs.writeFileSync(path.join(here, 'results', '_unmocked.json'), JSON.stringify([...unmocked], null, 1))
console.log('UNMOCKED:', [...unmocked])
await browser.close()
