# openTCS Charging Manager — CLAUDE.md

> **Project instruction file for Claude Code + VS Code.**
> Read this entire file before writing any code. All architectural decisions, API contracts, naming conventions, and test requirements are defined here.

---

## Project Overview

A **Node.js microservice** that monitors battery levels of 4 autonomous forklifts managed by openTCS v6.4.0 and automatically executes a custom charging logic that the default openTCS dispatcher does not natively support.

The service:
- Polls the openTCS REST API every configurable interval (default: 10s)
- Evaluates each robot's battery state against the charging logic rules
- Issues transport orders (charge / park) and integration-level changes via the openTCS API
- Exposes its own REST API for manual overrides and config changes
- Serves a web UI for real-time monitoring, configuration, and manual control
- Has a full Jest test suite covering all 27 charging scenarios

---

## Repository Layout

```
opentcs-charging-manager/
├── CLAUDE.md                      ← this file
├── package.json
├── tsconfig.json
├── .env.example
├── jest.config.ts
│
├── src/
│   ├── index.ts                   ← entry point, starts HTTP server + polling engine
│   │
│   ├── config/
│   │   ├── defaults.ts            ← default threshold & fleet config
│   │   └── schema.ts              ← Zod schema for runtime config validation
│   │
│   ├── opentcs/
│   │   ├── client.ts              ← openTCS REST API client (axios-based)
│   │   ├── types.ts               ← TypeScript types mirroring openTCS API models
│   │   └── endpoints.ts           ← all API endpoint strings as constants
│   │
│   ├── engine/
│   │   ├── ChargingEngine.ts      ← main polling loop + state machine orchestrator
│   │   ├── StateMachine.ts        ← per-robot charging state machine
│   │   ├── rules/
│   │   │   ├── enRoutePreemption.ts ← Rule 0: lower battery/group displaces en-route robot
│   │   │   ├── criticalRule.ts    ← Rule: battery ≤ 30%
│   │   │   ├── goodRule.ts        ← Rule: battery 50–80% (opportunistic charge)
│   │   │   ├── sufficientRule.ts  ← Rule: battery 80–98% (continue or yield)
│   │   │   └── fullRule.ts        ← Rule: battery ≥ 98% (park)
│   │   └── preemption.ts          ← physical charger preemption (robot already CHARGING)
│   │
│   ├── api/
│   │   ├── router.ts              ← Express router mounting all route groups
│   │   ├── routes/
│   │   │   ├── fleet.ts           ← GET /api/fleet  — live fleet status
│   │   │   ├── config.ts          ← GET/PUT /api/config  — threshold & fleet config
│   │   │   ├── manual.ts          ← POST /api/manual/*  — manual triggers
│   │   │   └── logs.ts            ← GET /api/logs  — recent engine decision log
│   │   └── middleware/
│   │       └── errorHandler.ts
│   │
│   ├── store/
│   │   ├── ConfigStore.ts         ← persists config to config.json on disk
│   │   └── EventLog.ts            ← in-memory circular buffer (last 500 events)
│   │
│   └── ui/
│       ├── index.html             ← single-page dashboard (vanilla JS, no bundler)
│       ├── app.js                 ← dashboard logic (fetch-based, polling every 5s)
│       └── styles.css
│
└── tests/
    ├── unit/
    │   ├── StateMachine.test.ts
    │   ├── criticalRule.test.ts
    │   ├── goodRule.test.ts
    │   ├── sufficientRule.test.ts
    │   ├── fullRule.test.ts
    │   └── preemption.test.ts
    ├── integration/
    │   ├── ChargingEngine.test.ts  ← all 27 scenarios (mocked openTCS API)
    │   └── api.test.ts             ← REST API integration tests (supertest)
    └── fixtures/
        ├── vehicles.ts             ← mock vehicle payloads
        └── scenarios.ts            ← the 27 test scenario definitions
```

---

## Technology Stack

| Concern | Choice | Reason |
|---|---|---|
| Runtime | Node.js 20 LTS | LTS stability |
| Language | TypeScript 5.x, strict mode | Type safety for API contracts |
| HTTP server | Express 4 | Minimal, well-known |
| HTTP client | Axios | Interceptors for auth/retry |
| Validation | Zod | Runtime schema + TypeScript inference |
| Testing | Jest + ts-jest | Native TS, rich mocking |
| HTTP testing | Supertest | Express integration tests |
| Linting | ESLint + Prettier | Consistent style |
| Config | dotenv + Zod | Validated env vars |

