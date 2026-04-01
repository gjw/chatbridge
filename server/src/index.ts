import cors from 'cors'
import express from 'express'
import { env } from './env.js'
import { errorHandler } from './middleware/error-handler.js'
import { apiRouter } from './routes/index.js'

const app = express()

app.use(cors({ origin: env.CORS_ORIGIN }))
app.use(express.json())
app.use('/api', apiRouter)
app.use(errorHandler)

const server = app.listen(env.PORT, () => {
  console.info(`[server] listening on :${String(env.PORT)} (${env.NODE_ENV})`)
})

function shutdown() {
  console.info('[server] shutting down...')
  server.close(() => {
    process.exit(0)
  })
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
