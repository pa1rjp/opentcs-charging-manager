import { evaluate } from '../../src/engine/rules/criticalRule'
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

describe('C-01: battery hits 30%, charger idle, no task', () => {
  const vehicle = buildVehicle({ name: 'Vehicle-0001', energyLevel: 28, state: 'IDLE', processingState: 'IDLE' })
  const ctx = makeContext({ vehicles: [vehicle] })

  it('issues a charge order to the vehicle', async () => {
    const actions = await evaluate(vehicle, ctx)
    expect(actions.some(a => a.type === 'CHARGE_ORDER' && a.vehicle === 'Vehicle-0001')).toBe(true)
  })

  it('disables the vehicle (sets TO_BE_RESPECTED)', async () => {
    const actions = await evaluate(vehicle, ctx)
    expect(actions.some(a => a.type === 'DISABLE_ROBOT' && a.vehicle === 'Vehicle-0001')).toBe(true)
  })

  it('does NOT assign the charge order to a different vehicle', async () => {
    const actions = await evaluate(vehicle, ctx)
    const chargeActions = actions.filter(a => a.type === 'CHARGE_ORDER')
    expect(chargeActions.every(a => a.vehicle === 'Vehicle-0001')).toBe(true)
  })

  it('returns no actions for non-critical battery level', async () => {
    const nonCritical = buildVehicle({ name: 'Vehicle-0001', energyLevel: 50 })
    const actions = await evaluate(nonCritical, ctx)
    expect(actions).toHaveLength(0)
  })
})

describe('C-02: battery 30%, task in progress (drop leg), charger idle', () => {
  const vehicle = buildVehicle({
    name: 'Vehicle-0001', energyLevel: 28, state: 'EXECUTING',
    processingState: 'PROCESSING_ORDER', transportOrder: 'FMS-001',
  })
  const fmsTask = buildFMSTask('Vehicle-0001', 'FMS-001')
  const ctx = makeContext({ vehicles: [vehicle], orders: [fmsTask] })

  it('does NOT withdraw the current transport order', async () => {
    const actions = await evaluate(vehicle, ctx)
    expect(actions.some(a => a.type === 'WITHDRAW_ORDER')).toBe(false)
  })

  it('queues a charge order after the current task', async () => {
    const actions = await evaluate(vehicle, ctx)
    expect(actions.some(a => a.type === 'CHARGE_ORDER' && a.vehicle === 'Vehicle-0001')).toBe(true)
  })

  it('disables the vehicle to prevent new task assignment', async () => {
    const actions = await evaluate(vehicle, ctx)
    expect(actions.some(a => a.type === 'DISABLE_ROBOT' && a.vehicle === 'Vehicle-0001')).toBe(true)
  })
})

describe('C-03: battery 30%, charger occupied by Good-level robot (all chargers full)', () => {
  const criticalVehicle = buildVehicle({ name: 'Vehicle-0001', energyLevel: 28, state: 'IDLE', processingState: 'IDLE' })
  const goodVehicle = buildVehicle({
    name: 'Vehicle-0002', energyLevel: 65, state: 'CHARGING',
    processingState: 'PROCESSING_ORDER', transportOrder: 'CHARGE-V002-001',
  })
  const goodOrder = buildChargeOrder('Vehicle-0002', 'ChargingStation-1', 'BEING_PROCESSED', { name: 'CHARGE-V002-001' })
  // Both chargers occupied so the critical rule must preempt the preferred charger
  const ctx = makeContext({
    vehicles: [criticalVehicle, goodVehicle],
    orders: [goodOrder],
    chargers: [
      occupiedCharger('ChargingStation-1', 'Vehicle-0002'),
      occupiedCharger('ChargingStation-2', 'Vehicle-0003'),
    ],
  })

  it('withdraws the Good-level robot charge order', async () => {
    const actions = await evaluate(criticalVehicle, ctx)
    expect(actions.some(a => a.type === 'WITHDRAW_ORDER' && a.vehicle === 'Vehicle-0002')).toBe(true)
  })

  it('issues a park order to the Good-level robot', async () => {
    const actions = await evaluate(criticalVehicle, ctx)
    expect(actions.some(a => a.type === 'PARK_ORDER' && a.vehicle === 'Vehicle-0002')).toBe(true)
  })

  it('issues a charge order to the critical robot', async () => {
    const actions = await evaluate(criticalVehicle, ctx)
    expect(actions.some(a => a.type === 'CHARGE_ORDER' && a.vehicle === 'Vehicle-0001')).toBe(true)
  })
})

