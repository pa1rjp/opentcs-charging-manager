/**
 * Rule 4 — Full
 *
 * Applies when: battery >= 98% AND state == CHARGING
 *
 * Actions:
 *   1. Withdraw the charge order
 *   2. Issue a parking order to the vehicle's preferred parking point
 */

import { Vehicle, TransportOrder } from '../../opentcs/types'
import { Action, RuleContext, getChargeGroup, makeOrderName } from '../types'

export async function evaluate(vehicle: Vehicle, context: RuleContext): Promise<Action[]> {
  const { config, orders } = context

  // Only applies to Full-level robots that are currently charging
  const group = getChargeGroup(vehicle.energyLevel, config.thresholds)
  if (group !== 'FULL') return []
  if (vehicle.state !== 'CHARGING') return []

  const actions: Action[] = []

  // Find and withdraw the active charge order
  const chargeOrder: TransportOrder | undefined = vehicle.transportOrder
    ? orders.find(
        (o) =>
          o.name === vehicle.transportOrder &&
          o.destinations.some((d) => d.operation === 'CHARGE')
      )
    : undefined

  if (chargeOrder) {
    actions.push({
      type: 'WITHDRAW_ORDER',
      vehicle: vehicle.name,
      orderName: chargeOrder.name,
      immediate: false,
    })
  }

  // Issue a parking order
  const parkingPoint =
    config.vehicles.find((v) => v.name === vehicle.name)?.preferredParkingPoint ??
    'ParkingPoint-0001'

  actions.push({
    type: 'PARK_ORDER',
    vehicle: vehicle.name,
    parkingPoint,
    orderName: makeOrderName('PARK', vehicle.name),
  })

  return actions
}
