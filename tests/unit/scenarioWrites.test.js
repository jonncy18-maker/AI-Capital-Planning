import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({
  createScenario: vi.fn(),
  addAdjustment: vi.fn(),
  deleteScenario: vi.fn(),
  getBudgetCategories: vi.fn(),
  upsertCategory: vi.fn(),
}))

vi.mock('../../src/lib/db/scenarios.js', () => ({
  createScenario: db.createScenario,
  addAdjustment: db.addAdjustment,
  deleteScenario: db.deleteScenario,
}))
vi.mock('../../src/lib/db/budgetCategories.js', () => ({
  getBudgetCategories: db.getBudgetCategories,
  upsertCategory: db.upsertCategory,
}))

import { executeCreateScenario } from '../../src/lib/ai/tools/scenarioWrites.js'

const input = {
  name: 'Lease',
  adjustments: [
    { category: 'Auto', year: 2026, month: 1, delta_amount: 100 },
    { category: 'Auto', year: 2026, month: 2, delta_amount: 100 },
  ],
}

beforeEach(() => {
  Object.values(db).forEach(f => f.mockReset())
  db.getBudgetCategories.mockResolvedValue([{ id: 'c1', category: 'Auto', group: 'Transport' }])
  db.createScenario.mockResolvedValue({ id: 's1', name: 'Lease' })
  db.addAdjustment.mockResolvedValue({})
  db.deleteScenario.mockResolvedValue(undefined)
})

describe('executeCreateScenario', () => {
  it('writes every adjustment and keeps the scenario', async () => {
    const out = await executeCreateScenario('u1', input)
    expect(out).toMatchObject({ scenarioId: 's1', adjustmentCount: 2, netDelta: -200 })
    expect(db.deleteScenario).not.toHaveBeenCalled()
  })

  it('deletes the new scenario and rethrows when a later adjustment fails', async () => {
    db.addAdjustment.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('boom'))
    await expect(executeCreateScenario('u1', input)).rejects.toThrow('boom')
    expect(db.deleteScenario).toHaveBeenCalledWith('u1', 's1')
  })

  it('still rethrows the original error when the cleanup also fails', async () => {
    db.addAdjustment.mockRejectedValue(new Error('boom'))
    db.deleteScenario.mockRejectedValue(new Error('cleanup failed'))
    await expect(executeCreateScenario('u1', input)).rejects.toThrow('boom')
  })

  it('writes nothing when no adjustment is given', async () => {
    await expect(executeCreateScenario('u1', { name: 'x', adjustments: [] })).rejects.toThrow('No adjustments')
    expect(db.createScenario).not.toHaveBeenCalled()
  })
})
