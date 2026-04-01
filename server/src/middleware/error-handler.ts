import type { ErrorRequestHandler } from 'express'
import { env } from '../env.js'

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const message = err instanceof Error ? err.message : 'Internal server error'
  const status = typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number'
    ? err.status
    : 500

  if (status >= 500) {
    console.error('[error]', err)
  }

  res.status(status).json({
    error: env.NODE_ENV === 'production' ? 'Internal server error' : message,
  })
}
