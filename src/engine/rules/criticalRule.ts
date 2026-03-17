/**
 * Rule 1 — Critical
 *
 * Applies when: battery <= critical threshold (default 30%)
 *
 * Sub-cases (evaluated in order):
 *   2a. No active task, charger free          → disable robot, issue charge order
 *   2b. Task in progress (drop leg)           → queue charge after current task, disable robot
 *   2c. Charger occupied by Good/Sufficient   → preempt occupant (park it), issue charge order
 *   2d. Charger occupied by Critical          → queue and wait at safe hold
 */

import { Vehicle, TransportOrder } from '../../opentcs/types'
import {
  Action,
  RuleContext,
  ChargeGroup,
  getChargeGroup,
  makeOrderName,
} from '../types'

function getBestCharger(
  vehicle: Vehicle,
  context: RuleContext
): { name: string; locationName: string } | null {
  const preferred = context.config.vehicles.find(
    (v) => v.name === vehicle.name
  )?.preferredCharger

  // Try preferred charger first (if free)
  if (preferred) {
    const occ = context.chargers.find((c) => c.name === preferred)
    if (occ && !occ.occupied && !occ.enRouteBy) return { name: occ.name, locationName: occ.locationName }
  }

  // Try any free charger
  const free = context.chargers.find((c) => !c.occupied && !c.enRouteBy)
  if (free) return { name: free.name, locationName: free.locationName }

  return null
}

function getOccupantGroup(chargerName: string, context: RuleContext): ChargeGroup | null {
  const occ = context.chargers.find((c) => c.name === chargerName)
  if (!occ?.occupiedBy) return null
  const occupant = context.vehicles.find((v) => v.name === occ.occupiedBy)
  if (!occupant) return null
  return getChargeGroup(occupant.energyLevel, context.config.thresholds)
}

function hasActiveTask(vehicle: Vehicle, orders: TransportOrder[]): TransportOrder | null {
  if (!vehicle.transportOrder) return null
  const order = orders.find((o) => o.name === vehicle.transportOrder)
  if (!order) return null
  if (order.state === 'BEING_PROCESSED' || order.state === 'ACTIVE' || order.state === 'DISPATCHABLE') {
    // Check if it's NOT already a charge order
    const isCharge = order.destinations.some((d) => d.operation === 'CHARGE')
    if (!isCharge) return order
  }
  return null
}

export async function evaluate(vehicle: Vehicle, context: RuleContext): Promise<Action[]> {
  const { config, orders } = context
  const actions: Action[] = []

  // Only applies to Critical-level robots
  if (vehicle.energyLevel > config.thresholds.critical) {
    return []
  }

  // Re-enable check: if robot is disabled and battery crossed 50%, handled by re-enable rule
  // Critical rule only acts on robots needing a charge

  const activeTask = hasActiveTask(vehicle, orders)
  const freeCharger = getBestCharger(vehicle, context)

  // ── 2b: Task in progress ────────────────────────────────────────────────────
  if (activeTask) {
    // Do NOT withdraw current task — robot is on a drop leg
    // Disable the robot so dispatcher won't assign new tasks after this one
    actions.push({ type: 'DISABLE_ROBOT', vehicle: vehicle.name })
    // Issue a charge order now — dispatcher will queue it after current task completes
    if (freeCharger) {
      actions.push({
        type: 'CHARGE_ORDER',
        vehicle: vehicle.name,
        charger: freeCharger.name,
        orderName: makeOrderName('CHARGE', vehicle.name),
      })
    }
    return actions
  }

  // ── 2a: No active task, charger free ────────────────────────────────────────
  if (freeCharger) {
    actions.push({ type: 'DISABLE_ROBOT', vehicle: vehicle.name })
    actions.push({
      type: 'CHARGE_ORDER',
      vehicle: vehicle.name,
      charger: freeCharger.name,
      orderName: makeOrderName('CHARGE', vehicle.name),
    })
    return actions
  }

  // ── Charger is occupied — determine occupant's group ────────────────────────
  // Try preferred charger, then any charger
  const preferredChargerName =
    context.config.vehicles.find((v) => v.name === vehicle.name)?.preferredCharger ??
    context.chargers[0]?.name

  if (!preferredChargerName) return []

  const occupantGroup = getOccupantGroup(preferredChargerName, context)

  // ── 2c: Charger occupied by Good or Sufficient robot ────────────────────────
  if (occupantGroup === 'GOOD' || occupantGroup === 'SUFFICIENT') {
    const occ = context.chargers.find((c) => c.name === preferredChargerName)
    if (occ?.occupiedBy) {
      const occupantVehicle = context.vehicles.find((v) => v.name === occ.occupiedBy)
      const occupantOrder = occupantVehicle?.transportOrder
        ? orders.find((o) => o.name === occupantVehicle.transportOrder)
        : null

      const parkingPoint =
        context.config.vehicles.find((v) => v.name === occ.occupiedBy)?.preferredParkingPoint ??
        'ParkingPoint-0001'

      // Withdraw occupant's charge order
      if (occupantOrder) {
        actions.push({
          type: 'WITHDRAW_ORDER',
          vehicle: occ.occupiedBy,
          orderName: occupantOrder.name,
          immediate: true,
        })
      }

      // Park the occupant
      actions.push({
        type: 'PARK_ORDER',
        vehicle: occ.occupiedBy,
        parkingPoint,
        orderName: makeOrderName('PARK', occ.occupiedBy),
      })

      // Disable critical robot and issue charge order
      actions.push({ type: 'DISABLE_ROBOT', vehicle: vehicle.name })
      actions.push({
        type: 'CHARGE_ORDER',
        vehicle: vehicle.name,
        charger: preferredChargerName,
        orderName: makeOrderName('CHARGE', vehicle.name),
      })
    }
    return actions
  }

  // ── 2d: Charger occupied by another Critical robot ───────────────────────────
  // Queue and wait — do not preempt another Critical robot
  actions.push({ type: 'DISABLE_ROBOT', vehicle: vehicle.name })
  actions.push({
    type: 'NO_ACTION',
    vehicle: vehicle.name,
    reason: 'Charger occupied by Critical robot — queued and waiting',
  })

  return actions
}
