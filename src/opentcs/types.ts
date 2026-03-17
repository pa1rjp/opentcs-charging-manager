// ─── Vehicle ─────────────────────────────────────────────────────────────────

export type VehicleState =
  | 'IDLE'
  | 'EXECUTING'
  | 'CHARGING'
  | 'ERROR'
  | 'UNAVAILABLE'
  | 'UNKNOWN'

export type ProcessingState =
  | 'IDLE'
  | 'AWAITING_ORDER'
  | 'PROCESSING_ORDER'
  | 'UNAVAILABLE'
  | 'UNKNOWN'

export type IntegrationLevel =
  | 'TO_BE_UTILIZED'
  | 'TO_BE_RESPECTED'
  | 'TO_BE_NOTICED'
  | 'IGNORED'

export interface Vehicle {
  name: string
  energyLevel: number                  // 0–100 integer
  energyLevelCritical: number          // threshold stored on vehicle
  energyLevelGood: number
  energyLevelSufficientlyRecharged: number
  energyLevelFullyRecharged: number
  state: VehicleState
  processingState: ProcessingState
  integrationLevel: IntegrationLevel
  currentPosition: string | null
  transportOrder: string | null        // name of active transport order, if any
}

// ─── Transport Orders ─────────────────────────────────────────────────────────

export type OrderState =
  | 'RAW'
  | 'ACTIVE'
  | 'DISPATCHABLE'
  | 'BEING_PROCESSED'
  | 'WITHDRAWN'
  | 'FINISHED'
  | 'FAILED'
  | 'UNROUTABLE'

export interface OrderDestination {
  locationName: string
  operation: string
  state?: string
}

export interface TransportOrder {
  name: string
  state: OrderState
  intendedVehicle: string | null
  processingVehicle: string | null
  destinations: OrderDestination[]
  dispensable: boolean
  deadline?: string
  finishedTime?: string
}

// ─── API Request Bodies ───────────────────────────────────────────────────────

export interface CreateTransportOrderBody {
  destinations: OrderDestination[]
  intendedVehicle?: string
  dispensable?: boolean
  deadline?: string
}

export interface WithdrawalBody {
  immediate: boolean
}

export interface IntegrationLevelBody {
  value: IntegrationLevel
}

// ─── Charger Occupancy ────────────────────────────────────────────────────────

export interface ChargerOccupancy {
  name: string
  locationName: string
  occupied: boolean
  occupiedBy: string | null
  enRouteBy: string | null   // vehicle heading to charger but not yet CHARGING
}
