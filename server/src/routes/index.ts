import { Router } from 'express'
import { authRouter } from './auth.js'
import { chatRouter } from './chat.js'
import { healthRouter } from './health.js'

const router = Router()

router.use(healthRouter)
router.use('/auth', authRouter)
router.use('/conversations', chatRouter)

export { router as apiRouter }