**No frontend framework.** The UI is a single `index.html` with vanilla JS. Keep it simple — it must work without a build step.

---

## Environment Variables

```env
# .env.example
OPENTCS_BASE_URL=http://localhost:55200/v1   # openTCS web API base URL
POLL_INTERVAL_MS=10000                       # battery check interval
PORT=3500                                    # this service's HTTP port
CONFIG_FILE=./config.json                    # path to persisted config
LOG_LEVEL=info                               # debug | info | warn | error
```

---

## Charging Logic — Canonical Rules

These are the rules the engine enforces. **Do not deviate.** If a scenario edge case arises that is not covered, add it to `rules/` as a new rule file and register it in `ChargingEngine.ts`.

### Thresholds

| Level | % | openTCS property |
|---|---|---|
| Critical | 30 | `energyLevel.critical` |
| Good | 50 | `energyLevel.degraded` |
| Sufficiently Recharged | 80 | `energyLevel.sufficientlyRecharged` |
| Full | 98 | `energyLevel.fullyRecharged` |

These values are runtime-configurable via `/api/config`. The engine reads them from `ConfigStore` on every poll cycle — threshold changes take effect on the next cycle.

### Rule Priority (evaluated top-down, first match wins per robot)

```
0. EN-ROUTE PREEMPTION  (evaluated FIRST, across all vehicles simultaneously)
   For every robot that just became free (IDLE, needs charge):
     Compare against all robots with an active charge order still EXECUTING (en route)
     If newly free robot has a stronger claim (lower group OR lower % in same group):
       → Withdraw en-route robot's charge order
       → Issue park order to en-route robot
       → Issue charge order to newly free robot

1. FULL          battery >= 98%  AND  state == CHARGING
   → Withdraw charge order, create parking order

2. CRITICAL      battery <= 30%
   2a. No active task, charger free   → disable robot, issue charge order
   2b. Task in progress (drop leg)    → queue charge order after current task, disable robot
   2c. Charger occupied by Good/Sufficient robot → preempt occupant (park it), issue charge order
   2d. Charger occupied by Critical   → queue and wait at safe hold

3. SUFFICIENT    battery >= 80%  AND  state == CHARGING  AND  no Critical robot waiting
   → Continue charging (no action)
   → IF another robot just became Critical: preempt (rule 2c applies to this robot)

4. GOOD (opportunistic)  50% <= battery < 80%
   4a. No tasks in FMS, charger free  → assign charge to lowest-battery robot in 50–80% range ONLY
   4b. Charging, task arrives          → withdraw charge, assign task
   4c. Tasks available                 → stay at parking, no charge routing

5. RE-ENABLE     battery crosses 50% AND robot is disabled
   → Restore integration level TO_BE_UTILIZED
```

### En-Route Preemption Rule (NEW — evaluated before physical preemption)

A robot holding a charge order but **still travelling** (state = `EXECUTING` on a charge order, not yet `CHARGING`) can be displaced by a robot with a stronger claim to the charger.

**Trigger:** On every poll cycle, the engine detects any robot that:
- Just became free (`state = IDLE`, `processingState = IDLE`, no active transport order), AND
- Needs a charge (battery below any charging threshold)

It then checks whether any other robot is currently **en route** to a charger (has an active charge order, state = `EXECUTING`, not yet `CHARGING`).

**Priority resolution — who wins the charger:**

| En-route robot (A) | Newly free robot (B) | Result |
|---|---|---|
| Same group, A% < B% | — | **A keeps charger.** No action. |
| Same group, A% > B% | — | **B wins.** Withdraw A's charge order → park A → issue charge to B. |
| Higher group (e.g. Good) | Lower group (e.g. Critical) | **B wins.** Group always beats %. |
| Lower group (e.g. Critical) | Higher group (e.g. Good) | **A keeps charger.** Lower group is never displaced by a higher group. |
| Full (98%) | Any robot needing charge | **B wins.** Full robot also gets a park order from the FULL rule simultaneously. |

**Group priority order (lowest = highest priority):**
```
Critical (≤30%) > Good (50–80%) > Sufficient (80–98%) > Full (≥98%)
```

**Within the same group:** lower battery % always wins.

