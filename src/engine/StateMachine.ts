/**
 * Per-robot charging state machine.
 * Tracks the engine's view of each vehicle across poll cycles.
 */

import { Action } from './types'

export type EngineState =
  | 'IDLE'
  | 'CHARGE_ORDERED'
  | 'CHARGING'
  | 'PARK_ORDERED'
  | 'PARKED'
  | 'WAITING_FOR_CHARGER'
  | 'TASK_IN_PROGRESS'
  | 'DISABLED_WAITING'

export interface VehicleEngineState {
  vehicleName: string
  engineState: EngineState
  lastAction: string | null
  lastActionAt: string | null
  disabled: boolean
  currentCharger: string | null
}

export class StateMachine {
  private states = new Map<string, VehicleEngineState>()

  getOrInit(vehicleName: string): VehicleEngineState {
    if (!this.states.has(vehicleName)) {
      this.states.set(vehicleName, {
        vehicleName,
        engineState: 'IDLE',
        lastAction: null,
        lastActionAt: null,
        disabled: false,
        currentCharger: null,
      })
    }
    return this.states.get(vehicleName)!
  }

  applyAction(vehicleName: string, action: Action): void {
    const state = this.getOrInit(vehicleName)
    const now = new Date().toISOString()

    switch (action.type) {
      case 'CHARGE_ORDER':
        state.engineState = 'CHARGE_ORDERED'
        state.lastAction = 'CHARGE_ORDER_ISSUED'
        state.lastActionAt = now
        state.currentCharger = action.charger
        break

      case 'PARK_ORDER':
        state.engineState = 'PARK_ORDERED'
        state.lastAction = 'PARK_ORDER_ISSUED'
        state.lastActionAt = now
        state.currentCharger = null
        break

      case 'WITHDRAW_ORDER':
        state.engineState = 'IDLE'
        state.lastAction = 'ORDER_WITHDRAWN'
        state.lastActionAt = now
        break

      case 'DISABLE_ROBOT':
        state.disabled = true
        state.engineState = 'DISABLED_WAITING'
        state.lastAction = 'ROBOT_DISABLED'
        state.lastActionAt = now
        break

      case 'ENABLE_ROBOT':
        state.disabled = false
        state.engineState = 'IDLE'
        state.lastAction = 'ROBOT_ENABLED'
        state.lastActionAt = now
        break

      case 'NO_ACTION':
        // No state change — preserve current state
        break
    }
  }

  syncFromOpenTCS(vehicleName: string, openTCSState: string, charger: string | null): void {
    const state = this.getOrInit(vehicleName)

    if (openTCSState === 'CHARGING') {
      state.engineState = 'CHARGING'
      if (charger) state.currentCharger = charger
    } else if (openTCSState === 'IDLE' && state.engineState === 'CHARGING') {
      state.engineState = 'IDLE'
      state.currentCharger = null
    }
  }

  getAll(): VehicleEngineState[] {
    return Array.from(this.states.values())
  }

  get(vehicleName: string): VehicleEngineState | undefined {
    return this.states.get(vehicleName)
  }
}
