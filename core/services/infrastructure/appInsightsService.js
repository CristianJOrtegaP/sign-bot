/**
 * Sign Bot - Application Insights Integration
 * Inicializa el SDK y exporta cliente para custom tracking
 *
 * FASE 10/10: Observabilidad real con Azure Application Insights
 *
 * Features:
 * - Auto-collection de requests, dependencies, exceptions
 * - Custom metrics y eventos
 * - Distributed tracing con W3C correlation
 * - Live Metrics Stream
 */

let appInsights = null;
let client = null;
let isInitialized = false;

/**
 * Inicializa Application Insights
 * DEBE llamarse antes de cualquier otro require en el entry point
 * @returns {boolean} - true si se inicializó correctamente
 */
function initialize() {
  if (isInitialized) {
    return true;
  }

  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;

  if (!connectionString) {
    console.log(
      '[AppInsights] APPLICATIONINSIGHTS_CONNECTION_STRING no configurado - telemetria deshabilitada'
    );
    return false;
  }

  try {
    // Lazy load para evitar overhead si no está configurado
    appInsights = require('applicationinsights');

    appInsights
      .setup(connectionString)
      .setAutoCollectRequests(true)
      .setAutoCollectPerformance(true, true)
      .setAutoCollectExceptions(true)
      .setAutoCollectDependencies(true) // SQL, HTTP calls
      .setAutoCollectConsole(true, true) // console.log -> traces
      .setAutoDependencyCorrelation(true)
      .setSendLiveMetrics(true) // Live Metrics Stream
      .setDistributedTracingMode(appInsights.DistributedTracingModes.AI_AND_W3C)
      .start();

    client = appInsights.defaultClient;
    isInitialized = true;

    // Agregar propiedades globales
    client.context.tags[client.context.keys.cloudRole] = 'signbot';
    client.context.tags[client.context.keys.cloudRoleInstance] =
      process.env.WEBSITE_INSTANCE_ID || 'local';

    console.log('[AppInsights] Inicializado correctamente');

    // Registrar graceful shutdown handlers
    try {
      const gracefulShutdown = require('../../utils/gracefulShutdown');
      gracefulShutdown.setupSignalHandlers();
      gracefulShutdown.registerCommonHandlers();
      console.log('[AppInsights] Graceful shutdown configurado');
    } catch (shutdownError) {
      console.warn('[AppInsights] No se pudo configurar graceful shutdown:', shutdownError.message);
    }

    return true;
  } catch (error) {
    console.error('[AppInsights] Error inicializando:', error.message);
    return false;
  }
}

/**
 * Registra una metrica custom
 * @param {string} name - Nombre de la métrica
 * @param {number} value - Valor numérico
 * @param {Object} properties - Propiedades adicionales
 */
function trackMetric(name, value, properties = {}) {
  if (!client) {
    return;
  }

  client.trackMetric({
    name,
    value,
    properties: {
      environment: process.env.NODE_ENV || 'development',
      ...properties,
    },
  });
}

/**
 * Registra un evento custom
 * @param {string} name - Nombre del evento
 * @param {Object} properties - Propiedades del evento
 * @param {Object} measurements - Mediciones numéricas
 */
function trackEvent(name, properties = {}, measurements = {}) {
  if (!client) {
    return;
  }

  client.trackEvent({
    name,
    properties: {
      environment: process.env.NODE_ENV || 'development',
      ...properties,
    },
    measurements,
  });
}

/**
 * Registra una excepcion
 * @param {Error} error - Error a registrar
 * @param {Object} properties - Contexto adicional
 */
function trackException(error, properties = {}) {
  if (!client) {
    return;
  }

  client.trackException({
    exception: error,
    properties: {
      environment: process.env.NODE_ENV || 'development',
      ...properties,
    },
  });
}

/**
 * Registra una traza con severidad
 * @param {string} message - Mensaje de la traza
 * @param {string} severity - Nivel: Verbose, Information, Warning, Error, Critical
 * @param {Object} properties - Propiedades adicionales
 */
function trackTrace(message, severity = 'Information', properties = {}) {
  if (!client) {
    return;
  }

  const severityLevel =
    {
      Verbose: 0,
      Information: 1,
      Warning: 2,
      Error: 3,
      Critical: 4,
    }[severity] ?? 1;

  client.trackTrace({
    message,
    severity: severityLevel,
    properties: {
      environment: process.env.NODE_ENV || 'development',
      ...properties,
    },
  });
}

/**
 * Registra una dependencia (llamada externa)
 * @param {string} name - Nombre de la dependencia
 * @param {string} target - Target (URL, server, etc.)
 * @param {number} duration - Duración en ms
 * @param {boolean} success - Si fue exitosa
 * @param {string|number} resultCode - Código de resultado
 * @param {string} type - Tipo: HTTP, SQL, Redis, etc.
 */
function trackDependency(name, target, duration, success, resultCode, type = 'HTTP') {
  if (!client) {
    return;
  }

  client.trackDependency({
    name,
    target,
    duration,
    success,
    resultCode: String(resultCode),
    dependencyTypeName: type,
  });
}

/**
 * Registra una request custom
 * @param {string} name - Nombre de la request
 * @param {string} url - URL
 * @param {number} duration - Duración en ms
 * @param {string|number} resultCode - Código HTTP
 * @param {boolean} success - Si fue exitosa
 */
function trackRequest(name, url, duration, resultCode, success) {
  if (!client) {
    return;
  }

  client.trackRequest({
    name,
    url,
    duration,
    resultCode: String(resultCode),
    success,
  });
}

/**
 * Flush manual (para Azure Functions que terminan rápido)
 * @returns {Promise<void>}
 */
async function flush() {
  if (!client) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    client.flush({
      callback: () => resolve(),
    });
  });
}

/**
 * Obtiene el cliente de Application Insights
 * @returns {Object|null}
 */
function getClient() {
  return client;
}

/**
 * Verifica si Application Insights está inicializado
 * @returns {boolean}
 */
function getIsInitialized() {
  return isInitialized;
}

/**
 * Crea un contexto de operación para tracing
 * @param {string} operationId - ID de la operación (correlation ID)
 * @param {string} operationName - Nombre de la operación
 */
function setOperationContext(operationId, operationName) {
  if (!client) {
    return;
  }

  client.context.tags[client.context.keys.operationId] = operationId;
  client.context.tags[client.context.keys.operationName] = operationName;
}

/**
 * Reset para tests (solo usar en tests)
 */
function _resetForTests() {
  client = null;
  isInitialized = false;
  appInsights = null;
}

module.exports = {
  initialize,
  trackMetric,
  trackEvent,
  trackException,
  trackTrace,
  trackDependency,
  trackRequest,
  flush,
  getClient,
  isInitialized: getIsInitialized,
  setOperationContext,
  _resetForTests,
};
