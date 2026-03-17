/**
 * Integration tests — ChargingEngine full cycle with mocked openTCS API client.
 * Scenarios C-19 through C-27: multi-vehicle fleet scenarios.
 */
import { ChargingEngine } from '../../src/engine/ChargingEngine'
import * as clientModule from '../../src/opentcs/client'
import * as configModule from '../../src/store/ConfigStore'
import { getEventLog } from '../../src/store/EventLog'
import { buildVehicle, buildChargeOrder, buildFMSTask } from '../fixtures/vehicles'
import { DEFAULT_CONFIG } from '../fixtures/scenarios'
import { TransportOrder } from '../../src/opentcs/types'

jest.mock('../../src/opentcs/client')
jest.mock('../../src/store/ConfigStore')

function makeMockClient(vehicles = [] as ReturnType<typeof buildVehicle>[], orders: TransportOrder[] = []) {
  const mock = {
    getAllVehicles: jest.fn().mockResolvedValue(vehicles),
    getAllTransportOrders: jest.fn().mockResolvedValue(orders),
    getVehicle: jest.fn(),
    createTransportOrder: jest.fn().mockResolvedValue({ name: 'NEW-001', state: 'ACTIVE', destinations: [], intendedVehicle: null, processingVehicle: null, dispensable: false }),
    withdrawTransportOrder: jest.fn().mockResolvedValue(undefined),
    forceWithdrawTransportOrder: jest.fn().mockResolvedValue(undefined),
    setIntegrationLevel: jest.fn().mockResolvedValue(undefined),
    triggerVehicleDispatcher: jest.fn().mockResolvedValue(undefined),
    triggerOrderDispatcher: jest.fn().mockResolvedValue(undefined),
  }
  ;(clientModule.getClient as jest.Mock).mockReturnValue(mock)
  return mock
}

beforeEach(() => {
  jest.clearAllMocks()
  getEventLog().clear()
  ;(configModule.getConfigStore as jest.Mock).mockReturnValue({ get: () => DEFAULT_CONFIG, set: jest.fn(), update: jest.fn() })
})

describe('C-19: single Critical robot, charger free', () => {
  it('disables robot and issues charge order', async () => {
    const vehicle = buildVehicle({ name: 'Vehicle-0001', energyLevel: 25, state: 'IDLE', processingState: 'IDLE' })
    const client = makeMockClient([vehicle])

    const engine = new ChargingEngine()
    await engine.triggerCycle()

    expect(client.setIntegrationLevel).toHaveBeenCalledWith('Vehicle-0001', 'TO_BE_RESPECTED')
    expect(client.createTransportOrder).toHaveBeenCalledWith(
      expect.objectContaining({ intendedVehicle: 'Vehicle-0001' })
    )
  })
})

describe('C-20: single Full robot charging, should park', () => {
  it('withdraws charge order and parks the robot', async () => {
    const vehicle = buildVehicle({ name: 'Vehicle-0001', energyLevel: 98, state: 'CHARGING', processingState: 'PROCESSING_ORDER', transportOrder: 'CHARGE-V001-001' })
    const order = buildChargeOrder('Vehicle-0001', 'ChargingStation-1', 'BEING_PROCESSED', { name: 'CHARGE-V001-001' })
    const client = makeMockClient([vehicle], [order])

    const engine = new ChargingEngine()
    await engine.triggerCycle()

    expect(client.withdrawTransportOrder).toHaveBeenCalledWith('CHARGE-V001-001')
    expect(client.createTransportOrder).toHaveBeenCalledWith(
      expect.objectContaining({ destinations: expect.arrayContaining([expect.objectContaining({ operation: 'PARK' })]) })
    )
  })
})

describe('C-21: Critical robot + Good robot charging — Critical uses free charger first', () => {
  it('issues Critical robot charge order (to free charger, not preempting occupied)', async () => {
    // ChargingStation-1 occupied by Good robot, ChargingStation-2 free
    // Critical robot should route to ChargingStation-2 (no preemption needed)
    const critical = buildVehicle({ name: 'Vehicle-0001', energyLevel: 28, state: 'IDLE', processingState: 'IDLE' })
    const good = buildVehicle({ name: 'Vehicle-0002', energyLevel: 65, state: 'CHARGING', processingState: 'PROCESSING_ORDER', transportOrder: 'CHARGE-V002-001' })
    const order = buildChargeOrder('Vehicle-0002', 'ChargingStation-1', 'BEING_PROCESSED', { name: 'CHARGE-V002-001' })
    const client = makeMockClient([critical, good], [order])

    const engine = new ChargingEngine()
    await engine.triggerCycle()

    // Critical robot gets a charge order (either charger)
    expect(client.createTransportOrder).toHaveBeenCalledWith(
      expect.objectContaining({ intendedVehicle: 'Vehicle-0001' })
    )
    // Good robot is NOT preempted since ChargingStation-2 is free
    expect(client.forceWithdrawTransportOrder).not.toHaveBeenCalled()
  })

  it('preempts Good robot when ALL chargers are occupied', async () => {
    // Both chargers occupied — Critical must preempt
    const critical = buildVehicle({ name: 'Vehicle-0001', energyLevel: 28, state: 'IDLE', processingState: 'IDLE' })
    const good1 = buildVehicle({ name: 'Vehicle-0002', energyLevel: 65, state: 'CHARGING', processingState: 'PROCESSING_ORDER', transportOrder: 'CHARGE-V002-001' })
    const good2 = buildVehicle({ name: 'Vehicle-0003', energyLevel: 70, state: 'CHARGING', processingState: 'PROCESSING_ORDER', transportOrder: 'CHARGE-V003-001' })
    const order1 = buildChargeOrder('Vehicle-0002', 'ChargingStation-1', 'BEING_PROCESSED', { name: 'CHARGE-V002-001' })
    const order2 = buildChargeOrder('Vehicle-0003', 'ChargingStation-2', 'BEING_PROCESSED', { name: 'CHARGE-V003-001' })
    const client = makeMockClient([critical, good1, good2], [order1, order2])

    const engine = new ChargingEngine()
    await engine.triggerCycle()

    expect(client.setIntegrationLevel).toHaveBeenCalledWith('Vehicle-0001', 'TO_BE_RESPECTED')
    expect(client.forceWithdrawTransportOrder).toHaveBeenCalled()
    expect(client.createTransportOrder).toHaveBeenCalledWith(
      expect.objectContaining({ intendedVehicle: 'Vehicle-0001' })
    )
  })
})

