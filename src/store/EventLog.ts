import { v4 as uuidv4 } from 'uuid'

export type LogLevel = 'info' | 'warn' | 'error'

export interface EventLogEntry {
  id: string
  timestamp: string       // ISO 8601
  level: LogLevel
  vehicle?: string
  charger?: string
  rule: string            // e.g. 'CRITICAL_RULE', 'PREEMPTION', 'GOOD_OPPORTUNISTIC'
  action: string          // e.g. 'CHARGE_ORDER_ISSUED', 'ROBOT_DISABLED'
  detail: string          // human-readable description
}

export interface EventLogFilter {
  vehicle?: string
  charger?: string
  level?: LogLevel
  limit?: number
}

const MAX_ENTRIES = 500

class EventLog {
  private entries: EventLogEntry[] = []

  add(entry: Omit<EventLogEntry, 'id' | 'timestamp'>): EventLogEntry {
    const full: EventLogEntry = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      ...entry,
    }

    this.entries.unshift(full) // newest first

    // Trim to circular buffer size
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.length = MAX_ENTRIES
    }

    return full
  }

  query(filter: EventLogFilter = {}): EventLogEntry[] {
    let result = this.entries

    if (filter.vehicle) {
      result = result.filter((e) => e.vehicle === filter.vehicle)
    }

    if (filter.charger) {
      result = result.filter((e) => e.charger === filter.charger)
    }

    if (filter.level) {
      result = result.filter((e) => e.level === filter.level)
    }

    if (filter.limit && filter.limit > 0) {
      result = result.slice(0, filter.limit)
    }

    return result
  }

  /**
   * Returns true if a specific action was logged for a vehicle within the last
   * `windowMs` milliseconds. Used for idempotency checks in the engine.
   */
  hasRecentAction(vehicle: string, action: string, windowMs: number): boolean {
    const cutoff = Date.now() - windowMs
    return this.entries.some(
      (e) =>
        e.vehicle === vehicle &&
        e.action === action &&
        new Date(e.timestamp).getTime() >= cutoff
    )
  }

  hasRecentChargerAction(charger: string, action: string, windowMs: number): boolean {
    const cutoff = Date.now() - windowMs
    return this.entries.some(
      (e) =>
        e.charger === charger &&
        e.action === action &&
        new Date(e.timestamp).getTime() >= cutoff
    )
  }

  clear(): void {
    this.entries = []
  }

  get size(): number {
    return this.entries.length
  }
}

// Singleton instance
const eventLog = new EventLog()

export function getEventLog(): EventLog {
  return eventLog
}

export { EventLog }
