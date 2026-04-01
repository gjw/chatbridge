import { Router } from 'express'
import { authRouter } from './auth.js'
import { healthRouter } from './health.js'

const router = Router()

router.use(healthRouter)
router.use('/auth', authRouter)

export { router as apiRouter }
