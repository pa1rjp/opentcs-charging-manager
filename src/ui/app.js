/* ─── State ─────────────────────────────────────────────────────────────────── */
const state = {
  fleet: null,
  logs: [],
  config: null,
  activeTab: 'fleet',
  logFilters: { vehicle: '', level: '', limit: 50 },
  configDirty: false,
  pendingConfig: null,
}

/* ─── Polling ───────────────────────────────────────────────────────────────── */
async function fetchFleet() {
  try {
    const res = await fetch('/api/fleet')
    if (!res.ok) return
    state.fleet = await res.json()
    if (state.activeTab === 'fleet') renderFleet()
    updateEngineBadge()
    updateLastUpdate()
  } catch (_) { /* openTCS may be unreachable — silent */ }
}

async function fetchLogs() {
  try {
    const params = new URLSearchParams()
    if (state.logFilters.vehicle) params.set('vehicle', state.logFilters.vehicle)
    if (state.logFilters.level)   params.set('level',   state.logFilters.level)
    params.set('limit', String(state.logFilters.limit))

    const res = await fetch('/api/logs?' + params.toString())
    if (!res.ok) return
    state.logs = await res.json()
    if (state.activeTab === 'logs') renderLogs()
  } catch (_) { /* silent */ }
}

async function fetchConfig() {
  try {
    const res = await fetch('/api/config')
    if (!res.ok) return
    state.config = await res.json()
    state.pendingConfig = JSON.parse(JSON.stringify(state.config))
    if (state.activeTab === 'config') renderConfig()
  } catch (_) { /* silent */ }
}

function startPolling() {
  fetchFleet()
  fetchLogs()
  setInterval(fetchFleet, 5000)
  setInterval(fetchLogs, 5000)
}

/* ─── Tab Navigation ────────────────────────────────────────────────────────── */
function switchTab(tab) {
  state.activeTab = tab

  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'))
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'))

  document.getElementById('tab-' + tab)?.classList.add('active')
  document.querySelector(`nav button[data-tab="${tab}"]`)?.classList.add('active')

  if (tab === 'fleet')  renderFleet()
  if (tab === 'logs')   { fetchLogs(); renderLogs() }
  if (tab === 'config') { fetchConfig() }
}

/* ─── Fleet Rendering ───────────────────────────────────────────────────────── */
function getBatteryClass(level, thresholds) {
  const t = thresholds ?? { critical: 30, good: 50, sufficient: 80, full: 98 }
  if (level <= t.critical)   return 'critical'
  if (level < t.sufficient)  return 'good'
  if (level < t.full)        return 'sufficient'
  return 'full'
}

function renderFleet() {
  const f = state.fleet
  if (!f) return

  const thresholds = state.config?.thresholds ?? f.vehicles?.[0]
  renderChargers(f.chargers)
  renderVehicleCards(f.vehicles, thresholds)
}

function renderChargers(chargers) {
  const el = document.getElementById('charger-bar')
  if (!el || !chargers) return

  el.innerHTML = chargers.map(c => `
    <div class="charger-slot ${c.occupied ? 'occupied' : 'free'}">
      <div class="charger-dot ${c.occupied ? 'occupied' : 'free'}"></div>
      <div class="charger-info">
        <div class="charger-name">${esc(c.name)}</div>
        <div class="charger-occupant">
          ${c.occupied ? `⚡ ${esc(c.occupiedBy)}` : 'Free'}
        </div>
      </div>
    </div>
  `).join('')
}

