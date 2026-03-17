import { evaluate } from '../../src/engine/rules/goodRule'
import { RuleContext } from '../../src/engine/types'
import { buildVehicle, buildChargeOrder, buildFMSTask } from '../fixtures/vehicles'
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

describe('C-07: opportunistic charge — no FMS tasks, charger free, lowest battery in group', () => {
  const vehicle = buildVehicle({ name: 'Vehicle-0001', energyLevel: 55, state: 'IDLE', processingState: 'IDLE' })
  const ctx = makeContext({ vehicles: [vehicle] })

  it('issues a charge order to the lowest-battery Good robot', async () => {
    const actions = await evaluate(vehicle, ctx)
    expect(actions.some(a => a.type === 'CHARGE_ORDER' && a.vehicle === 'Vehicle-0001')).toBe(true)
  })

  it('returns [] for non-Good battery level', async () => {
    const nonGood = buildVehicle({ energyLevel: 28 })
    const actions = await evaluate(nonGood, ctx)
    expect(actions).toHaveLength(0)
  })
})

describe('C-08: opportunistic charge — not the lowest battery in Good group', () => {
  const vehicle1 = buildVehicle({ name: 'Vehicle-0001', energyLevel: 70, state: 'IDLE', processingState: 'IDLE' })
  const vehicle2 = buildVehicle({ name: 'Vehicle-0002', energyLevel: 55, state: 'IDLE', processingState: 'IDLE' })
  const ctx = makeContext({ vehicles: [vehicle1, vehicle2] })

  it('does NOT issue charge order to higher-battery Good robot', async () => {
    const actions = await evaluate(vehicle1, ctx)
    expect(actions.some(a => a.type === 'CHARGE_ORDER' && a.vehicle === 'Vehicle-0001')).toBe(false)
  })

  it('issues charge order to lower-battery Good robot', async () => {
    const actions = await evaluate(vehicle2, ctx)
    expect(actions.some(a => a.type === 'CHARGE_ORDER' && a.vehicle === 'Vehicle-0002')).toBe(true)
  })
})

describe('C-09: currently charging, task arrives — withdraw charge', () => {
  const vehicle = buildVehicle({
    name: 'Vehicle-0001', energyLevel: 65, state: 'CHARGING',
    processingState: 'PROCESSING_ORDER', transportOrder: 'CHARGE-V001-001',
  })
  const chargeOrder = buildChargeOrder('Vehicle-0001', 'ChargingStation-1', 'BEING_PROCESSED', { name: 'CHARGE-V001-001' })
  const fmsTask = buildFMSTask('Vehicle-0002', 'FMS-PENDING-001', { processingVehicle: null, state: 'ACTIVE' })
  const ctx = makeContext({
    vehicles: [vehicle],
    orders: [chargeOrder, fmsTask],
    chargers: [occupiedCharger('ChargingStation-1', 'Vehicle-0001'), freeChargers[1]],
  })

  it('withdraws the charge order when FMS task arrives', async () => {
    const actions = await evaluate(vehicle, ctx)
    expect(actions.some(a => a.type === 'WITHDRAW_ORDER' && a.vehicle === 'Vehicle-0001')).toBe(true)
  })

  it('does NOT issue a new charge order', async () => {
    const actions = await evaluate(vehicle, ctx)
    expect(actions.some(a => a.type === 'CHARGE_ORDER')).toBe(false)
  })
})

describe('C-10: FMS tasks available, robot is idle — stay parked', () => {
  const vehicle = buildVehicle({ name: 'Vehicle-0001', energyLevel: 65, state: 'IDLE', processingState: 'IDLE' })
  const fmsTask = buildFMSTask('Vehicle-0002', 'FMS-PENDING-001', { processingVehicle: null, state: 'ACTIVE' })
  const ctx = makeContext({ vehicles: [vehicle], orders: [fmsTask] })

  it('returns NO_ACTION when FMS tasks are available', async () => {
    const actions = await evaluate(vehicle, ctx)
    expect(actions.some(a => a.type === 'NO_ACTION' && a.vehicle === 'Vehicle-0001')).toBe(true)
  })

  it('does NOT issue a charge order', async () => {
    const actions = await evaluate(vehicle, ctx)
    expect(actions.some(a => a.type === 'CHARGE_ORDER')).toBe(false)
  })
})

describe('C-11: no free charger available — NO_ACTION with reason', () => {
  const vehicle = buildVehicle({ name: 'Vehicle-0001', energyLevel: 55, state: 'IDLE', processingState: 'IDLE' })
  const ctx = makeContext({
    vehicles: [vehicle],
    chargers: [
      occupiedCharger('ChargingStation-1', 'Vehicle-0002'),
      occupiedCharger('ChargingStation-2', 'Vehicle-0003'),
    ],
  })

  it('returns NO_ACTION when no charger is free', async () => {
    const actions = await evaluate(vehicle, ctx)
    expect(actions.some(a => a.type === 'NO_ACTION')).toBe(true)
  })
})