**Example:**
```
Robot A: 30% Critical, charge order issued, travelling to ChargingStation-1
Robot B: 28% Critical, just finished task, now IDLE

→ Engine detects B is free and lower % than A in same group
→ Withdraw Robot A charge order
→ Issue Robot A parking order
→ Issue Robot B charge order to ChargingStation-1
→ Robot A parks; Robot B proceeds to charger
```

**This rule applies identically across all groups:**
- Good group: 60% en route, 52% just freed → 52% wins
- Sufficient group: 88% en route, 82% just freed → 82% wins
- Cross-group: 55% Good en route, 28% Critical just freed → Critical wins always

**En-route preemption does NOT apply when:**
- Robot A is already `CHARGING` (state = `CHARGING`) — use physical preemption rules instead
- Robot B is in a **higher** group than Robot A
- Robot B and A are in the same group but B% ≥ A%
- A preemption for the same vehicle pair was already issued this cycle (debounce)

### Physical Charger Preemption Guard

Once a robot is physically at the charger (`state = CHARGING`):

Before issuing a preempt on the current charger occupant, the engine MUST check:
- Is the charger occupant in a `CHARGING` state (not just en route)?
- Is the charger occupant's battery **above** the Critical threshold?
- Is there NOT already a pending preemption in progress for this charger?

Preemptions are **idempotent** — the engine records the last preemption action per charger in `EventLog` and debounces within the same poll cycle.

---

## openTCS API Reference

Base URL: `OPENTCS_BASE_URL` (e.g. `http://localhost:55200/v1`)

All endpoints used by this service:

### Vehicles

```
GET    /vehicles                              List all vehicles
GET    /vehicles/{vehicleName}                Get one vehicle (energyLevel, state, processingState, currentPosition, transportOrder)
PUT    /vehicles/{vehicleName}/integrationLevel   Set integration level
       Body: { "value": "TO_BE_UTILIZED" | "TO_BE_RESPECTED" | "TO_BE_NOTICED" | "IGNORED" }
```

#### Vehicle JSON shape (key fields only)

```json
{
  "name": "Vehicle-0001",
  "energyLevel": 67,
  "energyLevelCritical": 30,
  "energyLevelGood": 50,
  "energyLevelSufficientlyRecharged": 80,
  "energyLevelFullyRecharged": 98,
  "state": "IDLE | EXECUTING | CHARGING | ERROR | UNAVAILABLE",
  "processingState": "IDLE | AWAITING_ORDER | PROCESSING_ORDER",
  "integrationLevel": "TO_BE_UTILIZED | TO_BE_RESPECTED | TO_BE_NOTICED | IGNORED",
  "currentPosition": "Point-0042",
  "transportOrder": "TOrder-0018"
}
```

### Transport Orders

```
GET    /transportOrders                       List all transport orders
GET    /transportOrders/{orderName}           Get one order
POST   /transportOrders                       Create transport order
DELETE /transportOrders/{orderName}           Withdraw transport order (regular)
POST   /transportOrders/{orderName}/withdrawal  Force-withdraw transport order
       Body: { "immediate": true }
```

#### Create transport order body (charge order)

```json
{
  "destinations": [
    {
      "locationName": "ChargingStation-1",
      "operation": "CHARGE"
    }
  ],
  "intendedVehicle": "Vehicle-0001",
  "dispensable": false
}
```

#### Create transport order body (park order)

```json
{
  "destinations": [
    {
      "locationName": "ParkingPoint-0003",
      "operation": "PARK"
    }
  ],
  "intendedVehicle": "Vehicle-0001",
  "dispensable": true
}
```

### Dispatcher

```
POST   /vehicles/dispatcher/trigger           Trigger dispatcher for all vehicles
POST   /transportOrders/dispatcher/trigger    Trigger dispatcher for all orders
```

---

## Config Store Schema

Stored in `config.json`, validated by Zod on load and on every PUT `/api/config`.

