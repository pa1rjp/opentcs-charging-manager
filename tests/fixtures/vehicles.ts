import { Vehicle, TransportOrder, OrderState } from '../../src/opentcs/types'

export interface MockVehicle extends Vehicle {}

export function buildVehicle(overrides: Partial<MockVehicle> = {}): MockVehicle {
  return {
    name: 'Vehicle-0001',
    energyLevel: 75,
    energyLevelCritical: 30,
    energyLevelGood: 50,
    energyLevelSufficientlyRecharged: 80,
    energyLevelFullyRecharged: 98,
    state: 'IDLE',
    processingState: 'IDLE',
    integrationLevel: 'TO_BE_UTILIZED',
    currentPosition: 'ParkingPoint-0001',
    transportOrder: null,
    ...overrides,
  }
}

// ─── Preset builders ──────────────────────────────────────────────────────────

export const critical = (overrides: Partial<MockVehicle> = {}) =>
  buildVehicle({ energyLevel: 28, state: 'IDLE', processingState: 'IDLE', ...overrides })

export const good = (overrides: Partial<MockVehicle> = {}) =>
  buildVehicle({ energyLevel: 65, state: 'IDLE', processingState: 'IDLE', ...overrides })

export const sufficient = (overrides: Partial<MockVehicle> = {}) =>
  buildVehicle({ energyLevel: 85, state: 'CHARGING', processingState: 'PROCESSING_ORDER', ...overrides })

export const full = (overrides: Partial<MockVehicle> = {}) =>
  buildVehicle({ energyLevel: 98, state: 'CHARGING', processingState: 'PROCESSING_ORDER', ...overrides })

// ─── Order builder ────────────────────────────────────────────────────────────

export interface MockOrder extends TransportOrder {}

export function buildOrder(overrides: Partial<MockOrder> = {}): MockOrder {
  return {
    name: 'TOrder-0001',
    state: 'BEING_PROCESSED',
    intendedVehicle: 'Vehicle-0001',
    processingVehicle: 'Vehicle-0001',
    destinations: [{ locationName: 'ChargingStation-1', operation: 'CHARGE' }],
    dispensable: false,
    ...overrides,
  }
}

export function buildChargeOrder(
  vehicleName: string,
  chargerName: string,
  state: OrderState = 'BEING_PROCESSED',
  overrides: Partial<MockOrder> = {}
): MockOrder {
  return buildOrder({
    name: `CHARGE-${vehicleName}-001`,
    intendedVehicle: vehicleName,
    processingVehicle: vehicleName,
    state,
    destinations: [{ locationName: chargerName, operation: 'CHARGE' }],
    dispensable: false,
    ...overrides,
  })
}

export function buildParkOrder(
  vehicleName: string,
  parkingPoint = 'ParkingPoint-0001',
  overrides: Partial<MockOrder> = {}
): MockOrder {
  return buildOrder({
    name: `PARK-${vehicleName}-001`,
    intendedVehicle: vehicleName,
    processingVehicle: vehicleName,
    state: 'BEING_PROCESSED',
    destinations: [{ locationName: parkingPoint, operation: 'PARK' }],
    dispensable: true,
    ...overrides,
  })
}

export function buildFMSTask(
  vehicleName: string,
  orderName = 'TOrder-FMS-001',
  overrides: Partial<MockOrder> = {}
): MockOrder {
  return buildOrder({
    name: orderName,
    intendedVehicle: vehicleName,
    processingVehicle: vehicleName,
    state: 'BEING_PROCESSED',
    destinations: [{ locationName: 'Location-A', operation: 'LOAD' }],
    dispensable: false,
    ...overrides,
  })
}
