import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({
  outlook: {
    getOutlookAssumptions: vi.fn(async () => ({})), saveOutlookAssumptions: vi.fn(async () => ({})),
    getOutlookEvents: vi.fn(async () => []), createOutlookEvent: vi.fn(async () => ({ id: 'e' })),
    updateOutlookEvent: vi.fn(), deleteOutlookEvent: vi.fn(),
    getScenarioOutlookAdjustments: vi.fn(), getAllOutlookAdjustments: vi.fn(async () => []),
    getCommittedOutlookAdjustments: vi.fn(),
    addScenarioOutlookAdjustment: vi.fn(async () => ({ id: 'a' })), deleteScenarioOutlookAdjustment: vi.fn(),
  },
  scenarios: { getScenarios: vi.fn(async () => [{ id: 's1', name: 'Move abroad' }]) },
  plans: { getWealthPlans: vi.fn(), saveWealthPlan: vi.fn(async (p) => ({ ...p })) },
  briefings: { getLatestBriefing: vi.fn(), saveBriefing: vi.fn(async () => ({ id: 'b' })) },
  tx: {
    getTransactions: vi.fn(), getTransactionsByMonth: vi.fn(),
    reclassifyTransactions: vi.fn(async (_u, updates, { dryRun } = {}) => ({
      updated: dryRun ? 0 : updates.length, not_found: [],
      rows: updates.map(u => ({ id: u.id, date: '2026-10-03', merchant: 'M', amount: -1, category_before: 'A', category_after: u.category })),
    })),
    importMonarchCsv: vi.fn(async (_u, a) => ({
      committed: a.mode === 'commit',
      counts: { new: 1, duplicate: 0, reclassified: 0, ambiguous_rows: 0, inserted: 1, skipped_duplicate: 0 },
      auto_mappings: [],
    })),
  },
  importLog: {
    getImportHistory: vi.fn(async () => [
      { id: 'l1', filename: 'a.csv', created_at: '2026-10-30', inserted: 3, reclassified: 1, categories_auto_mapped: 0, status: 'committed', undoable: true, not_undoable_reason: null },
      { id: 'l2', filename: 'b.csv', created_at: '2026-01-01', inserted: 9, status: null, undoable: false, not_undoable_reason: 'pre_migration' },
    ]),
    previewImportUndo: vi.fn(async () => ({
      mode: 'preview', committed: false, counts: { delete: 1, restore: 0, skip: 0 }, expected: { delete: 1, restore: 0, skip: 0, remove_mappings: 0 },
    })),
    commitImportUndo: vi.fn(async () => ({
      mode: 'commit', committed: true, counts: { deleted: 1, restored: 0, skipped: 0, mappings_removed: 0 },
    })),
  },
  cats: { getBudgetCategories: vi.fn(async () => [{ category: 'Gifts', group: 'Shopping' }]), getExcludedCategoryNames: vi.fn(async () => new Set()) },
}))
vi.mock('../../src/lib/db/outlook.js', () => db.outlook)
vi.mock('../../src/lib/db/scenarios.js', async (orig) => ({ ...(await orig()), ...db.scenarios }))
vi.mock('../../src/lib/db/wealthPlans.js', () => db.plans)
vi.mock('../../src/lib/db/aiBriefings.js', () => db.briefings)
vi.mock('../../src/lib/db/transactions.js', async (orig) => ({ ...(await orig()), ...db.tx }))
vi.mock('../../src/lib/db/importLog.js', () => db.importLog)
vi.mock('../../src/lib/db/budgetCategories.js', async (orig) => ({ ...(await orig()), ...db.cats }))

const { ALL_TOOLS } = await import('../../src/lib/ai/tools/index.js')
const { MCP_ONLY_TOOLS, mcpTools, mcpToolSchemas, getMcpTool, runMcpTool } = await import('../../src/lib/ai/tools/mcp/index.js')

const PLAN = {
  name: 'Plan', start_date: '2026-01-01', start_balance: 1000, monthly_contribution: 100, annual_return: 0.05,
  horizon: 10, retirement_target: 100000, include_commitments: false,
}
const ID = '11111111-1111-4111-8111-111111111111'

// group -> [tool, input, write seam called by a real save, predicate for "real write"]
const CASES = {
  outlook: ['save_outlook_event', { year: 2028, group_name: 'Travel', name: 'Trip', amount: 100 }, () => db.outlook.createOutlookEvent],
  scenarioOutlook: ['add_scenario_outlook_adjustment', { scenario: 'Move abroad', year: 2028, group_name: 'Travel', delta_amount: -50 }, () => db.outlook.addScenarioOutlookAdjustment],
  wealthPlans: ['save_wealth_plan', PLAN, () => db.plans.saveWealthPlan],
  briefings: ['save_ai_briefing', { narrative: 'hello' }, () => db.briefings.saveBriefing],
  transactions: ['recategorize_transactions', { ids: [ID], category: 'Gifts' }, () => db.tx.reclassifyTransactions],
  import: ['import_monarch_transactions', { csv: 'h\nr' }, () => db.tx.importMonarchCsv],
  undoImport: ['undo_monarch_import', { import_id: ID, expected: { delete: 1, restore: 0, skip: 0, remove_mappings: 0 } }, () => db.importLog.commitImportUndo],
}
const realWrites = (fn) => fn.mock.calls.filter(c => !(c[2]?.dryRun) && c[1]?.mode !== 'preview' && c[0]?.mode !== 'preview')