```typescript
// src/config/schema.ts
import { z } from 'zod'

export const ThresholdsSchema = z.object({
  critical:    z.number().int().min(1).max(100),  // default: 30
  good:        z.number().int().min(1).max(100),  // default: 50
  sufficient:  z.number().int().min(1).max(100),  // default: 80
  full:        z.number().int().min(1).max(100),  // default: 98
}).refine(t => t.critical < t.good && t.good < t.sufficient && t.sufficient < t.full, {
  message: 'Thresholds must be strictly ascending: critical < good < sufficient < full'
})

export const ChargerSchema = z.object({
  name:          z.string(),   // openTCS location name
  locationName:  z.string(),   // same as name for most setups
  operation:     z.string().default('CHARGE'),
})

export const VehicleConfigSchema = z.object({
  name:                  z.string(),
  preferredCharger:      z.string().optional(),
  preferredParkingPoint: z.string().optional(),
})

export const AppConfigSchema = z.object({
  thresholds: ThresholdsSchema,
  chargers:   z.array(ChargerSchema).min(1),
  vehicles:   z.array(VehicleConfigSchema).min(1),
  pollIntervalMs: z.number().int().min(1000).default(10000),
  engineEnabled:  z.boolean().default(true),
})

export type AppConfig = z.infer<typeof AppConfigSchema>
```

Default config (used when `config.json` does not exist):

```json
{
  "thresholds": { "critical": 30, "good": 50, "sufficient": 80, "full": 98 },
  "chargers": [
    { "name": "ChargingStation-1", "locationName": "ChargingStation-1", "operation": "CHARGE" },
    { "name": "ChargingStation-2", "locationName": "ChargingStation-2", "operation": "CHARGE" }
  ],
  "vehicles": [
    { "name": "Vehicle-0001", "preferredCharger": "ChargingStation-1", "preferredParkingPoint": "ParkingPoint-0001" },
    { "name": "Vehicle-0002", "preferredCharger": "ChargingStation-1", "preferredParkingPoint": "ParkingPoint-0002" },
    { "name": "Vehicle-0003", "preferredCharger": "ChargingStation-2", "preferredParkingPoint": "ParkingPoint-0003" },
    { "name": "Vehicle-0004", "preferredCharger": "ChargingStation-2", "preferredParkingPoint": "ParkingPoint-0004" }
  ],
  "pollIntervalMs": 10000,
  "engineEnabled": true
}
```

---

## REST API — This Service

All routes are under `/api`. The UI is served from `/`.

### Fleet status

```
GET /api/fleet
```

Returns a snapshot of all vehicle states as computed by the engine on the last poll cycle.

Response:
```json
{
  "timestamp": "2026-03-17T10:22:00.000Z",
  "vehicles": [
    {
      "name": "Vehicle-0001",
      "energyLevel": 45,
      "chargeState": "CRITICAL",
      "engineState": "CHARGING",
      "disabled": true,
      "currentCharger": "ChargingStation-1",
      "lastAction": "CHARGE_ORDER_ISSUED",
      "lastActionAt": "2026-03-17T10:21:50.000Z"
    }
  ],
  "chargers": [
    {
      "name": "ChargingStation-1",
      "occupied": true,
      "occupiedBy": "Vehicle-0001"
    },
    {
      "name": "ChargingStation-2",
      "occupied": false,
      "occupiedBy": null
    }
  ]
}
```

### Config

```
GET  /api/config              Returns current AppConfig
PUT  /api/config              Replaces full config (Zod-validated, saved to disk)
PATCH /api/config/thresholds  Updates only thresholds
```

### Manual triggers

```
POST /api/manual/charge/:vehicleName
     Body: { "chargerName": "ChargingStation-1" }   (optional — picks best if omitted)
     → Immediately creates a charge order for the vehicle

POST /api/manual/park/:vehicleName
     → Immediately creates a parking order for the vehicle

POST /api/manual/withdraw/:vehicleName
     Body: { "immediate": false }
     → Withdraws current transport order from the vehicle

POST /api/manual/enable/:vehicleName
     → Sets integration level to TO_BE_UTILIZED

POST /api/manual/disable/:vehicleName
     → Sets integration level to TO_BE_RESPECTED

POST /api/manual/preempt/:chargerName
     Body: { "forVehicle": "Vehicle-0001" }
     → Forces preemption: parks current charger occupant, assigns to forVehicle

POST /api/engine/pause          → Suspends the polling engine
POST /api/engine/resume         → Resumes the polling engine
POST /api/engine/cycle          → Triggers a single immediate poll cycle (useful for testing)
```

### Event log

```
GET /api/logs?limit=100&vehicle=Vehicle-0001&level=warn
```

Response: array of `EventLogEntry` sorted newest-first.

