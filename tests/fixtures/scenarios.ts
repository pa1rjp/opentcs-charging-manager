import { AppConfig } from '../../src/config/schema'
import { ChargerOccupancy } from '../../src/opentcs/types'
import { MockVehicle, MockOrder, buildVehicle, buildChargeOrder, buildFMSTask } from './vehicles'

export interface ExpectedAction {
  type: 'CHARGE_ORDER' | 'PARK_ORDER' | 'WITHDRAW_ORDER' | 'DISABLE_ROBOT' | 'ENABLE_ROBOT' | 'NO_ACTION'
  vehicle: string
  charger?: string
}

export interface ChargingScenario {
  id: string
  description: string
  vehicles: MockVehicle[]
  transportOrders: MockOrder[]
  chargers: ChargerOccupancy[]
  expectedActions: ExpectedAction[]
}

export const DEFAULT_CONFIG: AppConfig = {
  thresholds: { critical: 30, good: 50, sufficient: 80, full: 98 },
  chargers: [
    { name: 'ChargingStation-1', locationName: 'ChargingStation-1', operation: 'CHARGE' },
    { name: 'ChargingStation-2', locationName: 'ChargingStation-2', operation: 'CHARGE' },
  ],
  vehicles: [
    { name: 'Vehicle-0001', preferredCharger: 'ChargingStation-1', preferredParkingPoint: 'ParkingPoint-0001' },
    { name: 'Vehicle-0002', preferredCharger: 'ChargingStation-1', preferredParkingPoint: 'ParkingPoint-0002' },
    { name: 'Vehicle-0003', preferredCharger: 'ChargingStation-2', preferredParkingPoint: 'ParkingPoint-0003' },
    { name: 'Vehicle-0004', preferredCharger: 'ChargingStation-2', preferredParkingPoint: 'ParkingPoint-0004' },
  ],
  pollIntervalMs: 10000,
  engineEnabled: true,
}

export const freeChargers: ChargerOccupancy[] = [
  { name: 'ChargingStation-1', locationName: 'ChargingStation-1', occupied: false, occupiedBy: null, enRouteBy: null },
  { name: 'ChargingStation-2', locationName: 'ChargingStation-2', occupied: false, occupiedBy: null, enRouteBy: null },
]

export function occupiedCharger(chargerName: string, byVehicle: string): ChargerOccupancy {
  return { name: chargerName, locationName: chargerName, occupied: true, occupiedBy: byVehicle, enRouteBy: null }
}

export function enRouteCharger(chargerName: string, byVehicle: string): ChargerOccupancy {
  return { name: chargerName, locationName: chargerName, occupied: false, occupiedBy: null, enRouteBy: byVehicle }
}

// ─── C-series scenarios (critical/good/sufficient/full rules) ─────────────────

export const SCENARIOS: ChargingScenario[] = [
  {
    id: 'C-01',
    description: 'Battery hits 30%, charger idle, no task',
    vehicles: [buildVehicle({ name: 'Vehicle-0001', energyLevel: 28, state: 'IDLE', processingState: 'IDLE' })],
    transportOrders: [],
    chargers: freeChargers,
    expectedActions: [
      { type: 'DISABLE_ROBOT', vehicle: 'Vehicle-0001' },
      { type: 'CHARGE_ORDER',  vehicle: 'Vehicle-0001', charger: 'ChargingStation-1' },
    ],
  },
  {
    id: 'C-02',
    description: 'Battery 30%, task in progress (drop leg), charger idle',
    vehicles: [buildVehicle({ name: 'Vehicle-0001', energyLevel: 28, state: 'EXECUTING', processingState: 'PROCESSING_ORDER', transportOrder: 'FMS-001' })],
    transportOrders: [buildFMSTask('Vehicle-0001', 'FMS-001')],
    chargers: freeChargers,
    expectedActions: [
      { type: 'DISABLE_ROBOT', vehicle: 'Vehicle-0001' },
      { type: 'CHARGE_ORDER',  vehicle: 'Vehicle-0001', charger: 'ChargingStation-1' },
    ],
  },
  {
    id: 'C-03',
    description: 'Battery 30%, charger occupied by Good-level robot',
    vehicles: [
      buildVehicle({ name: 'Vehicle-0001', energyLevel: 28, state: 'IDLE', processingState: 'IDLE' }),
      buildVehicle({ name: 'Vehicle-0002', energyLevel: 65, state: 'CHARGING', processingState: 'PROCESSING_ORDER', transportOrder: 'CHARGE-V002-001' }),
    ],
    transportOrders: [buildChargeOrder('Vehicle-0002', 'ChargingStation-1')],
    chargers: [occupiedCharger('ChargingStation-1', 'Vehicle-0002'), freeChargers[1]],
    expectedActions: [
      { type: 'WITHDRAW_ORDER', vehicle: 'Vehicle-0002' },
      { type: 'PARK_ORDER',     vehicle: 'Vehicle-0002' },
      { type: 'DISABLE_ROBOT',  vehicle: 'Vehicle-0001' },
      { type: 'CHARGE_ORDER',   vehicle: 'Vehicle-0001', charger: 'ChargingStation-1' },
    ],
  },
  {
    id: 'C-04',
    description: 'Battery 30%, charger occupied by another Critical robot',
    vehicles: [
      buildVehicle({ name: 'Vehicle-0001', energyLevel: 28, state: 'IDLE', processingState: 'IDLE' }),
      buildVehicle({ name: 'Vehicle-0002', energyLevel: 25, state: 'CHARGING', processingState: 'PROCESSING_ORDER', transportOrder: 'CHARGE-V002-001' }),
    ],
    transportOrders: [buildChargeOrder('Vehicle-0002', 'ChargingStation-1')],
    chargers: [occupiedCharger('ChargingStation-1', 'Vehicle-0002'), freeChargers[1]],
    expectedActions: [
      { type: 'DISABLE_ROBOT', vehicle: 'Vehicle-0001' },
      { type: 'NO_ACTION',     vehicle: 'Vehicle-0001' },
    ],
  },
  {
    id: 'C-16',
    description: 'Battery >= 98%, robot is CHARGING — should park',
    vehicles: [buildVehicle({ name: 'Vehicle-0001', energyLevel: 98, state: 'CHARGING', processingState: 'PROCESSING_ORDER', transportOrder: 'CHARGE-V001-001' })],
    transportOrders: [buildChargeOrder('Vehicle-0001', 'ChargingStation-1')],
    chargers: [occupiedCharger('ChargingStation-1', 'Vehicle-0001'), freeChargers[1]],
    expectedActions: [
      { type: 'WITHDRAW_ORDER', vehicle: 'Vehicle-0001' },
      { type: 'PARK_ORDER',     vehicle: 'Vehicle-0001' },
    ],
  },
  {
    id: 'C-17',
    description: 'Battery 98% but robot is IDLE (not charging) — no action',
    vehicles: [buildVehicle({ name: 'Vehicle-0001', energyLevel: 98, state: 'IDLE', processingState: 'IDLE' })],
    transportOrders: [],
    chargers: freeChargers,
    expectedActions: [],
  },
]
