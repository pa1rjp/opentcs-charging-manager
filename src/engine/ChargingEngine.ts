/**
 * ChargingEngine — main polling loop and action orchestrator.
 *
 * Cycle order:
 *   1. Fetch all vehicles and transport orders in parallel
 *   2. Resolve charger occupancy
 *   3. Run en-route preemption across all vehicles (Rule 0)
 *   4. Process remaining vehicles in priority order (Critical → Full → Sufficient → Good)
 *   5. Execute all returned actions via openTCS API
 *   6. Log every action to EventLog
 */

import { getClient } from '../opentcs/client'
import { Vehicle, TransportOrder, ChargerOccupancy } from '../opentcs/types'
import { getConfigStore } from '../store/ConfigStore'
import { getEventLog } from '../store/EventLog'
import { AppConfig } from '../config/schema'
import { Action, RuleContext, getChargeGroup, makeOrderName } from './types'
import { StateMachine } from './StateMachine'
import { evaluate as enRoutePreemption } from './rules/enRoutePreemption'
import { evaluate as criticalRule } from './rules/criticalRule'
import { evaluate as goodRule } from './rules/goodRule'
import { evaluate as sufficientRule } from './rules/sufficientRule'
import { evaluate as fullRule } from './rules/fullRule'

const IDEMPOTENCY_WINDOW_MS = 20_000 // 2 poll cycles at default 10s

export class ChargingEngine {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private stateMachine = new StateMachine()

  start(): void {
    if (this.timer) return
    const config = getConfigStore().get()
    if (!config.engineEnabled) {
      console.info('[ChargingEngine] engine disabled in config — not starting')
      return
    }
    console.info(`[ChargingEngine] starting with pollIntervalMs=${config.pollIntervalMs}`)
    this.timer = setInterval(() => void this.cycle(), config.pollIntervalMs)
    void this.cycle() // immediate first cycle
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    console.info('[ChargingEngine] stopped')
  }

  isRunning(): boolean {
    return this.timer !== null
  }

  // Exposed for POST /api/engine/cycle
  async triggerCycle(): Promise<void> {
    await this.cycle()
  }

  async cycle(): Promise<void> {
    if (this.running) return // Prevent overlapping cycles
    this.running = true

    try {
      const client = getClient()
      const config = getConfigStore().get()

      if (!config.engineEnabled) return

      // 1. Fetch vehicles and orders in parallel
      const [vehicles, orders] = await Promise.all([
        client.getAllVehicles(),
        client.getAllTransportOrders(),
      ])

      // 2. Resolve charger occupancy
      const chargers = this.resolveChargerOccupancy(vehicles, orders, config)

      const context: RuleContext = {
        vehicles,
        orders,
        chargers,
        config,
        cycleId: Date.now().toString(),
      }

      // Sync state machine with openTCS reality
      for (const vehicle of vehicles) {
        const chargerAtVehicle = vehicle.state === 'CHARGING'
          ? chargers.find((c) => c.occupiedBy === vehicle.name)?.name ?? null
          : null
        this.stateMachine.syncFromOpenTCS(vehicle.name, vehicle.state, chargerAtVehicle)
      }

      // 3. Run en-route preemption across all vehicles (Rule 0)
      const preemptActions = await enRoutePreemption(context)
      const preemptedVehicles = new Set<string>()
      if (preemptActions.length > 0) {
        await this.executeActions(preemptActions, 'EN_ROUTE_PREEMPTION', config)
        for (const a of preemptActions) {
          preemptedVehicles.add(a.vehicle)
        }
      }

      // 4. Evaluate each vehicle in priority order, skip already-handled vehicles
      const sorted = this.prioritiseVehicles(vehicles, config)

      for (const vehicle of sorted) {
        // Skip vehicles that had en-route preemption actions this cycle
        if (preemptedVehicles.has(vehicle.name)) continue

        // Idempotency: skip if a charge order was already issued recently
        const eventLog = getEventLog()
        if (
          eventLog.hasRecentAction(vehicle.name, 'CHARGE_ORDER_ISSUED', IDEMPOTENCY_WINDOW_MS)
        ) {
          continue
        }

        // Re-enable check: battery crossed 50% and robot is disabled
        if (
          vehicle.energyLevel >= config.thresholds.good &&
          vehicle.integrationLevel === 'TO_BE_RESPECTED'
        ) {
          await this.executeActions(
            [{ type: 'ENABLE_ROBOT', vehicle: vehicle.name }],
            'RE_ENABLE_RULE',
            config
          )
          continue
        }

        const group = getChargeGroup(vehicle.energyLevel, config.thresholds)

        let actions: Action[] = []

        switch (group) {
          case 'CRITICAL':
            actions = await criticalRule(vehicle, context)
            break
          case 'FULL':
            actions = await fullRule(vehicle, context)
            break
          case 'SUFFICIENT':
            actions = await sufficientRule(vehicle, context)
            break
          case 'GOOD':
            actions = await goodRule(vehicle, context)
            break
          case 'NONE':
            // Battery between critical and good — no rule applies
            break
        }

        if (actions.length > 0) {
          await this.executeActions(actions, `${group}_RULE`, config)
        }
      }
    } catch (err) {
      console.error('[ChargingEngine] cycle error:', err)
      getEventLog().add({
        level: 'error',
        rule: 'ENGINE_CYCLE',
        action: 'CYCLE_ERROR',
        detail: err instanceof Error ? err.message : String(err),
      })
    } finally {
      this.running = false
    }
  }

