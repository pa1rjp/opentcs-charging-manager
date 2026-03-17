import { buildPreemptionActions, resolveChargerOccupant } from '../../src/engine/preemption'
import { RuleContext } from '../../src/engine/types'
import { getEventLog } from '../../src/store/EventLog'
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

beforeEach(() => {
  getEventLog().clear()
})

describe('buildPreemptionActions: Guard 1 — occupant must be CHARGING', () => {
  it('returns [] if occupant state is not CHARGING', () => {
    const incoming = buildVehicle({ name: 'Vehicle-0001', energyLevel: 28 })
    const occupant = buildVehicle({ name: 'Vehicle-0002', energyLevel: 65, state: 'EXECUTING' })
    const ctx = makeContext({ vehicles: [incoming, occupant] })

    const actions = buildPreemptionActions(
      { chargerName: 'ChargingStation-1', incomingVehicle: incoming, occupantVehicle: occupant, occupantOrder: null },
      ctx
    )
    expect(actions).toHaveLength(0)
  })
})

describe('buildPreemptionActions: Guard 2 — occupant must be above Critical', () => {
  it('returns [] if occupant is Critical (never preempt Critical)', () => {
    const incoming = buildVehicle({ name: 'Vehicle-0001', energyLevel: 28 })
    const occupant = buildVehicle({ name: 'Vehicle-0002', energyLevel: 25, state: 'CHARGING' })
    const ctx = makeContext({ vehicles: [incoming, occupant] })

    const actions = buildPreemptionActions(
      { chargerName: 'ChargingStation-1', incomingVehicle: incoming, occupantVehicle: occupant, occupantOrder: null },
      ctx
    )
    expect(actions).toHaveLength(0)
  })
})

describe('buildPreemptionActions: Guard 3 — debounce via EventLog', () => {
  it('returns [] if PREEMPT_INITIATED was logged recently for this charger', () => {
    getEventLog().add({
      level: 'warn',
      charger: 'ChargingStation-1',
      rule: 'MANUAL',
      action: 'PREEMPT_INITIATED',
      detail: 'test',
    })

    const incoming = buildVehicle({ name: 'Vehicle-0001', energyLevel: 28 })
    const occupant = buildVehicle({ name: 'Vehicle-0002', energyLevel: 65, state: 'CHARGING' })
    const ctx = makeContext({ vehicles: [incoming, occupant] })

    const actions = buildPreemptionActions(
      { chargerName: 'ChargingStation-1', incomingVehicle: incoming, occupantVehicle: occupant, occupantOrder: null },
      ctx
    )
    expect(actions).toHaveLength(0)
  })
})

describe('buildPreemptionActions: valid preemption', () => {
  const incoming = buildVehicle({ name: 'Vehicle-0001', energyLevel: 28 })
  const occupant = buildVehicle({ name: 'Vehicle-0002', energyLevel: 65, state: 'CHARGING', transportOrder: 'CHARGE-V002-001' })
  const occupantOrder = buildChargeOrder('Vehicle-0002', 'ChargingStation-1', 'BEING_PROCESSED', { name: 'CHARGE-V002-001' })
  const ctx = makeContext({
    vehicles: [incoming, occupant],
    orders: [occupantOrder],
    chargers: [occupiedCharger('ChargingStation-1', 'Vehicle-0002'), freeChargers[1]],
  })

  it('emits WITHDRAW_ORDER for the occupant', () => {
    const actions = buildPreemptionActions(
      { chargerName: 'ChargingStation-1', incomingVehicle: incoming, occupantVehicle: occupant, occupantOrder },
      ctx
    )
    expect(actions.some(a => a.type === 'WITHDRAW_ORDER' && a.vehicle === 'Vehicle-0002')).toBe(true)
  })

  it('emits PARK_ORDER for the occupant', () => {
    const actions = buildPreemptionActions(
      { chargerName: 'ChargingStation-1', incomingVehicle: incoming, occupantVehicle: occupant, occupantOrder },
      ctx
    )
    expect(actions.some(a => a.type === 'PARK_ORDER' && a.vehicle === 'Vehicle-0002')).toBe(true)
  })

  it('emits CHARGE_ORDER for the incoming vehicle', () => {
    const actions = buildPreemptionActions(
      { chargerName: 'ChargingStation-1', incomingVehicle: incoming, occupantVehicle: occupant, occupantOrder },
      ctx
    )
    expect(actions.some(a => a.type === 'CHARGE_ORDER' && a.vehicle === 'Vehicle-0001')).toBe(true)
  })
})

describe('resolveChargerOccupant', () => {
  it('finds the vehicle physically at the charger', () => {
    const charging = buildVehicle({ name: 'Vehicle-0001', state: 'CHARGING', transportOrder: 'CHARGE-V001-001' })
    const chargeOrder = buildChargeOrder('Vehicle-0001', 'ChargingStation-1', 'BEING_PROCESSED', { name: 'CHARGE-V001-001' })

    const result = resolveChargerOccupant('ChargingStation-1', [charging], [chargeOrder])
    expect(result).not.toBeNull()
    expect(result?.vehicle.name).toBe('Vehicle-0001')
  })

  it('returns null when no vehicle is CHARGING at that charger', () => {
    const idle = buildVehicle({ name: 'Vehicle-0001', state: 'IDLE' })
    const result = resolveChargerOccupant('ChargingStation-1', [idle], [])
    expect(result).toBeNull()
  })
})