function renderVehicleCards(vehicles, thresholds) {
  const el = document.getElementById('fleet-grid')
  if (!el || !vehicles) return

  el.innerHTML = vehicles.map(v => {
    const cls = getBatteryClass(v.energyLevel, thresholds)
    const stateLabel = v.disabled ? 'DISABLED' : v.openTCSState
    return `
    <div class="vehicle-card ${cls}">
      <div class="vehicle-header">
        <span class="vehicle-name">${esc(v.name)}</span>
        <span class="state-badge ${stateLabel}">${esc(stateLabel)}</span>
      </div>

      <div class="battery-row">
        <span class="battery-pct ${cls}">${v.energyLevel}%</span>
        <div class="battery-bar-wrap">
          <div class="battery-bar-bg">
            <div class="battery-bar-fill ${cls}" style="width:${v.energyLevel}%"></div>
          </div>
        </div>
      </div>

      <div class="vehicle-meta">
        <span class="label">Charge state</span>
        <span class="value">${esc(v.chargeState)}</span>
        <span class="label">Engine state</span>
        <span class="value">${esc(v.engineState)}</span>
        <span class="label">Charger</span>
        <span class="value">${v.currentCharger ? esc(v.currentCharger) : '—'}</span>
        <span class="label">Position</span>
        <span class="value">${v.currentPosition ? esc(v.currentPosition) : '—'}</span>
      </div>

      <div class="last-action">
        ${v.lastAction
          ? `<span class="action-code">${esc(v.lastAction)}</span><br><span>${v.lastActionAt ? relTime(v.lastActionAt) : ''}</span>`
          : '<span style="color:var(--text-muted)">No action yet</span>'
        }
      </div>

      <div class="vehicle-actions">
        <button class="btn btn-success btn-sm" onclick="manualCharge('${esc(v.name)}')">⚡ Charge</button>
        <button class="btn btn-ghost btn-sm"   onclick="manualPark('${esc(v.name)}')">🅿 Park</button>
        <button class="btn ${v.disabled ? 'btn-success' : 'btn-warning'} btn-sm"
                onclick="${v.disabled ? `manualEnable('${esc(v.name)}')` : `manualDisable('${esc(v.name)}')`}">
          ${v.disabled ? '✓ Enable' : '⊘ Disable'}
        </button>
        <button class="btn btn-danger btn-sm"  onclick="manualWithdraw('${esc(v.name)}')">✕ Withdraw</button>
      </div>
    </div>`
  }).join('')
}

/* ─── Log Rendering ─────────────────────────────────────────────────────────── */
function renderLogs() {
  const el = document.getElementById('log-tbody')
  if (!el) return

  if (!state.logs.length) {
    el.innerHTML = `<tr><td colspan="7" class="log-empty">No log entries</td></tr>`
    return
  }

  el.innerHTML = state.logs.map(e => `
    <tr>
      <td style="white-space:nowrap">${fmtTime(e.timestamp)}</td>
      <td><span class="log-level-${e.level}">${e.level.toUpperCase()}</span></td>
      <td>${e.vehicle ? esc(e.vehicle) : '—'}</td>
      <td>${esc(e.rule)}</td>
      <td>${esc(e.action)}</td>
      <td>${e.charger ? esc(e.charger) : '—'}</td>
      <td style="color:var(--text-muted)">${esc(e.detail)}</td>
    </tr>
  `).join('')
}

/* ─── Config Rendering ──────────────────────────────────────────────────────── */
function renderConfig() {
  const cfg = state.pendingConfig
  if (!cfg) return

  const t = cfg.thresholds
  setSlider('thresh-critical',  t.critical, '%')
  setSlider('thresh-good',      t.good, '%')
  setSlider('thresh-sufficient',t.sufficient, '%')
  setSlider('thresh-full',      t.full, '%')

  const pollEl = document.getElementById('poll-interval')
  if (pollEl) pollEl.value = cfg.pollIntervalMs

  const enableEl = document.getElementById('engine-enabled')
  if (enableEl) enableEl.checked = cfg.engineEnabled
}

function setSlider(id, value, suffix) {
  const input = document.getElementById(id)
  const display = document.getElementById(id + '-val')
  if (input)   input.value = value
  if (display) display.textContent = value + (suffix ?? '')
}

function onSliderInput(id, key) {
  const input = document.getElementById(id)
  const display = document.getElementById(id + '-val')
  if (!input || !state.pendingConfig) return
  const val = parseInt(input.value, 10)
  if (display) display.textContent = val + '%'
  state.pendingConfig.thresholds[key] = val
  state.configDirty = true
}

