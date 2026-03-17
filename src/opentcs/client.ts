import axios, { AxiosInstance, AxiosError } from 'axios'
import {
  Vehicle,
  TransportOrder,
  CreateTransportOrderBody,
  WithdrawalBody,
  IntegrationLevelBody,
  IntegrationLevel,
} from './types'
import * as EP from './endpoints'

const MAX_RETRIES = 1

function isAxiosError(err: unknown): err is AxiosError {
  return axios.isAxiosError(err)
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (isAxiosError(err)) {
      // Retry once on network/5xx errors
      const status = err.response?.status
      if (!status || status >= 500) {
        return await fn()
      }
    }
    throw err
  }
}

class OpenTCSClient {
  private http: AxiosInstance

  constructor(baseURL: string) {
    this.http = axios.create({
      baseURL,
      timeout: 8000,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // ─── Vehicles ───────────────────────────────────────────────────────────────

  async getAllVehicles(): Promise<Vehicle[]> {
    return withRetry(async () => {
      const res = await this.http.get<Vehicle[]>(EP.VEHICLES)
      return res.data
    })
  }

  async getVehicle(vehicleName: string): Promise<Vehicle> {
    return withRetry(async () => {
      const res = await this.http.get<Vehicle>(EP.VEHICLE(vehicleName))
      return res.data
    })
  }

  async setIntegrationLevel(
    vehicleName: string,
    level: IntegrationLevel
  ): Promise<void> {
    const body: IntegrationLevelBody = { value: level }
    return withRetry(async () => {
      await this.http.put(EP.VEHICLE_INTEGRATION_LEVEL(vehicleName), body)
    })
  }

  // ─── Transport Orders ───────────────────────────────────────────────────────

  async getAllTransportOrders(): Promise<TransportOrder[]> {
    return withRetry(async () => {
      const res = await this.http.get<TransportOrder[]>(EP.TRANSPORT_ORDERS)
      return res.data
    })
  }

  async getTransportOrder(orderName: string): Promise<TransportOrder> {
    return withRetry(async () => {
      const res = await this.http.get<TransportOrder>(EP.TRANSPORT_ORDER(orderName))
      return res.data
    })
  }

  async createTransportOrder(body: CreateTransportOrderBody): Promise<TransportOrder> {
    return withRetry(async () => {
      const res = await this.http.post<TransportOrder>(EP.CREATE_TRANSPORT_ORDER, body)
      return res.data
    })
  }

  async withdrawTransportOrder(orderName: string): Promise<void> {
    return withRetry(async () => {
      await this.http.delete(EP.WITHDRAW_TRANSPORT_ORDER(orderName))
    })
  }

  async forceWithdrawTransportOrder(
    orderName: string,
    immediate = true
  ): Promise<void> {
    const body: WithdrawalBody = { immediate }
    return withRetry(async () => {
      await this.http.post(EP.FORCE_WITHDRAW_TRANSPORT_ORDER(orderName), body)
    })
  }

  // ─── Dispatcher ─────────────────────────────────────────────────────────────

  async triggerVehicleDispatcher(): Promise<void> {
    return withRetry(async () => {
      await this.http.post(EP.VEHICLES_DISPATCHER_TRIGGER)
    })
  }

  async triggerOrderDispatcher(): Promise<void> {
    return withRetry(async () => {
      await this.http.post(EP.ORDERS_DISPATCHER_TRIGGER)
    })
  }
}

// Singleton instance — initialised on first call to getClient()
let instance: OpenTCSClient | null = null

export function getClient(): OpenTCSClient {
  if (!instance) {
    const baseURL = process.env.OPENTCS_BASE_URL ?? 'http://localhost:55200/v1'
    instance = new OpenTCSClient(baseURL)
  }
  return instance
}

export { OpenTCSClient }
