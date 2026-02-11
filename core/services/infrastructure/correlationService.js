/**
 * Sign Bot - Correlation Service
 * Genera y propaga correlation IDs para tracing distribuido
 *
 * Cada request recibe un ID único que se propaga a través de todos los logs
 * permitiendo rastrear una conversación completa de principio a fin.
 */

const crypto = require('crypto');

// AsyncLocalStorage para mantener el context sin pasarlo explícitamente
const { AsyncLocalStorage } = require('async_hooks');
const asyncLocalStorage = new AsyncLocalStorage();

/**
 * Genera un nuevo correlation ID único
 * Formato: fecha-random (YYYYMMDD-HHMMSS-XXXXX)
 * @returns {string}
 */
function generateCorrelationId() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = now.toISOString().slice(11, 19).replace(/:/g, '');
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${date}-${time}-${random}`;
}

/**
 * Genera un short correlation ID (para cuando no se necesita la fecha)
 * @returns {string}
 */
function generateShortId() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

/**
 * Obtiene el correlation ID actual del contexto
 * @returns {string|null}
 */
function getCorrelationId() {
  const store = asyncLocalStorage.getStore();
  return store?.correlationId || null;
}

/**
 * Obtiene todo el contexto actual
 * @returns {Object}
 */
function getContext() {
  return asyncLocalStorage.getStore() || {};
}

/**
 * Ejecuta una función con un nuevo contexto de correlation
 * @param {Function} fn - Función a ejecutar
 * @param {Object} initialContext - Contexto inicial opcional
 * @returns {Promise<any>}
 */
async function runWithCorrelation(fn, initialContext = {}) {
  const correlationId = initialContext.correlationId || generateCorrelationId();
  const context = {
    correlationId,
    startTime: Date.now(),
    ...initialContext,
  };

  return asyncLocalStorage.run(context, fn);
}

/**
 * Añade datos al contexto actual
 * @param {Object} data - Datos a añadir
 */
function addToContext(data) {
  const store = asyncLocalStorage.getStore();
  if (store) {
    Object.assign(store, data);
  }
}

/**
 * Crea un contexto para una request HTTP entrante
 * @param {Object} req - Request de Azure Functions
 * @returns {Object} - Contexto inicial
 */
function createContextFromRequest(req) {
  // Intentar obtener correlation ID de headers (si viene de otro servicio)
  const existingCorrelationId =
    req.headers?.['x-correlation-id'] || req.headers?.['x-request-id'] || req.query?.correlationId;

  // Extraer información útil del request
  const messageId = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id;
  const from = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;

  return {
    correlationId: existingCorrelationId || generateCorrelationId(),
    messageId,
    from,
    method: req.method,
    route: req.url || req.originalUrl,
  };
}

/**
 * Middleware para Azure Functions que añade correlation ID
 * @param {Function} handler - Handler de la función
 * @returns {Function} - Handler wrapeado
 */
function withCorrelation(handler) {
  return async function (context, req) {
    const initialContext = createContextFromRequest(req);

    return runWithCorrelation(async () => {
      // Añadir correlation ID a los logs de Azure
      const originalLog = context.log.bind(context);
      const correlationId = getCorrelationId();

      // Wrap context.log para incluir correlation ID
      context.log = function (...args) {
        originalLog(`[${correlationId}]`, ...args);
      };
      context.log.error = function (...args) {
        originalLog.error(`[${correlationId}]`, ...args);
      };
      context.log.warn = function (...args) {
        originalLog.warn(`[${correlationId}]`, ...args);
      };
      context.log.info = function (...args) {
        originalLog.info(`[${correlationId}]`, ...args);
      };

      // Almacenar referencia al correlation ID en el context de Azure
      context.correlationId = correlationId;

      // Ejecutar handler original
      const result = await handler(context, req);

      // Añadir correlation ID a la respuesta si hay una
      if (context.res && context.res.headers) {
        context.res.headers['x-correlation-id'] = correlationId;
      }

      return result;
    }, initialContext);
  };
}

/**
 * Formatea un mensaje de log con correlation ID
 * @param {string} message - Mensaje base
 * @param {Object} data - Datos adicionales
 * @returns {Object} - Objeto formateado para logging
 */
function formatLogMessage(message, data = {}) {
  const correlationId = getCorrelationId();
  const context = getContext();

  return {
    message,
    correlationId,
    timestamp: new Date().toISOString(),
    ...data,
    // Incluir contexto relevante si existe
    ...(context.from && { from: context.from }),
    ...(context.messageId && { messageId: context.messageId }),
  };
}

/**
 * Obtiene la duración desde el inicio del contexto
 * @returns {number|null} - Milisegundos transcurridos
 */
function getElapsedMs() {
  const context = getContext();
  if (context.startTime) {
    return Date.now() - context.startTime;
  }
  return null;
}

module.exports = {
  generateCorrelationId,
  generateShortId,
  getCorrelationId,
  getContext,
  runWithCorrelation,
  addToContext,
  createContextFromRequest,
  withCorrelation,
  formatLogMessage,
  getElapsedMs,
};
