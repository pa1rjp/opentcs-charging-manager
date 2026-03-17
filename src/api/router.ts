import { Router } from 'express'
import fleetRouter from './routes/fleet'
import configRouter from './routes/config'
import manualRouter from './routes/manual'
import logsRouter from './routes/logs'
import engineRouter from './routes/engine'

const router = Router()

router.use('/fleet', fleetRouter)
router.use('/config', configRouter)
router.use('/manual', manualRouter)
router.use('/logs', logsRouter)
router.use('/engine', engineRouter)

export default router
