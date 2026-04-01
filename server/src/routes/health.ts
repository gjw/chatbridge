import { Router } from 'express'
import { pool } from '../db/pool.js'

const router = Router()

router.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ status: 'ok', db: 'connected' })
  } catch {
    res.status(503).json({ status: 'degraded', db: 'disconnected' })
  }
})

export { router as healthRouter }
