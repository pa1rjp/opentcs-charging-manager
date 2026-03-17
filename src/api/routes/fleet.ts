import { Router, Request, Response, NextFunction } from 'express'
import { getClient } from '../../opentcs/client'
import { getChargingEngine } from '../../engine/ChargingEngine'
import { getConfigStore } from '../../store/ConfigStore'
import { getChargeGroup } from '../../engine/types'

const router = Router()

export function handleGetFleet(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  void (async () => {
    try {
      const client = getClient()
      const config = getConfigStore().get()
      const engine = getChargingEngine()
      const stateMachine = engine.getStateMachine()

      const [vehicles, orders] = await Promise.all([
        client.getAllVehicles(),
        client.getAllTransportOrders(),
      ])

      // Resolve charger occupancy
      const chargers = config.chargers.map((charger) => {
        let occupiedBy: string | null = null

        for (const vehicle of vehicles) {
          if (!vehicle.transportOrder) continue
          const order = orders.find((o) => o.name === vehicle.transportOrder)
          if (!order) continue

          const isForThisCharger = order.destinations.some(
            (d) => d.operation === 'CHARGE' && d.locationName === charger.locationName
          )
          if (isForThisCharger && vehicle.state === 'CHARGING') {
            occupiedBy = vehicle.name
            break
          }
        }

        return {
          name: charger.name,
          occupied: occupiedBy !== null,
          occupiedBy,
        }
      })

      // Build vehicle snapshot
      const vehicleSnapshots = vehicles.map((vehicle) => {
        const engineState = stateMachine.get(vehicle.name)
        const chargeGroup = getChargeGroup(vehicle.energyLevel, config.thresholds)

        return {
          name: vehicle.name,
          energyLevel: vehicle.energyLevel,
          chargeState: chargeGroup,
          engineState: engineState?.engineState ?? 'IDLE',
          disabled: vehicle.integrationLevel === 'TO_BE_RESPECTED',
          currentCharger: engineState?.currentCharger ?? null,
          lastAction: engineState?.lastAction ?? null,
          lastActionAt: engineState?.lastActionAt ?? null,
          openTCSState: vehicle.state,
          processingState: vehicle.processingState,
          currentPosition: vehicle.currentPosition,
          transportOrder: vehicle.transportOrder,
        }
      })

      res.json({
        timestamp: new Date().toISOString(),
        engineRunning: engine.isRunning(),
        vehicles: vehicleSnapshots,
        chargers,
      })
    } catch (err) {
      next(err)
    }
  })()
}

router.get('/', handleGetFleet)

export default router
