import { evaluate } from '../../src/engine/rules/fullRule'
import { RuleContext } from '../../src/engine/types'
import { buildVehicle, buildChargeOrder } from '../fixtures/vehicles'
import { DEFAULT_CONFIG, freeChargers, occupiedCharger } from '../fixtures/scenarios'

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

describe('C-16: battery >= 98% AND state == CHARGING — park', () => {
  const vehicle = buildVehicle({
    name: 'Vehicle-0001', energyLevel: 98, state: 'CHARGING',
    processingState: 'PROCESSING_ORDER', transportOrder: 'CHARGE-V001-001',
  })
  const chargeOrder = buildChargeOrder('Vehicle-0001', 'ChargingStation-1', 'BEING_PROCESSED', { name: 'CHARGE-V001-001' })
  const ctx = makeContext({
    vehicles: [vehicle],
    orders: [chargeOrder],
    chargers: [occupiedCharger('ChargingStation-1', 'Vehicle-0001'), freeChargers[1]],
  })

  it('withdraws the charge order', async () => {
    const actions = await evaluate(vehicle, ctx)
    expect(actions.some(a => a.type === 'WITHDRAW_ORDER' && a.vehicle === 'Vehicle-0001')).toBe(true)
  })

  it('issues a park order to preferred parking point', async () => {
    const actions = await evaluate(vehicle, ctx)
    expect(actions.some(a => a.type === 'PARK_ORDER' && a.vehicle === 'Vehicle-0001')).toBe(true)
  })

  it('does NOT disable the vehicle', async () => {
    const actions = await evaluate(vehicle, ctx)
    expect(actions.some(a => a.type === 'DISABLE_ROBOT')).toBe(false)
  })
})

describe('C-17: battery >= 98% but NOT CHARGING — no action', () => {
  it('returns [] for Full robot that is IDLE (not at charger)', async () => {
    const vehicle = buildVehicle({ energyLevel: 98, state: 'IDLE', processingState: 'IDLE' })
    const ctx = makeContext({ vehicles: [vehicle] })
    const actions = await evaluate(vehicle, ctx)
    expect(actions).toHaveLength(0)
  })
})

describe('C-18: battery 100% while CHARGING — also parks', () => {
  const vehicle = buildVehicle({
    name: 'Vehicle-0001', energyLevel: 100, state: 'CHARGING',
    processingState: 'PROCESSING_ORDER', transportOrder: 'CHARGE-V001-001',
  })
  const chargeOrder = buildChargeOrder('Vehicle-0001', 'ChargingStation-1', 'BEING_PROCESSED', { name: 'CHARGE-V001-001' })
  const ctx = makeContext({ vehicles: [vehicle], orders: [chargeOrder] })

  it('emits WITHDRAW + PARK for 100% charged robot', async () => {
    const actions = await evaluate(vehicle, ctx)
    expect(actions.some(a => a.type === 'WITHDRAW_ORDER')).toBe(true)
    expect(actions.some(a => a.type === 'PARK_ORDER')).toBe(true)
  })
})

describe('fullRule: ignores non-Full battery levels', () => {
  it('returns [] for 85% robot charging (Sufficient)', async () => {
    const vehicle = buildVehicle({ energyLevel: 85, state: 'CHARGING' })
    const ctx = makeContext({ vehicles: [vehicle] })
    const actions = await evaluate(vehicle, ctx)
    expect(actions).toHaveLength(0)
  })
})
