import { Vehicle, TransportOrder, ChargerOccupancy } from '../opentcs/types'
import { AppConfig } from '../config/schema'

// ─── Actions ──────────────────────────────────────────────────────────────────
// Rules return Action[] — they never call the openTCS API directly.
// The ChargingEngine orchestrates execution.

export type Action =
  | { type: 'CHARGE_ORDER'; vehicle: string; charger: string; orderName: string }
  | { type: 'PARK_ORDER'; vehicle: string; parkingPoint: string; orderName: string }
  | { type: 'WITHDRAW_ORDER'; vehicle: string; orderName: string; immediate: boolean }
  | { type: 'DISABLE_ROBOT'; vehicle: string }
  | { type: 'ENABLE_ROBOT'; vehicle: string }
  | { type: 'NO_ACTION'; vehicle: string; reason: string }

// ─── Rule Context ─────────────────────────────────────────────────────────────

export interface RuleContext {
  vehicles: Vehicle[]
  orders: TransportOrder[]
  chargers: ChargerOccupancy[]
  config: AppConfig
  /** ISO timestamp of the cycle start — used for order name generation */
  cycleId: string
}

// ─── Charge Groups ────────────────────────────────────────────────────────────

export type ChargeGroup = 'CRITICAL' | 'GOOD' | 'SUFFICIENT' | 'FULL' | 'NONE'

export function getChargeGroup(
  energyLevel: number,
  thresholds: AppConfig['thresholds']
): ChargeGroup {
  if (energyLevel <= thresholds.critical) return 'CRITICAL'
  if (energyLevel < thresholds.good) return 'NONE'       // between critical and good — no rule applies
  if (energyLevel < thresholds.sufficient) return 'GOOD'
  if (energyLevel < thresholds.full) return 'SUFFICIENT'
  return 'FULL'
}

/** Lower number = higher priority */
export const GROUP_PRIORITY: Record<ChargeGroup, number> = {
  CRITICAL: 0,
  GOOD: 1,
  SUFFICIENT: 2,
  FULL: 3,
  NONE: 4,
}

/** Returns true if group A has strictly higher priority than group B */
export function hasHigherGroupPriority(a: ChargeGroup, b: ChargeGroup): boolean {
  return GROUP_PRIORITY[a] < GROUP_PRIORITY[b]
}

// ─── Order Name Generator ─────────────────────────────────────────────────────

export function makeOrderName(
  type: 'CHARGE' | 'PARK',
  vehicleName: string
): string {
  return `${type}-${vehicleName}-${Date.now()}`
}