beforeEach(() => vi.clearAllMocks())

describe('registry', () => {
  it('leaves the in-app registry at 48 tools', () => {
    expect(ALL_TOOLS).toHaveLength(48)
  })
  it('adds MCP-only tools on top, with unique names and none shared', () => {
    expect(mcpTools()).toHaveLength(48 + MCP_ONLY_TOOLS.length)
    expect(MCP_ONLY_TOOLS).toHaveLength(20)
    const names = mcpTools().map(t => t.name)
    expect(new Set(names).size).toBe(names.length)
    const inApp = new Set(ALL_TOOLS.map(t => t.name))
    expect(MCP_ONLY_TOOLS.some(t => inApp.has(t.name))).toBe(false)
    expect(mcpToolSchemas()).toHaveLength(names.length)
  })
  it('every MCP-only write tool has a preview and a mode enum', () => {
    for (const t of MCP_ONLY_TOOLS.filter(t => t.write)) {
      expect(t.preview, t.name).toBeTypeOf('function')
      expect(t.schema.input_schema.properties.mode.enum, t.name).toEqual(['preview', 'commit'])
    }
  })
  it('only the import tool opts out of the generic gate', () => {
    expect(MCP_ONLY_TOOLS.filter(t => t.write && !t.mcpGated).map(t => t.name)).toEqual(['import_monarch_transactions', 'undo_monarch_import'])
  })
  it('does not gate in-app tools', () => {
    expect(ALL_TOOLS.some(t => t.mcpGated)).toBe(false)
  })
})

describe.each(Object.entries(CASES))('%s group gate', (_group, [name, input, seam]) => {
  const tool = getMcpTool(name)

  it('saves nothing when mode is absent', async () => {
    const out = await runMcpTool(tool, 'u1', input, {})
    expect(realWrites(seam())).toHaveLength(0)
    if (!['import_monarch_transactions', 'undo_monarch_import'].includes(name)) expect(out.result).toMatchObject({ mode: 'preview', committed: false })
  })

  it('saves nothing when mode is preview', async () => {
    await runMcpTool(tool, 'u1', { ...input, mode: 'preview' }, {})
    expect(realWrites(seam())).toHaveLength(0)
  })

  it('writes when mode is commit', async () => {
    await runMcpTool(tool, 'u1', { ...input, mode: 'commit' }, {})
    expect(realWrites(seam()).length).toBeGreaterThan(0)
  })
})

describe('other gated writes preview without touching their seams', () => {
  it.each([
    ['save_outlook_assumptions', { inflation_rate: 0.04 }, () => db.outlook.saveOutlookAssumptions],
    ['delete_outlook_event', { id: 'e1' }, () => db.outlook.deleteOutlookEvent],
    ['delete_scenario_outlook_adjustment', { id: 'a1' }, () => db.outlook.deleteScenarioOutlookAdjustment],
  ])('%s', async (name, input, seam) => {
    await runMcpTool(getMcpTool(name), 'u1', input, {})
    expect(seam()).not.toHaveBeenCalled()
    await runMcpTool(getMcpTool(name), 'u1', { ...input, mode: 'commit' }, {})
    expect(seam()).toHaveBeenCalled()
  })
})

describe('wealth plan preview', () => {
  it('reports validation errors in the subtitle instead of throwing', async () => {
    const out = await runMcpTool(getMcpTool('save_wealth_plan'), 'u1', { ...PLAN, horizon: 1 }, {})
    expect(out.result.preview.subtitle).toMatch(/Horizon/)
    expect(db.plans.saveWealthPlan).not.toHaveBeenCalled()
  })
})

describe('recategorize', () => {
  it('resolves the group from budget categories and strips nothing else', async () => {
    await runMcpTool(getMcpTool('recategorize_transactions'), 'u1', { ids: [ID], category: 'Gifts', mode: 'commit' }, {})
    expect(db.tx.reclassifyTransactions.mock.calls[0][1]).toEqual([{ id: ID, category: 'Gifts', group: 'Shopping' }])
  })
})

describe('monarch import undo tools', () => {
  it('undo previews by default and only commits through commitImportUndo', async () => {
    const tool = getMcpTool('undo_monarch_import')
    const out = await runMcpTool(tool, 'u1', { import_id: ID }, {})
    expect(db.importLog.previewImportUndo).toHaveBeenCalledTimes(1)
    expect(db.importLog.commitImportUndo).not.toHaveBeenCalled()
    expect(out.result.committed).toBe(false)

    const expected = { delete: 1, restore: 0, skip: 0, remove_mappings: 0 }
    await runMcpTool(tool, 'u1', { import_id: ID, mode: 'commit', expected, remove_auto_mappings: true }, {})
    expect(db.importLog.commitImportUndo).toHaveBeenCalledWith('u1', ID, { expected, removeAutoMappings: true })
  })

  it('list_monarch_imports is a read tool that returns compact rows', async () => {
    const tool = getMcpTool('list_monarch_imports')
    expect(tool.write).toBe(false)
    const out = await runMcpTool(tool, 'u1', { limit: 1 }, {})
    expect(out.result.imports).toHaveLength(1)
    expect(out.result.imports[0]).toMatchObject({ id: 'l1', undoable: true, reclassified: 1 })
    const all = await runMcpTool(tool, 'u1', {}, {})
    expect(all.result.imports[1]).toMatchObject({ undoable: false, not_undoable_reason: 'pre_migration', reclassified: null })
    expect(all.summary).toMatch(/1 can be undone/)
  })
})