```typescript
interface EventLogEntry {
  id:         string       // uuid
  timestamp:  string       // ISO 8601
  level:      'info' | 'warn' | 'error'
  vehicle?:   string
  charger?:   string
  rule:       string       // e.g. 'CRITICAL_RULE', 'PREEMPTION', 'GOOD_OPPORTUNISTIC'
  action:     string       // e.g. 'CHARGE_ORDER_ISSUED', 'ROBOT_DISABLED', 'PREEMPT_INITIATED'
  detail:     string       // human-readable description
}
```

---

## ChargingEngine — Implementation Notes

### Polling loop

```typescript
// src/engine/ChargingEngine.ts (pseudocode structure)
class ChargingEngine {
  private interval: NodeJS.Timer | null = null

  start() {
    this.interval = setInterval(() => this.cycle(), config.pollIntervalMs)
  }

  async cycle() {
    const vehicles = await openTCSClient.getAllVehicles()
    const orders   = await openTCSClient.getAllTransportOrders()
    const chargers = this.resolveChargerOccupancy(vehicles, orders)

    // Process in priority order: Critical first, then Full, then Sufficient, then Good
    const sorted = this.prioritiseVehicles(vehicles)
    for (const vehicle of sorted) {
      await this.evaluateVehicle(vehicle, chargers)
    }
  }
}
```

### Vehicle priority sort for each cycle

```
1. CRITICAL (battery <= 30%)   — highest, sorted by battery ASC (lowest first)
2. FULL (battery >= 98%, charging) — process second to free chargers
3. All others                  — sorted by battery ASC
```

### Charger occupancy resolution

Charger occupancy is derived from active transport orders — a charger is "occupied" if any vehicle has a `PROCESSING_ORDER` transport order whose destination is that charger's location. Do NOT rely on vehicle.state === 'CHARGING' alone (state can lag).

### Idempotency

Before issuing any order, the engine checks `EventLog` for a recent action on the same vehicle (within the last 2 poll cycles). If a `CHARGE_ORDER_ISSUED` was logged for `Vehicle-0001` in the last 20 seconds, do not re-issue. This prevents duplicate orders during the latency between API call and openTCS state update.

---

## UI — Dashboard

The UI is split across two HTML files, both served as static files by Express.

### Files

```
src/ui/
├── index.html           ← main dashboard (fleet, logs, config, engine controls)
├── charging-logic.html  ← interactive charging logic reference (pre-built, do not regenerate)
├── app.js               ← dashboard JS (fetch-based, polling every 5s)
└── styles.css           ← dashboard styles
```

### `charging-logic.html` — DO NOT MODIFY

This file is the canonical interactive charging logic reference. It is pre-built and checked in. **Do not regenerate or overwrite it.** It is served at `/charging-logic.html` and linked from the main dashboard as a top-level tab.

It contains:
- Threshold bar (Critical 30% / Good 50% / Sufficient 80% / Full 98%)
- State machine tabs: one per threshold level, each with expandable condition cards showing FMS action + Robot action + flow diagram
- En-route preemption tab: full priority resolution matrix and all cross-group scenarios
- Dark industrial theme (`#0f1117` background, monospace values), no external dependencies

Express static serving (already handles this — no route needed):
```typescript
app.use(express.static(path.join(__dirname, 'ui')))
```

### `index.html` — Main dashboard

Single HTML page served at `/`. Refreshes fleet data every 5 seconds via `fetch('/api/fleet')` and `fetch('/api/logs')`.

#### Top navigation tabs (implement these)

```
[ Fleet ]  [ Engine Log ]  [ Config ]  [ Charging Logic ↗ ]
```

The `Charging Logic` tab is an `<a href="/charging-logic.html" target="_blank">` link — it opens in a new tab, not inline. No iframe needed.

#### Required views

1. **Fleet grid** — 4 cards, one per robot. Each shows:
   - Robot name and battery % with a colour-coded bar (red ≤30, amber 50–80, green ≥80)
   - Current state (IDLE / CHARGING / EXECUTING / DISABLED)
   - Last engine action + timestamp
   - Manual buttons: `Charge`, `Park`, `Disable/Enable`, `Withdraw Order`

2. **Charger status bar** — 2 charger slots showing: Free / Occupied (by whom, at what %)

3. **Engine log** — last 50 events in a scrollable table: timestamp, robot, rule, action, detail

