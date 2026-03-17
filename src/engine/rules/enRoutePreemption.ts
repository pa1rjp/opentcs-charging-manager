/**
 * Rule 0 — En-Route Preemption
 *
 * Evaluated FIRST, before any per-robot rules.
 * Operates across all vehicles simultaneously.
 *
 * A robot en route to a charger (charge order BEING_PROCESSED, state = EXECUTING)
 * can be displaced by a robot that just became free (IDLE, needs charge) if the
 * newly free robot has a stronger claim:
 *   - Lower charge group (Critical > Good > Sufficient > Full), OR
 *   - Same group but lower battery %
 *
 * Returns actions for ALL vehicles affected in this cycle.
 */

import { Vehicle, TransportOrder } from '../../opentcs/types'
import {
  Action,
  RuleContext,
  ChargeGroup,
  getChargeGroup,
  hasHigherGroupPriority,
  GROUP_PRIORITY,
  makeOrderName,
} from '../types'

interface EnRouteRobot {
  vehicle: Vehicle
  chargeOrder: TransportOrder
  chargerLocation: string
  group: ChargeGroup
}

interface FreeRobot {
  vehicle: Vehicle
  group: ChargeGroup
}

function isChargeOrder(order: TransportOrder): boolean {
  return order.destinations.some((d) => d.operation === 'CHARGE')
}

function isEnRoute(vehicle: Vehicle, order: TransportOrder): boolean {
  // Has a charge order that is being processed but NOT yet physically charging
  return (
    order.state === 'BEING_PROCESSED' &&
    vehicle.state === 'EXECUTING' &&
    vehicle.processingState === 'PROCESSING_ORDER'
  )
}

function isJustFree(vehicle: Vehicle): boolean {
  return (
    vehicle.state === 'IDLE' &&
    vehicle.processingState === 'IDLE' &&
    vehicle.transportOrder === null
  )
}

export async function evaluate(context: RuleContext): Promise<Action[]> {
  const { vehicles, orders, config } = context
  const actions: Action[] = []

  // Build lookup: orderName → order
  const orderMap = new Map<string, TransportOrder>(orders.map((o) => [o.name, o]))

  // Find all robots currently en route to a charger
  const enRouteRobots: EnRouteRobot[] = []
  for (const vehicle of vehicles) {
    if (!vehicle.transportOrder) continue
    const order = orderMap.get(vehicle.transportOrder)
    if (!order || !isChargeOrder(order)) continue
    if (!isEnRoute(vehicle, order)) continue

    const group = getChargeGroup(vehicle.energyLevel, config.thresholds)
    const chargerLocation = order.destinations.find((d) => d.operation === 'CHARGE')?.locationName
    if (!chargerLocation) continue

    enRouteRobots.push({ vehicle, chargeOrder: order, chargerLocation, group })
  }

  if (enRouteRobots.length === 0) return []

  // Find all robots that just became free and need charging
  const freeRobots: FreeRobot[] = []
  for (const vehicle of vehicles) {
    if (!isJustFree(vehicle)) continue
    const group = getChargeGroup(vehicle.energyLevel, config.thresholds)
    // Only care about robots that need a charge (not NONE or FULL without charging)
    if (group === 'NONE') continue
    freeRobots.push({ vehicle, group })
  }

  if (freeRobots.length === 0) return []

  // Track which chargers have already been claimed this cycle (avoid double-assign)
  const claimedChargers = new Set<string>()
  // Track which en-route robots have already been preempted this cycle
  const preemptedVehicles = new Set<string>()

  // Sort free robots by priority: lower group wins, then lower battery %
  const sortedFree = [...freeRobots].sort((a, b) => {
    const gDiff = GROUP_PRIORITY[a.group] - GROUP_PRIORITY[b.group]
    if (gDiff !== 0) return gDiff
    return a.vehicle.energyLevel - b.vehicle.energyLevel
  })

  // Sort en-route robots: process them so the weakest claim is displaced first
  const sortedEnRoute = [...enRouteRobots].sort((a, b) => {
    const gDiff = GROUP_PRIORITY[b.group] - GROUP_PRIORITY[a.group] // weakest first
    if (gDiff !== 0) return gDiff
    return b.vehicle.energyLevel - a.vehicle.energyLevel // highest % first (weakest claim)
  })

  for (const free of sortedFree) {
    for (const enRoute of sortedEnRoute) {
      if (preemptedVehicles.has(enRoute.vehicle.name)) continue
      if (claimedChargers.has(enRoute.chargerLocation)) continue

      const freeGroup = free.group
      const enRouteGroup = enRoute.group

      // Determine if free robot wins the charger
      let freeWins = false

      if (hasHigherGroupPriority(freeGroup, enRouteGroup)) {
        // Cross-group: lower group always beats higher group
        freeWins = true
      } else if (freeGroup === enRouteGroup) {
        // Same group: lower battery % wins
        freeWins = free.vehicle.energyLevel < enRoute.vehicle.energyLevel
      }
      // Higher group trying to preempt lower group → never wins

      if (!freeWins) continue

      // Free robot wins — preempt the en-route robot
      const charger = context.chargers.find(
        (c) => c.locationName === enRoute.chargerLocation
      )
      const parkingPoint =
        config.vehicles.find((v) => v.name === enRoute.vehicle.name)?.preferredParkingPoint ??
        'ParkingPoint-0001'

      // 1. Withdraw en-route robot's charge order
      actions.push({
        type: 'WITHDRAW_ORDER',
        vehicle: enRoute.vehicle.name,
        orderName: enRoute.chargeOrder.name,
        immediate: false,
      })

      // 2. Park the displaced en-route robot
      actions.push({
        type: 'PARK_ORDER',
        vehicle: enRoute.vehicle.name,
        parkingPoint,
        orderName: makeOrderName('PARK', enRoute.vehicle.name),
      })

      // 3. Issue charge order to the free robot
      const chargerName = charger?.name ?? enRoute.chargerLocation
      actions.push({
        type: 'CHARGE_ORDER',
        vehicle: free.vehicle.name,
        charger: chargerName,
        orderName: makeOrderName('CHARGE', free.vehicle.name),
      })

      // 4. Disable free robot if it is Critical
      if (freeGroup === 'CRITICAL') {
        actions.push({ type: 'DISABLE_ROBOT', vehicle: free.vehicle.name })
      }

      claimedChargers.add(enRoute.chargerLocation)
      preemptedVehicles.add(enRoute.vehicle.name)
      break // this free robot has been assigned — move to next
    }
  }

  return actions
}
