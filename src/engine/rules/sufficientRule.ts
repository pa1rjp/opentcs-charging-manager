/**
 * Rule 3 — Sufficient
 *
 * Applies when: 80% <= battery < 98% AND state == CHARGING
 *
 * Default: continue charging — no action needed.
 * Exception: if a Critical robot is waiting for this charger → yield (physical preemption
 * is handled by preemption.ts, which criticalRule triggers; this rule just returns NO_ACTION).
 */

import { Vehicle } from '../../opentcs/types'
import { Action, RuleContext, getChargeGroup } from '../types'

export async function evaluate(vehicle: Vehicle, context: RuleContext): Promise<Action[]> {
  const { config } = context

  // Only applies to Sufficient-level robots currently charging
  const group = getChargeGroup(vehicle.energyLevel, config.thresholds)
  if (group !== 'SUFFICIENT') return []
  if (vehicle.state !== 'CHARGING') return []

  // Check if any Critical robot is waiting (disabled, no active order, below critical threshold)
  const criticalWaiting = context.vehicles.some(
    (v) =>
      v.name !== vehicle.name &&
      v.energyLevel <= config.thresholds.critical &&
      v.integrationLevel === 'TO_BE_RESPECTED' &&
      v.state === 'IDLE' &&
      v.transportOrder === null
  )

  if (criticalWaiting) {
    // Physical preemption will be handled by criticalRule + preemption.ts
    // This rule yields — return NO_ACTION to signal awareness
    return [
      {
        type: 'NO_ACTION',
        vehicle: vehicle.name,
        reason: 'Critical robot waiting — yielding charger via preemption rule',
      },
    ]
  }

  // Continue charging — no action needed
  return [
    {
      type: 'NO_ACTION',
      vehicle: vehicle.name,
      reason: 'Sufficient level — continuing to charge',
    },
  ]
}
