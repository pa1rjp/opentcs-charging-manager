import 'dotenv/config'
import express from 'express'
import path from 'path'
import apiRouter from './api/router'
import { errorHandler, notFound } from './api/middleware/errorHandler'
import { getChargingEngine } from './engine/ChargingEngine'
import { getConfigStore } from './store/ConfigStore'

const PORT = parseInt(process.env.PORT ?? '3500', 10)

const app = express()

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json())

// ─── Static UI ────────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'ui')))

// ─── API Routes ───────────────────────────────────────────────────────────────

app.use('/api', apiRouter)

// ─── SPA fallback for UI routes ───────────────────────────────────────────────

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'ui', 'index.html'))
})

// ─── Error Handling ───────────────────────────────────────────────────────────

app.use(notFound)
app.use(errorHandler)

// ─── Start ────────────────────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.info(`[Server] listening on http://localhost:${PORT}`)

  const config = getConfigStore().get()
  if (config.engineEnabled) {
    getChargingEngine().start()
    console.info(`[Server] ChargingEngine started (poll every ${config.pollIntervalMs}ms)`)
  } else {
    console.info('[Server] ChargingEngine is disabled in config — not started')
  }
})

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown(signal: string): void {
  console.info(`[Server] received ${signal} — shutting down gracefully`)
  getChargingEngine().stop()
  server.close(() => {
    console.info('[Server] HTTP server closed')
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

export { app }
