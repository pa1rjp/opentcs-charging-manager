import { Router, Request, Response, NextFunction } from 'express'
import { getClient } from '../../opentcs/client'
import { getChargingEngine, ChargingEngine } from '../../engine/ChargingEngine'
import { getConfigStore } from '../../store/ConfigStore'
import { getEventLog } from '../../store/EventLog'
import { ApiError } from '../middleware/errorHandler'

const router = Router()

// ─── Charge ───────────────────────────────────────────────────────────────────

router.post('/charge/:vehicleName', (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    try {
      const { vehicleName } = req.params
      const { chargerName } = req.body as { chargerName?: string }
      const config = getConfigStore().get()
      const client = getClient()

      // Pick charger: explicit > preferred > first available
      const charger =
        config.chargers.find((c) => c.name === chargerName) ??
        config.chargers.find(
          (c) => c.name === config.vehicles.find((v) => v.name === vehicleName)?.preferredCharger
        ) ??
        config.chargers[0]

      if (!charger) {
        const err: ApiError = new Error('No charger available')
        err.statusCode = 400
        return next(err)
      }

      const order = await client.createTransportOrder({
        destinations: [{ locationName: charger.locationName, operation: charger.operation }],
        intendedVehicle: vehicleName,
        dispensable: false,
      })
      await client.triggerVehicleDispatcher()

      getEventLog().add({
        level: 'info',
        vehicle: vehicleName,
        charger: charger.name,
        rule: 'MANUAL',
        action: 'CHARGE_ORDER_ISSUED',
        detail: `Manual charge order issued to ${vehicleName} for ${charger.name}`,
      })

      res.json({ success: true, order })
    } catch (err) {
      next(err)
    }
  })()
})

// ─── Park ─────────────────────────────────────────────────────────────────────

router.post('/park/:vehicleName', (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    try {
      const { vehicleName } = req.params
      const config = getConfigStore().get()
      const client = getClient()

      const parkingPoint =
        config.vehicles.find((v) => v.name === vehicleName)?.preferredParkingPoint ??
        'ParkingPoint-0001'

      const order = await client.createTransportOrder({
        destinations: [{ locationName: parkingPoint, operation: 'PARK' }],
        intendedVehicle: vehicleName,
        dispensable: true,
      })
      await client.triggerVehicleDispatcher()

      getEventLog().add({
        level: 'info',
        vehicle: vehicleName,
        rule: 'MANUAL',
        action: 'PARK_ORDER_ISSUED',
        detail: `Manual park order issued to ${vehicleName} at ${parkingPoint}`,
      })

      res.json({ success: true, order })
    } catch (err) {
      next(err)
    }
  })()
})

// ─── Withdraw ─────────────────────────────────────────────────────────────────

router.post('/withdraw/:vehicleName', (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    try {
      const { vehicleName } = req.params
      const { immediate = false } = req.body as { immediate?: boolean }
      const client = getClient()

      const vehicle = await client.getVehicle(vehicleName)
      if (!vehicle.transportOrder) {
        const err: ApiError = new Error(`${vehicleName} has no active transport order`)
        err.statusCode = 400
        return next(err)
      }

      if (immediate) {
        await client.forceWithdrawTransportOrder(vehicle.transportOrder, true)
      } else {
        await client.withdrawTransportOrder(vehicle.transportOrder)
      }

      getEventLog().add({
        level: 'info',
        vehicle: vehicleName,
        rule: 'MANUAL',
        action: 'ORDER_WITHDRAWN',
        detail: `Manual withdrawal of order ${vehicle.transportOrder} from ${vehicleName} (immediate=${immediate})`,
      })

      res.json({ success: true, orderName: vehicle.transportOrder })
    } catch (err) {
      next(err)
    }
  })()
})

// ─── Enable ───────────────────────────────────────────────────────────────────

router.post('/enable/:vehicleName', (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    try {
      const { vehicleName } = req.params
      await getClient().setIntegrationLevel(vehicleName, 'TO_BE_UTILIZED')
      getEventLog().add({
        level: 'info',
        vehicle: vehicleName,
        rule: 'MANUAL',
        action: 'ROBOT_ENABLED',
        detail: `${vehicleName} manually enabled (TO_BE_UTILIZED)`,
      })
      res.json({ success: true })
    } catch (err) {
      next(err)
    }
  })()
})

// ─── Disable ──────────────────────────────────────────────────────────────────

router.post('/disable/:vehicleName', (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    try {
      const { vehicleName } = req.params
      await getClient().setIntegrationLevel(vehicleName, 'TO_BE_RESPECTED')
      getEventLog().add({
        level: 'info',
        vehicle: vehicleName,
        rule: 'MANUAL',
        action: 'ROBOT_DISABLED',
        detail: `${vehicleName} manually disabled (TO_BE_RESPECTED)`,
      })
      res.json({ success: true })
    } catch (err) {
      next(err)
    }
  })()
})

// ─── Preempt ──────────────────────────────────────────────────────────────────

router.post('/preempt/:chargerName', (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    try {
      const { chargerName } = req.params
      const { forVehicle } = req.body as { forVehicle: string }
      const client = getClient()
      const config = getConfigStore().get()

      if (!forVehicle) {
        const err: ApiError = new Error('forVehicle is required')
        err.statusCode = 400
        return next(err)
      }

      const [vehicles, orders] = await Promise.all([
        client.getAllVehicles(),
        client.getAllTransportOrders(),
      ])

      // Find current charger occupant
      const charger = config.chargers.find((c) => c.name === chargerName)
      if (!charger) {
        const err: ApiError = new Error(`Charger ${chargerName} not found in config`)
        err.statusCode = 404
        return next(err)
      }

      let occupantName: string | null = null
      let occupantOrderName: string | null = null

      for (const vehicle of vehicles) {
        if (vehicle.state !== 'CHARGING' || !vehicle.transportOrder) continue
        const order = orders.find((o) => o.name === vehicle.transportOrder)
        if (!order) continue
        if (order.destinations.some((d) => d.locationName === charger.locationName)) {
          occupantName = vehicle.name
          occupantOrderName = order.name
          break
        }
      }

      if (occupantName && occupantOrderName) {
        await client.forceWithdrawTransportOrder(occupantOrderName, true)
        const parkingPoint =
          config.vehicles.find((v) => v.name === occupantName)?.preferredParkingPoint ??
          'ParkingPoint-0001'
        await client.createTransportOrder({
          destinations: [{ locationName: parkingPoint, operation: 'PARK' }],
          intendedVehicle: occupantName!,
          dispensable: true,
        })
      }

      const order = await client.createTransportOrder({
        destinations: [{ locationName: charger.locationName, operation: charger.operation }],
        intendedVehicle: forVehicle,
        dispensable: false,
      })
      await client.triggerVehicleDispatcher()

      getEventLog().add({
        level: 'warn',
        vehicle: forVehicle,
        charger: chargerName,
        rule: 'MANUAL',
        action: 'PREEMPT_INITIATED',
        detail: `Manual preemption of ${chargerName}: ${occupantName ?? 'none'} displaced, ${forVehicle} assigned`,
      })

      res.json({ success: true, displaced: occupantName, order })
    } catch (err) {
      next(err)
    }
  })()
})

export default router