describe('C-22: Good robot, no FMS tasks, charger free — opportunistic charge', () => {
  it('issues opportunistic charge order to lowest Good robot', async () => {
    const vehicle = buildVehicle({ name: 'Vehicle-0001', energyLevel: 60, state: 'IDLE', processingState: 'IDLE' })
    const client = makeMockClient([vehicle])

    const engine = new ChargingEngine()
    await engine.triggerCycle()

    expect(client.createTransportOrder).toHaveBeenCalledWith(
      expect.objectContaining({ intendedVehicle: 'Vehicle-0001' })
    )
  })
})

describe('C-23: Good robot charging + FMS task arrives — withdraw charge', () => {
  it('withdraws charge order when FMS task becomes available', async () => {
    const vehicle = buildVehicle({ name: 'Vehicle-0001', energyLevel: 65, state: 'CHARGING', processingState: 'PROCESSING_ORDER', transportOrder: 'CHARGE-V001-001' })
    const chargeOrder = buildChargeOrder('Vehicle-0001', 'ChargingStation-1', 'BEING_PROCESSED', { name: 'CHARGE-V001-001' })
    const fmsTask = buildFMSTask('Vehicle-0002', 'FMS-001', { processingVehicle: null, state: 'ACTIVE' })
    const client = makeMockClient([vehicle], [chargeOrder, fmsTask])

    const engine = new ChargingEngine()
    await engine.triggerCycle()

    expect(client.withdrawTransportOrder).toHaveBeenCalledWith('CHARGE-V001-001')
  })
})

describe('C-24: disabled robot battery crosses 50% — re-enable', () => {
  it('re-enables the robot when battery recovers to 50%', async () => {
    const vehicle = buildVehicle({ name: 'Vehicle-0001', energyLevel: 52, state: 'IDLE', processingState: 'IDLE', integrationLevel: 'TO_BE_RESPECTED' })
    const client = makeMockClient([vehicle])

    const engine = new ChargingEngine()
    await engine.triggerCycle()

    expect(client.setIntegrationLevel).toHaveBeenCalledWith('Vehicle-0001', 'TO_BE_UTILIZED')
  })
})

describe('C-25: two Critical robots, one charger occupied by Critical — second queues', () => {
  it('does NOT preempt the charging Critical robot', async () => {
    const critical1 = buildVehicle({ name: 'Vehicle-0001', energyLevel: 20, state: 'IDLE', processingState: 'IDLE' })
    const critical2 = buildVehicle({ name: 'Vehicle-0002', energyLevel: 25, state: 'CHARGING', processingState: 'PROCESSING_ORDER', transportOrder: 'CHARGE-V002-001' })
    const order = buildChargeOrder('Vehicle-0002', 'ChargingStation-1', 'BEING_PROCESSED', { name: 'CHARGE-V002-001' })
    const client = makeMockClient([critical1, critical2], [order])

    const engine = new ChargingEngine()
    await engine.triggerCycle()

    expect(client.setIntegrationLevel).toHaveBeenCalledWith('Vehicle-0001', 'TO_BE_RESPECTED')
    expect(client.forceWithdrawTransportOrder).not.toHaveBeenCalled()
  })
})

describe('C-26: en-route preemption in full cycle', () => {
  it('Critical free robot displaces Good en-route robot', async () => {
    const enRoute = buildVehicle({ name: 'Vehicle-0001', energyLevel: 60, state: 'EXECUTING', processingState: 'PROCESSING_ORDER', transportOrder: 'CHARGE-V001-001' })
    const critical = buildVehicle({ name: 'Vehicle-0002', energyLevel: 25, state: 'IDLE', processingState: 'IDLE', transportOrder: null })
    const order = buildChargeOrder('Vehicle-0001', 'ChargingStation-1', 'BEING_PROCESSED', { name: 'CHARGE-V001-001' })
    const client = makeMockClient([enRoute, critical], [order])

    const engine = new ChargingEngine()
    await engine.triggerCycle()

    expect(client.withdrawTransportOrder).toHaveBeenCalledWith('CHARGE-V001-001')
    expect(client.createTransportOrder).toHaveBeenCalledWith(
      expect.objectContaining({ intendedVehicle: 'Vehicle-0002' })
    )
  })
})

describe('C-27: engine handles openTCS unreachable gracefully', () => {
  it('catches API errors and logs them without crashing', async () => {
    const mock = {
      getAllVehicles: jest.fn().mockRejectedValue(new Error('Connection refused')),
      getAllTransportOrders: jest.fn().mockResolvedValue([]),
    }
    ;(clientModule.getClient as jest.Mock).mockReturnValue(mock)

    const engine = new ChargingEngine()
    await expect(engine.triggerCycle()).resolves.not.toThrow()

    const logs = getEventLog().query({ level: 'error' })
    expect(logs.length).toBeGreaterThan(0)
  })
})
