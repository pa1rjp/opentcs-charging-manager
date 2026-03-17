import { evaluate } from '../../src/engine/rules/enRoutePreemption'
import { RuleContext } from '../../src/engine/types'
import { buildVehicle, buildChargeOrder } from '../fixtures/vehicles'
import { DEFAULT_CONFIG, freeChargers, enRouteCharger, occupiedCharger } from '../fixtures/scenarios'

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

describe('E-01: same group, lower % robot frees up while higher % en route', () => {
  const enRouteVehicle = buildVehicle({
    name: 'Vehicle-0001', energyLevel: 30, state: 'EXECUTING',
    processingState: 'PROCESSING_ORDER', transportOrder: 'CHARGE-V001-001',
  })
  const freeVehicle = buildVehicle({
    name: 'Vehicle-0002', energyLevel: 28, state: 'IDLE',
    processingState: 'IDLE', transportOrder: null,
  })
  const chargeOrder = buildChargeOrder('Vehicle-0001', 'ChargingStation-1', 'BEING_PROCESSED', { name: 'CHARGE-V001-001' })
  const ctx = makeContext({
    vehicles: [enRouteVehicle, freeVehicle],
    orders: [chargeOrder],
    chargers: [enRouteCharger('ChargingStation-1', 'Vehicle-0001'), freeChargers[1]],
  })

  it('withdraws Vehicle-0001 charge order', async () => {
    const actions = await evaluate(ctx)
    expect(actions.some(a => a.type === 'WITHDRAW_ORDER' && a.vehicle === 'Vehicle-0001')).toBe(true)
  })

  it('issues park order to Vehicle-0001', async () => {
    const actions = await evaluate(ctx)
    expect(actions.some(a => a.type === 'PARK_ORDER' && a.vehicle === 'Vehicle-0001')).toBe(true)
  })

  it('issues charge order to Vehicle-0002', async () => {
    const actions = await evaluate(ctx)
    expect(actions.some(a => a.type === 'CHARGE_ORDER' && a.vehicle === 'Vehicle-0002')).toBe(true)
  })

  it('disables Vehicle-0002 (Critical group)', async () => {
    const actions = await evaluate(ctx)
    expect(actions.some(a => a.type === 'DISABLE_ROBOT' && a.vehicle === 'Vehicle-0002')).toBe(true)
  })
})

describe('E-02: same group, higher % robot frees up — no preemption', () => {
  const enRouteVehicle = buildVehicle({
    name: 'Vehicle-0001', energyLevel: 28, state: 'EXECUTING',
    processingState: 'PROCESSING_ORDER', transportOrder: 'CHARGE-V001-001',
  })
  const freeVehicle = buildVehicle({
    name: 'Vehicle-0002', energyLevel: 30, state: 'IDLE',
    processingState: 'IDLE', transportOrder: null,
  })
  const chargeOrder = buildChargeOrder('Vehicle-0001', 'ChargingStation-1', 'BEING_PROCESSED', { name: 'CHARGE-V001-001' })
  const ctx = makeContext({
    vehicles: [enRouteVehicle, freeVehicle],
    orders: [chargeOrder],
    chargers: [enRouteCharger('ChargingStation-1', 'Vehicle-0001'), freeChargers[1]],
  })

  it('does NOT withdraw Vehicle-0001 charge order', async () => {
    const actions = await evaluate(ctx)
    expect(actions.some(a => a.type === 'WITHDRAW_ORDER' && a.vehicle === 'Vehicle-0001')).toBe(false)
  })

  it('does NOT issue any charge order to Vehicle-0002', async () => {
    const actions = await evaluate(ctx)
    expect(actions.some(a => a.type === 'CHARGE_ORDER' && a.vehicle === 'Vehicle-0002')).toBe(false)
  })
})

describe('E-03: cross-group Critical vs Good — Critical wins', () => {
  const enRouteVehicle = buildVehicle({
    name: 'Vehicle-0001', energyLevel: 55, state: 'EXECUTING',
    processingState: 'PROCESSING_ORDER', transportOrder: 'CHARGE-V001-001',
  })
  const freeVehicle = buildVehicle({
    name: 'Vehicle-0002', energyLevel: 28, state: 'IDLE',
    processingState: 'IDLE', transportOrder: null,
  })
  const chargeOrder = buildChargeOrder('Vehicle-0001', 'ChargingStation-1', 'BEING_PROCESSED', { name: 'CHARGE-V001-001' })
  const ctx = makeContext({
    vehicles: [enRouteVehicle, freeVehicle],
    orders: [chargeOrder],
    chargers: [enRouteCharger('ChargingStation-1', 'Vehicle-0001'), freeChargers[1]],
  })

  it('withdraws Good en-route robot charge order', async () => {
    const actions = await evaluate(ctx)
    expect(actions.some(a => a.type === 'WITHDRAW_ORDER' && a.vehicle === 'Vehicle-0001')).toBe(true)
  })

  it('issues park order to Good en-route robot', async () => {
    const actions = await evaluate(ctx)
    expect(actions.some(a => a.type === 'PARK_ORDER' && a.vehicle === 'Vehicle-0001')).toBe(true)
  })

  it('issues charge order to Critical free robot', async () => {
    const actions = await evaluate(ctx)
    expect(actions.some(a => a.type === 'CHARGE_ORDER' && a.vehicle === 'Vehicle-0002')).toBe(true)
  })
})

