import { Router, Request, Response, NextFunction } from 'express'
import { getChargingEngine } from '../../engine/ChargingEngine'

const router = Router()

router.post('/pause', (_req: Request, res: Response) => {
  getChargingEngine().stop()
  res.json({ success: true, engineRunning: false })
})

router.post('/resume', (_req: Request, res: Response) => {
  getChargingEngine().start()
  res.json({ success: true, engineRunning: getChargingEngine().isRunning() })
})

router.post('/cycle', (_req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    try {
      await getChargingEngine().triggerCycle()
      res.json({ success: true })
    } catch (err) {
      next(err)
    }
  })()
})

export default router
