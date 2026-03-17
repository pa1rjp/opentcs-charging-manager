import { Router, Request, Response } from 'express'
import { getEventLog, LogLevel } from '../../store/EventLog'

const router = Router()

export function handleGetLogs(req: Request, res: Response): void {
  const { vehicle, charger, level, limit } = req.query

  const filter = {
    vehicle: typeof vehicle === 'string' ? vehicle : undefined,
    charger: typeof charger === 'string' ? charger : undefined,
    level: typeof level === 'string' ? (level as LogLevel) : undefined,
    limit: limit !== undefined ? parseInt(String(limit), 10) : 100,
  }

  const entries = getEventLog().query(filter)
  res.json(entries)
}

router.get('/', handleGetLogs)

export default router
