/**
 * REST API integration tests using supertest.
 */
import request from 'supertest'
import { app } from '../../src/index'
import * as clientModule from '../../src/opentcs/client'
import * as configModule from '../../src/store/ConfigStore'
import * as engineModule from '../../src/engine/ChargingEngine'
import { getEventLog } from '../../src/store/EventLog'
import { buildVehicle } from '../fixtures/vehicles'
import { DEFAULT_CONFIG } from '../fixtures/scenarios'

jest.mock('../../src/opentcs/client')
jest.mock('../../src/store/ConfigStore')
jest.mock('../../src/engine/ChargingEngine')

const mockClient = {
  getAllVehicles: jest.fn().mockResolvedValue([
    buildVehicle({ name: 'Vehicle-0001', energyLevel: 75 }),
    buildVehicle({ name: 'Vehicle-0002', energyLevel: 45 }),
  ]),
  getAllTransportOrders: jest.fn().mockResolvedValue([]),
  getVehicle: jest.fn().mockResolvedValue(buildVehicle({ name: 'Vehicle-0001', transportOrder: 'TOrder-001' })),
  createTransportOrder: jest.fn().mockResolvedValue({ name: 'NEW-001', state: 'ACTIVE', destinations: [], intendedVehicle: null, processingVehicle: null, dispensable: false }),
  withdrawTransportOrder: jest.fn().mockResolvedValue(undefined),
  forceWithdrawTransportOrder: jest.fn().mockResolvedValue(undefined),
  setIntegrationLevel: jest.fn().mockResolvedValue(undefined),
  triggerVehicleDispatcher: jest.fn().mockResolvedValue(undefined),
}

const mockEngine = {
  start: jest.fn(),
  stop: jest.fn(),
  isRunning: jest.fn().mockReturnValue(true),
  triggerCycle: jest.fn().mockResolvedValue(undefined),
  getStateMachine: jest.fn().mockReturnValue({ get: jest.fn().mockReturnValue(null), getAll: jest.fn().mockReturnValue([]) }),
}

beforeEach(() => {
  jest.clearAllMocks()
  getEventLog().clear()
  ;(clientModule.getClient as jest.Mock).mockReturnValue(mockClient)
  ;(configModule.getConfigStore as jest.Mock).mockReturnValue({
    get: () => DEFAULT_CONFIG,
    set: jest.fn(),
    update: jest.fn().mockReturnValue(DEFAULT_CONFIG),
  })
  ;(engineModule.getChargingEngine as jest.Mock).mockReturnValue(mockEngine)
  // Reset mock implementations to defaults
  mockClient.getAllVehicles.mockResolvedValue([
    buildVehicle({ name: 'Vehicle-0001', energyLevel: 75 }),
    buildVehicle({ name: 'Vehicle-0002', energyLevel: 45 }),
  ])
  mockClient.getVehicle.mockResolvedValue(buildVehicle({ name: 'Vehicle-0001', transportOrder: 'TOrder-001' }))
})

// ─── GET /api/fleet ───────────────────────────────────────────────────────────
describe('GET /api/fleet', () => {
  it('returns 200 with fleet snapshot', async () => {
    const res = await request(app).get('/api/fleet')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('vehicles')
    expect(res.body).toHaveProperty('chargers')
    expect(res.body).toHaveProperty('timestamp')
    expect(Array.isArray(res.body.vehicles)).toBe(true)
  })

  it('includes vehicle names in the response', async () => {
    const res = await request(app).get('/api/fleet')
    const names = res.body.vehicles.map((v: { name: string }) => v.name)
    expect(names).toContain('Vehicle-0001')
  })
})

// ─── GET /api/config ──────────────────────────────────────────────────────────
describe('GET /api/config', () => {
  it('returns 200 with current config', async () => {
    const res = await request(app).get('/api/config')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('thresholds')
    expect(res.body.thresholds.critical).toBe(30)
  })
})

// ─── PUT /api/config ──────────────────────────────────────────────────────────
describe('PUT /api/config', () => {
  it('returns 200 when config is valid', async () => {
    ;(configModule.getConfigStore as jest.Mock).mockReturnValue({
      get: () => DEFAULT_CONFIG,
      set: jest.fn(),
      update: jest.fn(),
    })
    const res = await request(app).put('/api/config').send(DEFAULT_CONFIG)
    expect(res.status).toBe(200)
  })

  it('returns 400 when thresholds are out of order', async () => {
    const invalid = { ...DEFAULT_CONFIG, thresholds: { critical: 90, good: 50, sufficient: 80, full: 98 } }
    const res = await request(app).put('/api/config').send(invalid)
    expect(res.status).toBe(400)
  })
})