async function saveConfig() {
  if (!state.pendingConfig) return
  const msgEl = document.getElementById('config-save-msg')

  // Update pollIntervalMs and engineEnabled from inputs
  const pollEl = document.getElementById('poll-interval')
  const enableEl = document.getElementById('engine-enabled')
  if (pollEl) state.pendingConfig.pollIntervalMs = parseInt(pollEl.value, 10)
  if (enableEl) state.pendingConfig.engineEnabled = enableEl.checked

  try {
    const res = await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.pendingConfig),
    })
    if (!res.ok) {
      const err = await res.json()
      if (msgEl) { msgEl.textContent = '✕ ' + (err.error ?? 'Save failed'); msgEl.className = 'config-save-msg error' }
      return
    }
    state.config = await res.json()
    state.pendingConfig = JSON.parse(JSON.stringify(state.config))
    state.configDirty = false
    if (msgEl) { msgEl.textContent = '✓ Saved'; msgEl.className = 'config-save-msg success' }
    setTimeout(() => { if (msgEl) msgEl.textContent = '' }, 3000)
  } catch (e) {
    if (msgEl) { msgEl.textContent = '✕ Network error'; msgEl.className = 'config-save-msg error' }
  }
}

/* ─── Manual Controls ───────────────────────────────────────────────────────── */
async function apiPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    alert('Error: ' + (err.error ?? res.statusText))
    return null
  }
  return res.json()
}

async function manualCharge(vehicleName) {
  if (!confirm(`Issue charge order to ${vehicleName}?`)) return
  await apiPost(`/api/manual/charge/${encodeURIComponent(vehicleName)}`, {})
  fetchFleet()
}

async function manualPark(vehicleName) {
  if (!confirm(`Issue park order to ${vehicleName}?`)) return
  await apiPost(`/api/manual/park/${encodeURIComponent(vehicleName)}`)
  fetchFleet()
}

async function manualEnable(vehicleName) {
  await apiPost(`/api/manual/enable/${encodeURIComponent(vehicleName)}`)
  fetchFleet()
}

async function manualDisable(vehicleName) {
  if (!confirm(`Disable ${vehicleName}?`)) return
  await apiPost(`/api/manual/disable/${encodeURIComponent(vehicleName)}`)
  fetchFleet()
}

async function manualWithdraw(vehicleName) {
  if (!confirm(`Withdraw current order from ${vehicleName}?`)) return
  await apiPost(`/api/manual/withdraw/${encodeURIComponent(vehicleName)}`, { immediate: false })
  fetchFleet()
}

/* ─── Engine Controls ───────────────────────────────────────────────────────── */
async function enginePause() {
  await apiPost('/api/engine/pause')
  updateEngineBadge()
}
async function engineResume() {
  await apiPost('/api/engine/resume')
  updateEngineBadge()
}
async function engineCycle() {
  const btn = document.getElementById('btn-cycle')
  if (btn) btn.disabled = true
  await apiPost('/api/engine/cycle')
  if (btn) btn.disabled = false
  fetchFleet()
  fetchLogs()
}

/* ─── Header Badge ──────────────────────────────────────────────────────────── */
function updateEngineBadge() {
  const badge = document.getElementById('engine-badge')
  if (!badge || !state.fleet) return
  const running = state.fleet.engineRunning
  badge.textContent = running ? 'ENGINE RUNNING' : 'ENGINE STOPPED'
  badge.className = 'engine-badge ' + (running ? 'running' : 'stopped')
}

function updateLastUpdate() {
  const el = document.getElementById('last-update')
  if (el) el.textContent = 'Updated ' + relTime(new Date().toISOString())
}

/* ─── Log filter handlers ───────────────────────────────────────────────────── */
function onLogVehicleChange(val) {
  state.logFilters.vehicle = val
  fetchLogs()
}
function onLogLevelChange(val) {
  state.logFilters.level = val
  fetchLogs()
}

/* ─── Helpers ───────────────────────────────────────────────────────────────── */
function esc(str) {
  if (str == null) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function relTime(iso) {
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 5)   return 'just now'
  if (diff < 60)  return diff + 's ago'
  if (diff < 3600) return Math.round(diff / 60) + 'm ago'
  return Math.round(diff / 3600) + 'h ago'
}

function fmtTime(iso) {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/* ─── Boot ──────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  switchTab('fleet')
  fetchConfig()
  startPolling()
})