describe('C-04: battery 30%, charger occupied by another Critical robot (all chargers full)', () => {
  const criticalVehicle1 = buildVehicle({ name: 'Vehicle-0001', energyLevel: 28, state: 'IDLE', processingState: 'IDLE' })
  const criticalVehicle2 = buildVehicle({
    name: 'Vehicle-0002', energyLevel: 25, state: 'CHARGING',
    processingState: 'PROCESSING_ORDER', transportOrder: 'CHARGE-V002-001',
  })
  const chargeOrder = buildChargeOrder('Vehicle-0002', 'ChargingStation-1', 'BEING_PROCESSED', { name: 'CHARGE-V002-001' })
  const ctx = makeContext({
    vehicles: [criticalVehicle1, criticalVehicle2],
    orders: [chargeOrder],
    chargers: [
      occupiedCharger('ChargingStation-1', 'Vehicle-0002'),
      occupiedCharger('ChargingStation-2', 'Vehicle-0003'),
    ],
  })

  it('does NOT withdraw the charging critical robot', async () => {
    const actions = await evaluate(criticalVehicle1, ctx)
    expect(actions.some(a => a.type === 'WITHDRAW_ORDER')).toBe(false)
  })

  it('queues the new critical robot and holds it (NO_ACTION)', async () => {
    const actions = await evaluate(criticalVehicle1, ctx)
    expect(actions.some(a => a.type === 'NO_ACTION' && a.vehicle === 'Vehicle-0001')).toBe(true)
  })

  it('still disables the waiting critical robot', async () => {
    const actions = await evaluate(criticalVehicle1, ctx)
    expect(actions.some(a => a.type === 'DISABLE_ROBOT' && a.vehicle === 'Vehicle-0001')).toBe(true)
  })
})

describe('C-05: battery 30%, charger occupied by Sufficient-level robot (all chargers full)', () => {
  const criticalVehicle = buildVehicle({ name: 'Vehicle-0001', energyLevel: 28, state: 'IDLE', processingState: 'IDLE' })
  const sufficientVehicle = buildVehicle({
    name: 'Vehicle-0002', energyLevel: 85, state: 'CHARGING',
    processingState: 'PROCESSING_ORDER', transportOrder: 'CHARGE-V002-001',
  })
  const chargeOrder = buildChargeOrder('Vehicle-0002', 'ChargingStation-1', 'BEING_PROCESSED', { name: 'CHARGE-V002-001' })
  const ctx = makeContext({
    vehicles: [criticalVehicle, sufficientVehicle],
    orders: [chargeOrder],
    chargers: [
      occupiedCharger('ChargingStation-1', 'Vehicle-0002'),
      occupiedCharger('ChargingStation-2', 'Vehicle-0003'),
    ],
  })

  it('preempts the Sufficient robot', async () => {
    const actions = await evaluate(criticalVehicle, ctx)
    expect(actions.some(a => a.type === 'WITHDRAW_ORDER' && a.vehicle === 'Vehicle-0002')).toBe(true)
    expect(actions.some(a => a.type === 'PARK_ORDER' && a.vehicle === 'Vehicle-0002')).toBe(true)
  })

  it('issues charge to critical robot', async () => {
    const actions = await evaluate(criticalVehicle, ctx)
    expect(actions.some(a => a.type === 'CHARGE_ORDER' && a.vehicle === 'Vehicle-0001')).toBe(true)
  })
})

describe('Re-enable: battery crosses 50%, robot was disabled', () => {
  it('does not trigger criticalRule for battery at 50% (above threshold)', async () => {
    const vehicle = buildVehicle({ energyLevel: 50, integrationLevel: 'TO_BE_RESPECTED' })
    const ctx = makeContext({ vehicles: [vehicle] })
    const actions = await evaluate(vehicle, ctx)
    expect(actions).toHaveLength(0)
  })
})