// ─── PATCH /api/config/thresholds ─────────────────────────────────────────────
describe('PATCH /api/config/thresholds', () => {
  it('returns 200 with valid thresholds', async () => {
    const res = await request(app)
      .patch('/api/config/thresholds')
      .send({ critical: 25, good: 50, sufficient: 80, full: 98 })
    expect(res.status).toBe(200)
  })

  it('returns 400 when thresholds are not ascending', async () => {
    const res = await request(app)
      .patch('/api/config/thresholds')
      .send({ critical: 60, good: 50, sufficient: 80, full: 98 })
    expect(res.status).toBe(400)
  })
})

// ─── POST /api/manual/charge ──────────────────────────────────────────────────
describe('POST /api/manual/charge/:vehicleName', () => {
  it('returns 200 and creates a charge order', async () => {
    const res = await request(app).post('/api/manual/charge/Vehicle-0001').send({})
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(mockClient.createTransportOrder).toHaveBeenCalled()
  })
})

// ─── POST /api/manual/park ────────────────────────────────────────────────────
describe('POST /api/manual/park/:vehicleName', () => {
  it('returns 200 and creates a park order', async () => {
    const res = await request(app).post('/api/manual/park/Vehicle-0001')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(mockClient.createTransportOrder).toHaveBeenCalledWith(
      expect.objectContaining({ destinations: expect.arrayContaining([expect.objectContaining({ operation: 'PARK' })]) })
    )
  })
})

// ─── POST /api/manual/withdraw ────────────────────────────────────────────────
describe('POST /api/manual/withdraw/:vehicleName', () => {
  it('returns 200 and withdraws current order', async () => {
    const res = await request(app).post('/api/manual/withdraw/Vehicle-0001').send({ immediate: false })
    expect(res.status).toBe(200)
    expect(mockClient.withdrawTransportOrder).toHaveBeenCalledWith('TOrder-001')
  })

  it('returns 400 if vehicle has no active order', async () => {
    mockClient.getVehicle.mockResolvedValue(buildVehicle({ name: 'Vehicle-0001', transportOrder: null }))
    const res = await request(app).post('/api/manual/withdraw/Vehicle-0001').send({})
    expect(res.status).toBe(400)
  })
})

// ─── POST /api/manual/enable / disable ───────────────────────────────────────
describe('POST /api/manual/enable/:vehicleName', () => {
  it('sets integration level to TO_BE_UTILIZED', async () => {
    const res = await request(app).post('/api/manual/enable/Vehicle-0001')
    expect(res.status).toBe(200)
    expect(mockClient.setIntegrationLevel).toHaveBeenCalledWith('Vehicle-0001', 'TO_BE_UTILIZED')
  })
})

describe('POST /api/manual/disable/:vehicleName', () => {
  it('sets integration level to TO_BE_RESPECTED', async () => {
    const res = await request(app).post('/api/manual/disable/Vehicle-0001')
    expect(res.status).toBe(200)
    expect(mockClient.setIntegrationLevel).toHaveBeenCalledWith('Vehicle-0001', 'TO_BE_RESPECTED')
  })
})

// ─── GET /api/logs ────────────────────────────────────────────────────────────
describe('GET /api/logs', () => {
  beforeEach(() => {
    getEventLog().add({ level: 'info', vehicle: 'Vehicle-0001', rule: 'CRITICAL_RULE', action: 'CHARGE_ORDER_ISSUED', detail: 'test' })
    getEventLog().add({ level: 'warn', vehicle: 'Vehicle-0002', rule: 'PREEMPTION', action: 'PREEMPT_INITIATED', detail: 'test2' })
  })

  it('returns 200 with log entries', async () => {
    const res = await request(app).get('/api/logs')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThan(0)
  })

  it('filters by vehicle', async () => {
    const res = await request(app).get('/api/logs?vehicle=Vehicle-0001')
    expect(res.body.every((e: { vehicle: string }) => e.vehicle === 'Vehicle-0001')).toBe(true)
  })

  it('filters by level', async () => {
    const res = await request(app).get('/api/logs?level=warn')
    expect(res.body.every((e: { level: string }) => e.level === 'warn')).toBe(true)
  })
})

// ─── Engine controls ──────────────────────────────────────────────────────────
describe('POST /api/engine/pause', () => {
  it('returns 200 and stops the engine', async () => {
    const res = await request(app).post('/api/engine/pause')
    expect(res.status).toBe(200)
    expect(mockEngine.stop).toHaveBeenCalled()
  })
})

describe('POST /api/engine/resume', () => {
  it('returns 200 and starts the engine', async () => {
    const res = await request(app).post('/api/engine/resume')
    expect(res.status).toBe(200)
    expect(mockEngine.start).toHaveBeenCalled()
  })
})

describe('POST /api/engine/cycle', () => {
  it('returns 200 and triggers a cycle', async () => {
    const res = await request(app).post('/api/engine/cycle')
    expect(res.status).toBe(200)
    expect(mockEngine.triggerCycle).toHaveBeenCalled()
  })
})
