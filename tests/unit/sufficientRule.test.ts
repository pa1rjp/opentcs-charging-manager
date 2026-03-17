import { evaluate } from '../../src/engine/rules/sufficientRule'
import { RuleContext } from '../../src/engine/types'
import { buildVehicle } from '../fixtures/vehicles'
import { DEFAULT_CONFIG, freeChargers } from '../fixtures/scenarios'

function makeContext(overrides: Partial<RuleContext> = {}): RuleContext {
  return {
    vehicles: [],
    orders: [],
    chargers: freeChargers,
    config: DEFAULT_CONFIG,
    cycleId: '1',
    ...overrides,
  }
}

describe('C-12: Sufficient robot charging, no Critical waiting — continue', () => {
  const vehicle = buildVehicle({ name: 'Vehicle-0001', energyLevel: 85, state: 'CHARGING', processingState: 'PROCESSING_ORDER' })
  const ctx = makeContext({ vehicles: [vehicle] })

  it('returns NO_ACTION (continue charging)', async () => {
    const actions = await evaluate(vehicle, ctx)
    expect(actions.some(a => a.type === 'NO_ACTION')).toBe(true)
  })

  it('does NOT withdraw the charge order', async () => {
    const actions = await evaluate(vehicle, ctx)
    expect(actions.some(a => a.type === 'WITHDRAW_ORDER')).toBe(false)
  })
})

describe('C-13: Sufficient robot charging, Critical robot waiting — yield awareness', () => {
  const sufficientVehicle = buildVehicle({ name: 'Vehicle-0001', energyLevel: 85, state: 'CHARGING', processingState: 'PROCESSING_ORDER' })
  const criticalWaiting = buildVehicle({
    name: 'Vehicle-0002', energyLevel: 25, state: 'IDLE',
    processingState: 'IDLE', integrationLevel: 'TO_BE_RESPECTED', transportOrder: null,
  })
  const ctx = makeContext({ vehicles: [sufficientVehicle, criticalWaiting] })

  it('returns NO_ACTION with yielding reason when Critical is waiting', async () => {
    const actions = await evaluate(sufficientVehicle, ctx)
    expect(actions.some(a => a.type === 'NO_ACTION')).toBe(true)
  })

  it('does NOT directly issue preemption actions (defers to criticalRule)', async () => {
    const actions = await evaluate(sufficientVehicle, ctx)
    expect(actions.some(a => a.type === 'WITHDRAW_ORDER')).toBe(false)
    expect(actions.some(a => a.type === 'PARK_ORDER')).toBe(false)
  })
})

describe('C-14: not CHARGING — sufficientRule returns []', () => {
  it('returns [] for IDLE sufficient robot', async () => {
    const vehicle = buildVehicle({ energyLevel: 85, state: 'IDLE' })
    const ctx = makeContext({ vehicles: [vehicle] })
    const actions = await evaluate(vehicle, ctx)
    expect(actions).toHaveLength(0)
  })
})

describe('C-15: not in Sufficient group — sufficientRule returns []', () => {
  it('returns [] for Good-level battery (65%) even if CHARGING', async () => {
    const vehicle = buildVehicle({ energyLevel: 65, state: 'CHARGING' })
    const ctx = makeContext({ vehicles: [vehicle] })
    const actions = await evaluate(vehicle, ctx)
    expect(actions).toHaveLength(0)
  })
})
