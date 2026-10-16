// Scene list: id, route, optional async setup(page) to reach a UI state.
const click = async (page, text, opts = {}) => {
  const loc = page.getByText(text, { exact: opts.exact ?? true }).first()
  await loc.click({ timeout: 4000, force: true }).catch(e => console.log(`   (click "${text}" failed: ${e.message.split('\n')[0]})`))
  await page.waitForTimeout(opts.wait ?? 600)
}
const clickBtn = async (page, name, wait = 600) => {
  const loc = page.getByRole('button', { name }).first()
  await loc.click({ timeout: 4000, force: true }).catch(e => console.log(`   (button "${name}" failed: ${e.message.split('\n')[0]})`))
  await page.waitForTimeout(wait)
}

export const scenes = [
  { id: 'dashboard', path: '/dashboard' },
  { id: 'dashboard-configure', path: '/dashboard', setup: p => click(p, 'CONFIGURE', { exact: false }) },
  { id: 'budget', path: '/budget' },
  { id: 'budget-outlook', path: '/budget?view=outlook' },
  { id: 'forecast', path: '/forecast' },
  { id: 'forecast-budget-layer', path: '/forecast', setup: p => click(p, 'Budget', { exact: true }) },
  { id: 'forecast-scenario-layer', path: '/forecast', setup: async p => { const t = p.getByText(/modeled|scenario/i).first(); await t.click({ timeout: 3000, force: true }).catch(() => {}); await p.waitForTimeout(600) } },
  { id: 'payperiods-cashflow', path: '/payperiods' },
  { id: 'payperiods-trends', path: '/payperiods', setup: p => click(p, 'TRENDS') },
  { id: 'payperiods-schedule', path: '/payperiods', setup: p => click(p, 'SCHEDULE') },
  { id: 'payperiods-bills', path: '/payperiods', setup: p => click(p, 'BILLS') },
  { id: 'payperiods-accounts', path: '/payperiods', setup: p => click(p, 'ACCOUNTS') },
  { id: 'payperiods-ccschedule', path: '/payperiods', setup: p => click(p, 'CC SCHEDULE') },
  { id: 'creditcards-overview', path: '/creditcards' },
  { id: 'creditcards-points', path: '/creditcards', setup: p => click(p, 'POINTS FORECAST') },
  { id: 'creditcards-cards', path: '/creditcards', setup: p => click(p, 'CARDS SETUP') },
  { id: 'creditcards-billpay', path: '/creditcards', setup: p => click(p, 'BILL PAY') },
  { id: 'scenarios-committed', path: '/scenarios' },
  { id: 'scenarios-modeled', path: '/scenarios', setup: p => click(p, 'Modeled', { exact: false }) },
  { id: 'scenarios-ideas', path: '/scenarios', setup: p => click(p, 'Ideas', { exact: false }) },
  { id: 'scenarios-baseline', path: '/scenarios', setup: p => click(p, 'Baseline', { exact: false }) },
  { id: 'scenario-detail-modeled', path: '/scenarios', setup: async p => { await click(p, 'Modeled', { exact: false }); await click(p, 'Second child', { exact: false }) } },
  { id: 'scenario-detail-committed', path: '/scenarios', setup: p => click(p, 'Move to a smaller home', { exact: false }) },
  { id: 'scenarios-new-form', path: '/scenarios', setup: async p => { await clickBtn(p, /new|\+/i) } },
  { id: 'commitments', path: '/commitments' },
  { id: 'commitments-new', path: '/commitments', setup: async p => { await clickBtn(p, /add|new|\+/i) } },
  { id: 'wealth-annual', path: '/wealth' },
  { id: 'wealth-monthly', path: '/wealth', setup: p => click(p, 'Monthly check-in') },
  { id: 'settings-planning', path: '/settings' },
  { id: 'settings-income', path: '/settings', setup: p => click(p, 'Income & Goals') },
  { id: 'settings-data', path: '/settings', setup: p => click(p, 'Data') },
  { id: 'mapping', path: '/mapping' },
  { id: 'welcome', path: '/welcome' },
  // shell states
  { id: 'shell-drawer', path: '/dashboard', mobileOnly: true, setup: async p => { await p.getByText('☰').first().click({ timeout: 3000 }).catch(() => {}); await p.waitForTimeout(600) } },
  { id: 'shell-commandbar', path: '/dashboard', setup: async p => { await clickFab(p) } },
  { id: 'shell-commandbar-typed', path: '/forecast', setup: async p => { await clickFab(p); await p.locator('textarea, input[type=text]').last().fill('What would happen to my savings rate if I moved to a smaller home and also paid off the car loan early this year?').catch(()=>{}); await p.waitForTimeout(400) } },
  { id: 'shell-commandbar-budget', path: '/budget', setup: async p => { await clickFab(p) } },
]

async function clickFab(p) {
  const fab = p.locator('button[title="Open assistant"]').first()
  await fab.click({ timeout: 4000, force: true }).catch(e => console.log('   (fab failed: ' + e.message.split('\n')[0] + ')'))
  await p.waitForTimeout(800)
}

export const viewports = [
  { w: 360, h: 800 }, { w: 390, h: 844 }, { w: 760, h: 900 }, { w: 1100, h: 900 },
]
