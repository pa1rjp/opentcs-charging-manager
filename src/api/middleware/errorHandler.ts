import { Request, Response, NextFunction } from 'express'

export interface ApiError extends Error {
  statusCode?: number
}

export function errorHandler(
  err: ApiError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const status = err.statusCode ?? 500
  const message = err.message ?? 'Internal server error'

  console.error(`[API Error] ${status} — ${message}`, err.stack)

  res.status(status).json({ error: message })
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' })
}
