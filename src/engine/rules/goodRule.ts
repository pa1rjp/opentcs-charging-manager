/**
 * Rule 2 — Good (Opportunistic Charging)
 *
 * Applies when: 50% <= battery < 80% (good threshold <= battery < sufficient threshold)
 *
 * Sub-cases:
 *   4a. No tasks in FMS, charger free    → assign charge to lowest-battery robot in 50–80% range
 *   4b. Currently charging, task arrives → withdraw charge order, let dispatcher assign task
 *   4c. Tasks available in FMS           → stay at parking, do not route to charger
 */

import { Vehicle, TransportOrder } from '../../opentcs/types'
import { Action, RuleContext, getChargeGroup, makeOrderName } from '../types'

function hasPendingFMSTasks(orders: TransportOrder[]): boolean {
  // A task is "available in FMS" if it is ACTIVE or DISPATCHABLE and has no assigned vehicle
  return orders.some(
    (o) =>
      (o.state === 'ACTIVE' || o.state === 'DISPATCHABLE') &&
      o.processingVehicle === null &&
      !o.destinations.some((d) => d.operation === 'CHARGE' || d.operation === 'PARK')
  )
}

function isCurrentlyCharging(vehicle: Vehicle, orders: TransportOrder[]): TransportOrder | null {
  if (vehicle.state !== 'CHARGING') return null
  if (!vehicle.transportOrder) return null
  const order = orders.find((o) => o.name === vehicle.transportOrder)
  if (!order) return null
  if (order.destinations.some((d) => d.operation === 'CHARGE')) return order
  return null
}

export async function evaluate(vehicle: Vehicle, context: RuleContext): Promise<Action[]> {
  const { config, orders } = context
  const { thresholds } = config

  // Only applies to Good-level robots (50% <= battery < 80%)
  const group = getChargeGroup(vehicle.energyLevel, thresholds)
  if (group !== 'GOOD') return []

  const actions: Action[] = []
  const fmsTasksAvailable = hasPendingFMSTasks(orders)
  const chargingOrder = isCurrentlyCharging(vehicle, orders)

  // ── 4b: Currently charging but a task is now available ──────────────────────
  if (chargingOrder && fmsTasksAvailable) {
    actions.push({
      type: 'WITHDRAW_ORDER',
      vehicle: vehicle.name,
      orderName: chargingOrder.name,
      immediate: false,
    })
    return actions
  }

  // ── 4c: Tasks available in FMS — stay parked, skip opportunistic charge ──────
  if (fmsTasksAvailable) {
    actions.push({
      type: 'NO_ACTION',
      vehicle: vehicle.name,
      reason: 'FMS tasks available — skipping opportunistic charge',
    })
    return actions
  }

  // ── 4a: No FMS tasks — opportunistic charge if this robot is the lowest in group ──
  // Only assign charge if this vehicle is the lowest-battery idle robot in the Good group
  const goodGroupIdle = context.vehicles.filter((v) => {
    if (v.name === vehicle.name) return true
    if (v.state !== 'IDLE' || v.processingState !== 'IDLE') return false
    return getChargeGroup(v.energyLevel, thresholds) === 'GOOD'
  })

  // Find the lowest battery vehicle in the Good group
  const lowestBattery = goodGroupIdle.reduce((min, v) =>
    v.energyLevel < min.energyLevel ? v : min
  )

  // This vehicle is not the lowest — let the lowest claim the charger
  if (lowestBattery.name !== vehicle.name) {
    return []
  }

  // Check if already charging or has a charge order
  if (vehicle.state === 'CHARGING') return []
  if (chargingOrder) return []

  // Find a free charger
  const preferred = config.vehicles.find((v) => v.name === vehicle.name)?.preferredCharger
  let targetCharger = preferred
    ? context.chargers.find((c) => c.name === preferred && !c.occupied && !c.enRouteBy)
    : undefined

  if (!targetCharger) {
    targetCharger = context.chargers.find((c) => !c.occupied && !c.enRouteBy)
  }

  if (!targetCharger) {
    actions.push({
      type: 'NO_ACTION',
      vehicle: vehicle.name,
      reason: 'No free charger available for opportunistic charge',
    })
    return actions
  }

  actions.push({
    type: 'CHARGE_ORDER',
    vehicle: vehicle.name,
    charger: targetCharger.name,
    orderName: makeOrderName('CHARGE', vehicle.name),
  })

  return actions
}