  private async executeActions(
    actions: Action[],
    rule: string,
    config: AppConfig
  ): Promise<void> {
    const client = getClient()
    const eventLog = getEventLog()

    for (const action of actions) {
      try {
        switch (action.type) {
          case 'CHARGE_ORDER': {
            const charger = config.chargers.find((c) => c.name === action.charger)
            await client.createTransportOrder({
              destinations: [
                {
                  locationName: charger?.locationName ?? action.charger,
                  operation: charger?.operation ?? 'CHARGE',
                },
              ],
              intendedVehicle: action.vehicle,
              dispensable: false,
            })
            await client.triggerVehicleDispatcher()
            this.stateMachine.applyAction(action.vehicle, action)
            eventLog.add({
              level: 'info',
              vehicle: action.vehicle,
              charger: action.charger,
              rule,
              action: 'CHARGE_ORDER_ISSUED',
              detail: `Charge order issued to ${action.vehicle} for ${action.charger}`,
            })
            break
          }

          case 'PARK_ORDER': {
            await client.createTransportOrder({
              destinations: [
                {
                  locationName: action.parkingPoint,
                  operation: 'PARK',
                },
              ],
              intendedVehicle: action.vehicle,
              dispensable: true,
            })
            await client.triggerVehicleDispatcher()
            this.stateMachine.applyAction(action.vehicle, action)
            eventLog.add({
              level: 'info',
              vehicle: action.vehicle,
              rule,
              action: 'PARK_ORDER_ISSUED',
              detail: `Park order issued to ${action.vehicle} at ${action.parkingPoint}`,
            })
            break
          }

          case 'WITHDRAW_ORDER': {
            if (action.immediate) {
              await client.forceWithdrawTransportOrder(action.orderName, true)
            } else {
              await client.withdrawTransportOrder(action.orderName)
            }
            this.stateMachine.applyAction(action.vehicle, action)
            eventLog.add({
              level: 'info',
              vehicle: action.vehicle,
              rule,
              action: 'ORDER_WITHDRAWN',
              detail: `Order ${action.orderName} withdrawn from ${action.vehicle} (immediate=${action.immediate})`,
            })
            break
          }

          case 'DISABLE_ROBOT': {
            await client.setIntegrationLevel(action.vehicle, 'TO_BE_RESPECTED')
            this.stateMachine.applyAction(action.vehicle, action)
            eventLog.add({
              level: 'info',
              vehicle: action.vehicle,
              rule,
              action: 'ROBOT_DISABLED',
              detail: `${action.vehicle} set to TO_BE_RESPECTED`,
            })
            break
          }

          case 'ENABLE_ROBOT': {
            await client.setIntegrationLevel(action.vehicle, 'TO_BE_UTILIZED')
            this.stateMachine.applyAction(action.vehicle, action)
            eventLog.add({
              level: 'info',
              vehicle: action.vehicle,
              rule,
              action: 'ROBOT_ENABLED',
              detail: `${action.vehicle} re-enabled (set to TO_BE_UTILIZED)`,
            })
            break
          }

          case 'NO_ACTION': {
            eventLog.add({
              level: 'info',
              vehicle: action.vehicle,
              rule,
              action: 'NO_ACTION',
              detail: action.reason,
            })
            break
          }
        }
      } catch (err) {
        eventLog.add({
          level: 'error',
          vehicle: action.vehicle,
          rule,
          action: 'ACTION_FAILED',
          detail: `Failed to execute ${action.type} for ${action.vehicle}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        })
      }
    }
  }

  private prioritiseVehicles(vehicles: Vehicle[], config: AppConfig): Vehicle[] {
    return [...vehicles].sort((a, b) => {
      const ga = getChargeGroup(a.energyLevel, config.thresholds)
      const gb = getChargeGroup(b.energyLevel, config.thresholds)

      // Critical first
      if (ga === 'CRITICAL' && gb !== 'CRITICAL') return -1
      if (gb === 'CRITICAL' && ga !== 'CRITICAL') return 1

      // Full second (to free chargers)
      if (ga === 'FULL' && gb !== 'FULL') return -1
      if (gb === 'FULL' && ga !== 'FULL') return 1

      // Within same group: lower battery first
      return a.energyLevel - b.energyLevel
    })
  }

  private resolveChargerOccupancy(
    vehicles: Vehicle[],
    orders: TransportOrder[],
    config: AppConfig
  ): ChargerOccupancy[] {
    return config.chargers.map((charger) => {
      // A charger is occupied if a vehicle is physically CHARGING there
      // Source of truth: active order destination matches charger location + vehicle state CHARGING
      let occupiedBy: string | null = null
      let enRouteBy: string | null = null

      for (const vehicle of vehicles) {
        if (!vehicle.transportOrder) continue
        const order = orders.find((o) => o.name === vehicle.transportOrder)
        if (!order) continue

        const isForThisCharger = order.destinations.some(
          (d) => d.operation === 'CHARGE' && d.locationName === charger.locationName
        )
        if (!isForThisCharger) continue

        if (
          vehicle.state === 'CHARGING' &&
          (order.state === 'BEING_PROCESSED' || order.state === 'ACTIVE')
        ) {
          occupiedBy = vehicle.name
        } else if (
          vehicle.state === 'EXECUTING' &&
          order.state === 'BEING_PROCESSED'
        ) {
          enRouteBy = vehicle.name
        }
      }

      return {
        name: charger.name,
        locationName: charger.locationName,
        occupied: occupiedBy !== null,
        occupiedBy,
        enRouteBy,
      }
    })
  }

  getStateMachine(): StateMachine {
    return this.stateMachine
  }

  // Generate a unique order name (exposed for use by manual API routes)
  static makeOrderName(type: 'CHARGE' | 'PARK', vehicleName: string): string {
    return makeOrderName(type, vehicleName)
  }
}

// Singleton
let engineInstance: ChargingEngine | null = null

export function getChargingEngine(): ChargingEngine {
  if (!engineInstance) {
    engineInstance = new ChargingEngine()
  }
  return engineInstance
}
