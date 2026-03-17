import { Router, Request, Response, NextFunction } from 'express'
import { getConfigStore } from '../../store/ConfigStore'
import { AppConfigSchema, ThresholdsSchema } from '../../config/schema'
import { ApiError } from '../middleware/errorHandler'

const router = Router()

export function handleGetConfig(_req: Request, res: Response): void {
  res.json(getConfigStore().get())
}

export function handlePutConfig(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const result = AppConfigSchema.safeParse(req.body)
    if (!result.success) {
      const err: ApiError = new Error(result.error.message)
      err.statusCode = 400
      return next(err)
    }
    const updated = getConfigStore().set(result.data) ?? result.data
    res.json(updated ?? getConfigStore().get())
  } catch (err) {
    next(err)
  }
}

export function handlePatchThresholds(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const result = ThresholdsSchema.safeParse(req.body)
    if (!result.success) {
      const err: ApiError = new Error(result.error.message)
      err.statusCode = 400
      return next(err)
    }
    const updated = getConfigStore().update({ thresholds: result.data })
    res.json(updated)
  } catch (err) {
    next(err)
  }
}

router.get('/', handleGetConfig)
router.put('/', handlePutConfig)
router.patch('/thresholds', handlePatchThresholds)

export default router