describe('E-04: cross-group Good vs Critical — Critical protected', () => {
  const enRouteVehicle = buildVehicle({
    name: 'Vehicle-0001', energyLevel: 28, state: 'EXECUTING',
    processingState: 'PROCESSING_ORDER', transportOrder: 'CHARGE-V001-001',
  })
  const freeVehicle = buildVehicle({
    name: 'Vehicle-0002', energyLevel: 55, state: 'IDLE',
    processingState: 'IDLE', transportOrder: null,
  })
  const chargeOrder = buildChargeOrder('Vehicle-0001', 'ChargingStation-1', 'BEING_PROCESSED', { name: 'CHARGE-V001-001' })
  const ctx = makeContext({
    vehicles: [enRouteVehicle, freeVehicle],
    orders: [chargeOrder],
    chargers: [enRouteCharger('ChargingStation-1', 'Vehicle-0001'), freeChargers[1]],
  })

  it('does NOT preempt Critical en-route robot', async () => {
    const actions = await evaluate(ctx)
    expect(actions.some(a => a.type === 'WITHDRAW_ORDER' && a.vehicle === 'Vehicle-0001')).toBe(false)
  })

  it('does NOT issue charge order to Good free robot via preemption', async () => {
    const actions = await evaluate(ctx)
    expect(actions.some(a => a.type === 'CHARGE_ORDER' && a.vehicle === 'Vehicle-0002')).toBe(false)
  })
})

describe('E-05: Good group en-route preemption', () => {
  const enRouteVehicle = buildVehicle({
    name: 'Vehicle-0001', energyLevel: 72, state: 'EXECUTING',
    processingState: 'PROCESSING_ORDER', transportOrder: 'CHARGE-V001-001',
  })
  const freeVehicle = buildVehicle({
    name: 'Vehicle-0002', energyLevel: 58, state: 'IDLE',
    processingState: 'IDLE', transportOrder: null,
  })
  const chargeOrder = buildChargeOrder('Vehicle-0001', 'ChargingStation-1', 'BEING_PROCESSED', { name: 'CHARGE-V001-001' })
  const ctx = makeContext({
    vehicles: [enRouteVehicle, freeVehicle],
    orders: [chargeOrder],
    chargers: [enRouteCharger('ChargingStation-1', 'Vehicle-0001'), freeChargers[1]],
  })

  it('withdraws 72% Good en-route robot', async () => {
    const actions = await evaluate(ctx)
    expect(actions.some(a => a.type === 'WITHDRAW_ORDER' && a.vehicle === 'Vehicle-0001')).toBe(true)
  })

  it('parks 72% Good en-route robot', async () => {
    const actions = await evaluate(ctx)
    expect(actions.some(a => a.type === 'PARK_ORDER' && a.vehicle === 'Vehicle-0001')).toBe(true)
  })

  it('issues charge order to 58% Good free robot', async () => {
    const actions = await evaluate(ctx)
    expect(actions.some(a => a.type === 'CHARGE_ORDER' && a.vehicle === 'Vehicle-0002')).toBe(true)
  })
})

describe('E-06: Sufficient group en-route preemption', () => {
  const enRouteVehicle = buildVehicle({
    name: 'Vehicle-0001', energyLevel: 88, state: 'EXECUTING',
    processingState: 'PROCESSING_ORDER', transportOrder: 'CHARGE-V001-001',
  })
  const freeVehicle = buildVehicle({
    name: 'Vehicle-0002', energyLevel: 82, state: 'IDLE',
    processingState: 'IDLE', transportOrder: null,
  })
  const chargeOrder = buildChargeOrder('Vehicle-0001', 'ChargingStation-1', 'BEING_PROCESSED', { name: 'CHARGE-V001-001' })
  const ctx = makeContext({
    vehicles: [enRouteVehicle, freeVehicle],
    orders: [chargeOrder],
    chargers: [enRouteCharger('ChargingStation-1', 'Vehicle-0001'), freeChargers[1]],
  })

  it('withdraws 88% Sufficient en-route robot', async () => {
    const actions = await evaluate(ctx)
    expect(actions.some(a => a.type === 'WITHDRAW_ORDER' && a.vehicle === 'Vehicle-0001')).toBe(true)
  })

  it('issues charge order to 82% Sufficient free robot', async () => {
    const actions = await evaluate(ctx)
    expect(actions.some(a => a.type === 'CHARGE_ORDER' && a.vehicle === 'Vehicle-0002')).toBe(true)
  })
})