4. **Config panel** (collapsible) — editable threshold sliders + save button
   - Critical %, Good %, Sufficient %, Full %
   - Poll interval (ms)
   - Engine enabled toggle

5. **Engine controls** — Pause / Resume / Force Cycle buttons

Design principles:
- Match `charging-logic.html` colour palette: `#0f1117` background, `#1a1d27` cards, `#e2e4f0` text
- Monospace font (`JetBrains Mono` / `Fira Code` / system monospace) for all numeric values
- No external CSS frameworks, no bundler, no npm in the browser
- Must work at 1280×800 minimum

---

## Tests — All 27 Scenarios

Each scenario from the test log maps to a Jest test. Tests mock the openTCS API client with `jest.mock('../src/opentcs/client')`.

### Test fixture structure

```typescript
// tests/fixtures/scenarios.ts
export interface ChargingScenario {
  id:              string        // e.g. 'C-01'
  description:     string
  vehicles:        MockVehicle[]
  transportOrders: MockOrder[]
  expectedActions: ExpectedAction[]
}

interface ExpectedAction {
  type:    'CHARGE_ORDER' | 'PARK_ORDER' | 'WITHDRAW_ORDER' | 'DISABLE_ROBOT' | 'ENABLE_ROBOT' | 'NO_ACTION'
  vehicle: string
  charger?: string
}
```

### Test coverage requirements

Every scenario **must** have at least:
- A test that asserts the correct `ExpectedAction[]` was issued
- A test that asserts the engine does NOT take the wrong action (negative assertion)
- For preemption scenarios: a test that the preempted robot received a park order

Group the tests by rule file, not by scenario ID:

```
tests/unit/enRoutePreemption.test.ts → NEW scenarios E-01 through E-08 (see below)
tests/unit/criticalRule.test.ts   → C-01 through C-06
tests/unit/goodRule.test.ts       → C-07 through C-11
tests/unit/sufficientRule.test.ts → C-12 through C-15
tests/unit/fullRule.test.ts       → C-16 through C-18
tests/unit/preemption.test.ts     → C-03, C-04, C-05, C-09, C-10, C-13
tests/integration/ChargingEngine.test.ts → C-19 through C-27 (multi-vehicle)
```

### En-Route Preemption Test Scenarios (E-series)

```typescript
// tests/unit/enRoutePreemption.test.ts

describe('E-01: same group, lower % robot frees up while higher % robot is en route', () => {
  // Robot A: 30% Critical, EXECUTING a charge order (en route)
  // Robot B: 28% Critical, just became IDLE (finished task)
  it('withdraws Robot A charge order')
  it('issues park order to Robot A')
  it('issues charge order to Robot B')
})

describe('E-02: same group, higher % robot frees up — no preemption', () => {
  // Robot A: 28% Critical, en route
  // Robot B: 30% Critical, just became IDLE
  it('does NOT withdraw Robot A charge order')
  it('does NOT issue any order to Robot B yet')
})

describe('E-03: cross-group Critical vs Good — Critical wins', () => {
  // Robot A: 55% Good, en route to charger
  // Robot B: 28% Critical, just became IDLE
  it('withdraws Robot A charge order')
  it('issues park order to Robot A')
  it('issues charge order to Robot B with disable')
})

describe('E-04: cross-group Good vs Critical — Critical protected', () => {
  // Robot A: 28% Critical, en route
  // Robot B: 55% Good, just became IDLE
  it('does NOT preempt Robot A (Critical is never displaced by Good)')
  it('queues Robot B for opportunistic charge later')
})

describe('E-05: Good group en-route preemption', () => {
  // Robot A: 72% Good, en route
  // Robot B: 58% Good, just became IDLE
  it('withdraws Robot A charge order')
  it('issues park order to Robot A')
  it('issues charge order to Robot B')
})

describe('E-06: Sufficient group en-route preemption', () => {
  // Robot A: 88% Sufficient, en route
  // Robot B: 82% Sufficient, just became IDLE
  it('withdraws Robot A charge order')
  it('issues park order to Robot A')
  it('issues charge order to Robot B')
})

describe('E-07: Robot A already CHARGING — en-route rule does not apply', () => {
  // Robot A: 30% Critical, state=CHARGING (at charger)
  // Robot B: 28% Critical, just became IDLE
  it('does NOT use en-route preemption rule')
  it('uses physical preemption rule instead — but Critical does not preempt Critical')
  it('Robot B queues and waits')
})

describe('E-08: four-robot scenario — two en route, two free', () => {
  // Robot A: 60% Good, en route
  // Robot B: 85% Sufficient, en route (second charger)
  // Robot C: 28% Critical, just became IDLE
  // Robot D: 55% Good, just became IDLE
  it('Robot C (Critical) wins over Robot A (Good) on charger 1')
  it('Robot D (55% Good) wins over Robot B (85% Sufficient) on charger 2')
  it('Robot A and Robot B both receive park orders')
  it('Robot C and Robot D both receive charge orders')
})
```

