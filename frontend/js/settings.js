/**
 * SIGN BOT - Settings & System Health
 */

let lastHealthHash = null;

/**
 * Load system health and configuration
 */
async function loadHealth() {
  const container = document.getElementById('settingsContainer');
  if (!container) {
    return;
  }

  try {
    const data = await window.API.getSystemHealth();

    // Hash comparison
    const newHash = window.Utils.simpleHash(JSON.stringify(data));
    if (newHash === lastHealthHash) {
      return;
    }
    lastHealthHash = newHash;

    container.innerHTML = renderHealthGrid(data);
  } catch (err) {
    container.innerHTML =
      `<div class="settings-grid">` +
      `<div class="settings-card full-width">` +
      `<h3>\u26A0\uFE0F Estado del Sistema</h3>` +
      `<div class="health-grid">${renderHealthItem('API', 'error', 'No disponible')}</div>` +
      `<p style="margin-top: 16px; color: var(--text-secondary); font-size: 13px;">Error: ${err.message}</p>` +
      `</div>` +
      `</div>`;
  }
}

/**
 * Render health status grid
 */
function renderHealthGrid(data) {
  const health = data.services || data.health || {};
  const config = data.config || data.configuration || {};
  const env = data.environment || {};

  // Determine health status for each service
  const dbStatus = getServiceStatus(health.database || health.db);
  const whatsappStatus = getServiceStatus(health.whatsapp);
  const docusignStatus = getServiceStatus(health.docusign);
  const redisStatus = getServiceStatus(health.redis || health.cache);

  const overallStatus =
    data.status ||
    (dbStatus.state === 'healthy' && whatsappStatus.state === 'healthy' ? 'healthy' : 'degraded');

  return (
    `<div class="settings-grid">` +
    // Health status card
    `<div class="settings-card full-width">` +
    `<h3>${overallStatus === 'healthy' ? '\u2705' : '\u26A0\uFE0F'} Estado del Sistema</h3>` +
    `<div class="health-grid">${renderHealthItem(
      'Base de Datos',
      dbStatus.state,
      dbStatus.message
    )}${renderHealthItem(
      'WhatsApp',
      whatsappStatus.state,
      whatsappStatus.message
    )}${renderHealthItem(
      'DocuSign',
      docusignStatus.state,
      docusignStatus.message
    )}${renderHealthItem('Redis / Cache', redisStatus.state, redisStatus.message)}</div>` +
    `</div>` +
    // Configuration card
    `<div class="settings-card">` +
    `<h3>\u2699\uFE0F Configuracion</h3>${renderConfigTable(config)}</div>` +
    // Environment card
    `<div class="settings-card">` +
    `<h3>\uD83C\uDF0D Ambiente</h3>${renderEnvironmentTable(env)}</div>` +
    `</div>`
  );
}

/**
 * Get service status object from health data
 */
function getServiceStatus(service) {
  if (!service) {
    return { state: 'unknown', message: 'Sin informacion' };
  }

  if (typeof service === 'string') {
    if (service === 'ok' || service === 'healthy' || service === 'connected') {
      return { state: 'healthy', message: 'Operativo' };
    }
    if (service === 'warning' || service === 'degraded') {
      return { state: 'warning', message: 'Degradado' };
    }
    return { state: 'error', message: service };
  }

  if (typeof service === 'object') {
    const status = service.status || service.state || service.estado;
    if (status === 'ok' || status === 'healthy' || status === 'connected' || status === true) {
      return { state: 'healthy', message: service.message || service.mensaje || 'Operativo' };
    }
    if (status === 'warning' || status === 'degraded') {
      return { state: 'warning', message: service.message || service.mensaje || 'Degradado' };
    }
    if (status === false || status === 'error' || status === 'disconnected') {
      return { state: 'error', message: service.message || service.mensaje || 'Error' };
    }
    return { state: 'unknown', message: service.message || service.mensaje || 'Desconocido' };
  }

  return { state: 'unknown', message: 'Sin informacion' };
}

/**
 * Render a single health item
 */
function renderHealthItem(label, state, message) {
  return (
    '<div class="health-item">' +
    `<div class="health-dot ${state}"></div>` +
    '<div class="health-info">' +
    `<div class="health-label">${label}</div>` +
    `<div class="health-status">${window.Utils.escapeHtml(message)}</div>` +
    '</div>' +
    '</div>'
  );
}

/**
 * Render configuration table
 */
function renderConfigTable(config) {
  if (!config || Object.keys(config).length === 0) {
    return '<p style="color: var(--text-muted); font-size: 13px;">Sin informacion de configuracion</p>';
  }

  const displayLabels = {
    horasRecordatorio: 'Horas entre Recordatorios',
    maxRecordatorios: 'Max. Recordatorios',
    diasHousekeeping: 'Dias de Housekeeping',
    timeoutSesion: 'Timeout de Sesion',
    idioma: 'Idioma',
    zonaHoraria: 'Zona Horaria',
    maxReintentos: 'Max. Reintentos',
    intervaloReintento: 'Intervalo de Reintento',
  };

  let rows = '';
  Object.entries(config).forEach(([key, value]) => {
    // Skip sensitive values
    if (
      key.toLowerCase().includes('secret') ||
      key.toLowerCase().includes('password') ||
      key.toLowerCase().includes('key') ||
      key.toLowerCase().includes('token')
    ) {
      return;
    }
    const label = displayLabels[key] || key;
    const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
    rows += `<tr><td>${window.Utils.escapeHtml(label)}</td><td>${window.Utils.escapeHtml(displayValue)}</td></tr>`;
  });

  if (!rows) {
    return '<p style="color: var(--text-muted); font-size: 13px;">Sin configuracion publica disponible</p>';
  }

  return `<table class="config-table">${rows}</table>`;
}

/**
 * Render environment info table
 */
function renderEnvironmentTable(env) {
  const clientEnv = window.CONFIG.ENVIRONMENT;
  const apiBase = window.CONFIG.API_BASE;

  let rows =
    `<tr><td>Ambiente (Cliente)</td><td>${clientEnv.toUpperCase()}</td></tr>` +
    `<tr><td>API Base URL</td><td>${window.Utils.escapeHtml(apiBase)}</td></tr>`;

  if (env && typeof env === 'object') {
    Object.entries(env).forEach(([key, value]) => {
      if (
        key.toLowerCase().includes('secret') ||
        key.toLowerCase().includes('password') ||
        key.toLowerCase().includes('key') ||
        key.toLowerCase().includes('token')
      ) {
        return;
      }
      rows += `<tr><td>${window.Utils.escapeHtml(key)}</td><td>${window.Utils.escapeHtml(String(value))}</td></tr>`;
    });
  }

  return `<table class="config-table">${rows}</table>`;
}

// Export for use in other modules
window.Settings = {
  loadHealth,
};
