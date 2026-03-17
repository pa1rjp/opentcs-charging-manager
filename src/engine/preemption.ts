/**
 * Physical Charger Preemption
 *
 * Used when a robot is physically at the charger (state = CHARGING) and needs to be
 * displaced. This is separate from en-route preemption (Rule 0).
 *
 * Guards before issuing preemption:
 *   1. Charger occupant must be in state = CHARGING (not just en route)
 *   2. Occupant's battery must be ABOVE the critical threshold
 *   3. No preemption already in progress for this charger (debounce via EventLog)
 *
 * This module exports a helper used by ChargingEngine to validate and emit
 * preemption actions. Preemptions are idempotent — debounced within the same
 * poll cycle via the EventLog.
 */

import { Vehicle, TransportOrder } from '../opentcs/types'
import { Action, RuleContext, getChargeGroup, makeOrderName } from './types'
import { getEventLog } from '../store/EventLog'

export interface PreemptionRequest {
  chargerName: string
  incomingVehicle: Vehicle
  occupantVehicle: Vehicle
  occupantOrder: TransportOrder | null
}

/**
 * Validates and returns preemption actions if safe to proceed.
 * Returns [] if preemption guards fail or debounce is active.
 */
export function buildPreemptionActions(
  req: PreemptionRequest,
  context: RuleContext
): Action[] {
  const { chargerName, incomingVehicle, occupantVehicle, occupantOrder } = req
  const { config } = context
  const eventLog = getEventLog()

  // Guard 1: occupant must be physically CHARGING (not en route)
  if (occupantVehicle.state !== 'CHARGING') {
    return []
  }

  // Guard 2: occupant's battery must be above critical threshold
  const occupantGroup = getChargeGroup(occupantVehicle.energyLevel, config.thresholds)
  if (occupantGroup === 'CRITICAL') {
    return []
  }

  // Guard 3: debounce — no preemption for this charger in the last 2 poll cycles
  const debounceMs = (config.pollIntervalMs ?? 10000) * 2
  if (eventLog.hasRecentChargerAction(chargerName, 'PREEMPT_INITIATED', debounceMs)) {
    return []
  }

  const actions: Action[] = []

  const parkingPoint =
    config.vehicles.find((v) => v.name === occupantVehicle.name)?.preferredParkingPoint ??
    'ParkingPoint-0001'

  // Withdraw occupant's charge order
  if (occupantOrder) {
    actions.push({
      type: 'WITHDRAW_ORDER',
      vehicle: occupantVehicle.name,
      orderName: occupantOrder.name,
      immediate: true,
    })
  }

  // Park the occupant
  actions.push({
    type: 'PARK_ORDER',
    vehicle: occupantVehicle.name,
    parkingPoint,
    orderName: makeOrderName('PARK', occupantVehicle.name),
  })

  // Issue charge order to incoming vehicle
  actions.push({
    type: 'CHARGE_ORDER',
    vehicle: incomingVehicle.name,
    charger: chargerName,
    orderName: makeOrderName('CHARGE', incomingVehicle.name),
  })

  return actions
}

/**
 * Resolves the occupant of a charger from vehicle and order state.
 * Returns null if no robot is physically at the charger.
 */
export function resolveChargerOccupant(
  chargerName: string,
  vehicles: Vehicle[],
  orders: TransportOrder[]
): { vehicle: Vehicle; order: TransportOrder | null } | null {
  // Find vehicle whose active charge order destination matches this charger
  for (const vehicle of vehicles) {
    if (vehicle.state !== 'CHARGING') continue
    if (!vehicle.transportOrder) continue

    const order = orders.find((o) => o.name === vehicle.transportOrder)
    if (!order) continue

    const isAtThisCharger = order.destinations.some(
      (d) => d.operation === 'CHARGE' && d.locationName === chargerName
    )

    if (isAtThisCharger) {
      return { vehicle, order }
    }
  }

  return null
}