### Example test structure

```typescript
// tests/unit/criticalRule.test.ts
describe('criticalRule', () => {
  describe('C-01: battery hits 30%, charger idle, no task', () => {
    it('issues a charge order to the vehicle', async () => { ... })
    it('disables the vehicle (sets TO_BE_RESPECTED)', async () => { ... })
    it('does NOT assign the charge order to a different vehicle', async () => { ... })
  })

  describe('C-02: battery 30%, task in progress (drop leg), charger idle', () => {
    it('does NOT withdraw the current transport order', async () => { ... })
    it('queues a charge order after the current task', async () => { ... })
  })

  describe('C-03: battery 30%, charger occupied by Good-level robot', () => {
    it('withdraws the Good-level robot charge order', async () => { ... })
    it('issues a park order to the Good-level robot', async () => { ... })
    it('issues a charge order to the critical robot', async () => { ... })
  })

  describe('C-04: battery 30%, charger occupied by another Critical robot', () => {
    it('does NOT withdraw the charging critical robot', async () => { ... })
    it('queues the new critical robot and holds it', async () => { ... })
  })
})
```

### Mock vehicle builder

```typescript
// tests/fixtures/vehicles.ts
export function buildVehicle(overrides: Partial<MockVehicle>): MockVehicle {
  return {
    name: 'Vehicle-0001',
    energyLevel: 75,
    state: 'IDLE',
    processingState: 'IDLE',
    integrationLevel: 'TO_BE_UTILIZED',
    currentPosition: 'ParkingPoint-0001',
    transportOrder: null,
    ...overrides,
  }
}

// Usage examples:
buildVehicle({ energyLevel: 28, state: 'IDLE' })           // critical
buildVehicle({ energyLevel: 65, state: 'CHARGING' })       // good, charging
buildVehicle({ energyLevel: 88, state: 'CHARGING' })       // sufficient, charging
buildVehicle({ energyLevel: 98, state: 'CHARGING' })       // full, should park
```

---

## Coding Conventions

- **No `any` types.** If a type is unknown, define it or use `unknown` with a guard.
- **All async functions** must handle errors — wrap API calls in try/catch and log to `EventLog`.
- **Rule files** export a single async function: `evaluate(vehicle, context): Promise<Action[]>`
  - `Action` is a discriminated union of all possible engine actions
  - Rules return `[]` if no action needed — they do NOT call the openTCS API directly
  - The engine orchestrates the actions returned by rules
- **openTCS API calls** go only through `src/opentcs/client.ts` — never call axios directly from rules or engine
- **Config is read-only** inside rules — pass it as a parameter, never import ConfigStore in rule files
- **EventLog** must be written for every action taken, not just errors

### Naming

- Files: `camelCase.ts`
- Classes: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`
- API route handlers: `handle<Method><Resource>` e.g. `handleGetFleet`
- Engine actions: `VERB_NOUN` e.g. `CHARGE_ORDER_ISSUED`, `ROBOT_DISABLED`, `PREEMPT_INITIATED`

---

## Build & Run

```bash
# Install
npm install

# Dev (ts-node with watch)
npm run dev

# Build
npm run build

# Start production
npm start

# Run all tests
npm test

# Run specific test file
npm test -- --testPathPattern=criticalRule

# Run tests with coverage (must be ≥ 90%)
npm run test:coverage