describe('E-07: Robot A already CHARGING — en-route rule does not apply', () => {
  const chargingVehicle = buildVehicle({
    name: 'Vehicle-0001', energyLevel: 30, state: 'CHARGING',
    processingState: 'PROCESSING_ORDER', transportOrder: 'CHARGE-V001-001',
  })
  const freeVehicle = buildVehicle({
    name: 'Vehicle-0002', energyLevel: 28, state: 'IDLE',
    processingState: 'IDLE', transportOrder: null,
  })
  const chargeOrder = buildChargeOrder('Vehicle-0001', 'ChargingStation-1', 'BEING_PROCESSED', { name: 'CHARGE-V001-001' })
  const ctx = makeContext({
    vehicles: [chargingVehicle, freeVehicle],
    orders: [chargeOrder],
    chargers: [occupiedCharger('ChargingStation-1', 'Vehicle-0001'), freeChargers[1]],
  })

  it('does NOT use en-route preemption on CHARGING robot', async () => {
    const actions = await evaluate(ctx)
    expect(actions.some(a => a.vehicle === 'Vehicle-0001')).toBe(false)
  })

  it('returns empty actions (physical preemption handles this)', async () => {
    const actions = await evaluate(ctx)
    const preemptActions = actions.filter(a => a.vehicle === 'Vehicle-0002')
    expect(preemptActions.length).toBe(0)
  })
})

describe('E-08: four-robot scenario — two en route, two free', () => {
  const robotA = buildVehicle({ name: 'Vehicle-0001', energyLevel: 60, state: 'EXECUTING', processingState: 'PROCESSING_ORDER', transportOrder: 'CHARGE-V001-001' })
  const robotB = buildVehicle({ name: 'Vehicle-0002', energyLevel: 85, state: 'EXECUTING', processingState: 'PROCESSING_ORDER', transportOrder: 'CHARGE-V002-001' })
  const robotC = buildVehicle({ name: 'Vehicle-0003', energyLevel: 28, state: 'IDLE', processingState: 'IDLE', transportOrder: null })
  const robotD = buildVehicle({ name: 'Vehicle-0004', energyLevel: 55, state: 'IDLE', processingState: 'IDLE', transportOrder: null })

  const orderA = buildChargeOrder('Vehicle-0001', 'ChargingStation-1', 'BEING_PROCESSED', { name: 'CHARGE-V001-001' })
  const orderB = buildChargeOrder('Vehicle-0002', 'ChargingStation-2', 'BEING_PROCESSED', { name: 'CHARGE-V002-001' })

  const ctx = makeContext({
    vehicles: [robotA, robotB, robotC, robotD],
    orders: [orderA, orderB],
    chargers: [
      enRouteCharger('ChargingStation-1', 'Vehicle-0001'),
      enRouteCharger('ChargingStation-2', 'Vehicle-0002'),
    ],
  })

  it('Vehicle-C (Critical) wins over Vehicle-A (Good) on charger 1', async () => {
    const actions = await evaluate(ctx)
    expect(actions.some(a => a.type === 'CHARGE_ORDER' && a.vehicle === 'Vehicle-0003')).toBe(true)
    expect(actions.some(a => a.type === 'WITHDRAW_ORDER' && a.vehicle === 'Vehicle-0001')).toBe(true)
  })

  it('Vehicle-D (55% Good) wins over Vehicle-B (85% Sufficient) on charger 2', async () => {
    const actions = await evaluate(ctx)
    expect(actions.some(a => a.type === 'CHARGE_ORDER' && a.vehicle === 'Vehicle-0004')).toBe(true)
    expect(actions.some(a => a.type === 'WITHDRAW_ORDER' && a.vehicle === 'Vehicle-0002')).toBe(true)
  })

  it('Vehicle-A and Vehicle-B both receive park orders', async () => {
    const actions = await evaluate(ctx)
    expect(actions.some(a => a.type === 'PARK_ORDER' && a.vehicle === 'Vehicle-0001')).toBe(true)
    expect(actions.some(a => a.type === 'PARK_ORDER' && a.vehicle === 'Vehicle-0002')).toBe(true)
  })
})
