import { Router } from 'express'
import { appsRouter } from './apps.js'
import { authRouter } from './auth.js'
import { chatRouter } from './chat.js'
import { healthRouter } from './health.js'
import { safetyRouter } from './safety.js'

const router = Router()

router.use(healthRouter)
router.use('/auth', authRouter)
router.use('/apps', appsRouter)
router.use('/conversations', chatRouter)
router.use('/safety', safetyRouter)

export { router as apiRouter }