# Lint
npm run lint
```

### package.json scripts

```json
{
  "scripts": {
    "dev":            "ts-node-dev --respawn src/index.ts",
    "build":          "tsc -p tsconfig.json",
    "start":          "node dist/index.js",
    "test":           "jest",
    "test:coverage":  "jest --coverage --coverageThreshold='{\"global\":{\"lines\":90}}'",
    "lint":           "eslint src tests --ext .ts"
  }
}
```

---

## Development Sequence

Build in this exact order. Each phase must be complete and passing before moving to the next.

### Phase 1 — Foundation
1. `package.json` with all dependencies
2. `tsconfig.json` (strict, target ES2022, module CommonJS)
3. `.env.example`
4. `src/config/schema.ts` — Zod schema
5. `src/config/defaults.ts` — default config object
6. `src/opentcs/types.ts` — Vehicle, TransportOrder TypeScript types
7. `src/opentcs/endpoints.ts` — endpoint string constants
8. `src/opentcs/client.ts` — axios client with GET vehicles, GET orders, PUT integration level, POST order, DELETE order, POST withdrawal, POST dispatcher trigger
9. `src/store/ConfigStore.ts`
10. `src/store/EventLog.ts`

### Phase 2 — Engine rules
11. `src/engine/rules/enRoutePreemption.ts`  ← build this FIRST — it wraps all other rules
12. `src/engine/rules/criticalRule.ts`
13. `src/engine/rules/goodRule.ts`
14. `src/engine/rules/sufficientRule.ts`
15. `src/engine/rules/fullRule.ts`
16. `src/engine/preemption.ts`
17. `src/engine/StateMachine.ts`
18. `src/engine/ChargingEngine.ts`

### Phase 3 — API
18. `src/api/middleware/errorHandler.ts`
19. `src/api/routes/fleet.ts`
20. `src/api/routes/config.ts`
21. `src/api/routes/manual.ts`
22. `src/api/routes/logs.ts`
23. `src/api/router.ts`
24. `src/index.ts` — Express app setup, static UI serving, engine start

### Phase 4 — UI
25. `src/ui/charging-logic.html` — **copy the pre-built file, do not regenerate**
26. `src/ui/styles.css`
27. `src/ui/app.js`
28. `src/ui/index.html`

### Phase 5 — Tests
28. `tests/fixtures/vehicles.ts`
29. `tests/fixtures/scenarios.ts`
30. `tests/unit/enRoutePreemption.test.ts`   ← E-01 through E-08
31. All other unit test files (criticalRule, goodRule, sufficientRule, fullRule, preemption)
32. `tests/integration/ChargingEngine.test.ts`
33. `tests/integration/api.test.ts`

---

## Key Constraints

- **Never call `process.exit()`** — errors must be caught and logged
- **Engine cycles must complete in under 5 seconds** total (4 vehicles × API calls must be parallelised where safe)
- **No database** — config is a JSON file, logs are in-memory
- **The UI must work without JavaScript frameworks** — vanilla JS only
- **All openTCS API errors must be retried once** before logging as error
- **Integration level changes are the primary mechanism to disable/enable robots** — do not use transport order states for this

---

## Known openTCS API Behaviours to Handle

1. **Charger occupancy lag**: After issuing a charge order, the vehicle `state` may still show `IDLE` for 1–3 poll cycles. Use transport order state `BEING_PROCESSED` as the source of truth for occupancy.

2. **Order name conflicts**: openTCS rejects orders with duplicate names. Use a timestamp-based name: `CHARGE-{vehicleName}-{Date.now()}`.

3. **Integration level and dispatching**: Setting integration level to `TO_BE_RESPECTED` does NOT immediately withdraw active orders — use the withdrawal endpoint separately if needed.

4. **Dispatcher trigger**: After creating a charge order with `intendedVehicle`, call `POST /vehicles/dispatcher/trigger` to ensure the dispatcher picks it up immediately.

5. **Energy level precision**: openTCS reports energy as an integer 0–100. The engine must handle the exact boundary values (e.g. `energyLevel === 30` is Critical).

---

## Acceptance Criteria

The project is complete when:
- [ ] All 27 test scenarios pass with mocked API
- [ ] Test coverage ≥ 90% lines
- [ ] `npm run lint` reports 0 errors
- [ ] `npm run build` completes without TypeScript errors
- [ ] The UI dashboard renders fleet state, logs, and config without errors
- [ ] Manual charge/park/withdraw/enable/disable APIs respond correctly
- [ ] Engine pause/resume/cycle APIs work
- [ ] Config PUT updates thresholds and engine picks them up on next cycle
- [ ] The service handles openTCS being unreachable (API down) gracefully — logs error, retries next cycle
