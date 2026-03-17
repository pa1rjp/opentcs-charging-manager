// All openTCS REST API endpoint path templates.
// Base URL is provided by the client at call time.

// ─── Vehicles ─────────────────────────────────────────────────────────────────

/** GET  /vehicles — list all vehicles */
export const VEHICLES = '/vehicles'

/** GET  /vehicles/{vehicleName} — get a single vehicle */
export const VEHICLE = (vehicleName: string) => `/vehicles/${encodeURIComponent(vehicleName)}`

/** PUT  /vehicles/{vehicleName}/integrationLevel — set integration level */
export const VEHICLE_INTEGRATION_LEVEL = (vehicleName: string) =>
  `/vehicles/${encodeURIComponent(vehicleName)}/integrationLevel`

// ─── Transport Orders ─────────────────────────────────────────────────────────

/** GET  /transportOrders — list all transport orders */
export const TRANSPORT_ORDERS = '/transportOrders'

/** GET  /transportOrders/{orderName} — get a single order */
export const TRANSPORT_ORDER = (orderName: string) =>
  `/transportOrders/${encodeURIComponent(orderName)}`

/** POST /transportOrders — create a transport order */
export const CREATE_TRANSPORT_ORDER = '/transportOrders'

/** DELETE /transportOrders/{orderName} — regular withdrawal */
export const WITHDRAW_TRANSPORT_ORDER = (orderName: string) =>
  `/transportOrders/${encodeURIComponent(orderName)}`

/** POST /transportOrders/{orderName}/withdrawal — force withdrawal */
export const FORCE_WITHDRAW_TRANSPORT_ORDER = (orderName: string) =>
  `/transportOrders/${encodeURIComponent(orderName)}/withdrawal`

// ─── Dispatcher ───────────────────────────────────────────────────────────────

/** POST /vehicles/dispatcher/trigger — trigger dispatcher for all vehicles */
export const VEHICLES_DISPATCHER_TRIGGER = '/vehicles/dispatcher/trigger'

/** POST /transportOrders/dispatcher/trigger — trigger dispatcher for all orders */
export const ORDERS_DISPATCHER_TRIGGER = '/transportOrders/dispatcher/trigger'
