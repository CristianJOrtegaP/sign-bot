/**
 * Sign Bot - Request Timeout Utilities
 * Utilidades para agregar timeouts a operaciones asíncronas
 *
 * @module utils/requestTimeout
 */

/* global AbortController, fetch */

const { logger } = require('../services/infrastructure/errorHandler');
const { sleep } = require('./promises');

/**
 * Configuración de timeouts por defecto (en ms)
 */
const DEFAULT_TIMEOUTS = {
  whatsapp: parseInt(process.env.WHATSAPP_TIMEOUT_MS || '30000', 10), // 30s
  ai: parseInt(process.env.AI_TIMEOUT_MS || '60000', 10), // 60s
  vision: parseInt(process.env.VISION_TIMEOUT_MS || '30000', 10), // 30s
  database: parseInt(process.env.DB_TIMEOUT_MS || '15000', 10), // 15s
  blob: parseInt(process.env.BLOB_TIMEOUT_MS || '60000', 10), // 60s
  external: parseInt(process.env.EXTERNAL_TIMEOUT_MS || '30000', 10), // 30s default
};

/**
 * Error de timeout personalizado
 */
class TimeoutError extends Error {
  constructor(operation, timeoutMs) {
    super(`Operación '${operation}' excedió el timeout de ${timeoutMs}ms`);
    this.name = 'TimeoutError';
    this.operation = operation;
    this.timeoutMs = timeoutMs;
    this.code = 'ETIMEDOUT';
  }
}

/**
 * Presupuesto de timeout global para una cadena de operaciones.
 * Evita que operaciones tardías arranquen sin tiempo suficiente.
 */
class TimeoutBudget {
  /**
   * @param {number} totalMs - Presupuesto total en ms (default 240000 = 4 min)
   * @param {string} operationId - Identificador para logging
   */
  constructor(totalMs = 240000, operationId = 'unknown') {
    this._startTime = Date.now();
    this._totalMs = totalMs;
    this._operationId = operationId;
  }

  /** Milisegundos restantes del presupuesto */
  remaining() {
    return Math.max(0, this._totalMs - (Date.now() - this._startTime));
  }

  /** Milisegundos transcurridos desde la creación */
  elapsed() {
    return Date.now() - this._startTime;
  }

  /** ¿Se agotó el presupuesto? */
  isExpired() {
    return this.remaining() <= 0;
  }

  /**
   * Retorna el timeout efectivo: el menor entre lo solicitado y lo restante.
   * Retorna 0 si el presupuesto restante es menor que minThresholdMs.
   * @param {number} requestedMs - Timeout deseado para la operación
   * @param {number} minThresholdMs - Mínimo viable para intentar la operación (default 1000)
   * @returns {number} - Timeout a usar, o 0 si no hay tiempo suficiente
   */
  effectiveTimeout(requestedMs, minThresholdMs = 1000) {
    const rem = this.remaining();
    if (rem < minThresholdMs) {
      return 0;
    }
    return Math.min(requestedMs, rem);
  }
}

/**
 * Ejecuta una promesa con timeout
 * @param {Promise} promise - Promesa a ejecutar
 * @param {number} timeoutMs - Timeout en milisegundos
 * @param {string} operation - Nombre de la operación (para logging)
 * @returns {Promise} - Promesa con timeout
 */
function withTimeout(promise, timeoutMs, operation = 'unknown') {
  let timeoutId;

  const timeoutPromise = new Promise((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      const error = new TimeoutError(operation, timeoutMs);
      logger.warn(`[Timeout] ${operation} excedió ${timeoutMs}ms`, { operation, timeoutMs });
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

/**
 * Crea un AbortController con timeout automático
 * Útil para fetch/axios nativo
 * @param {number} timeoutMs - Timeout en milisegundos
 * @returns {{controller: AbortController, clear: Function}}
 */
function createAbortControllerWithTimeout(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return {
    controller,
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId),
  };
}

/**
 * Wrapper para fetch con timeout y retry
 * @param {string} url - URL a llamar
 * @param {Object} options - Opciones de fetch
 * @param {Object} config - Configuración adicional
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, config = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUTS.external,
    operation = 'fetch',
    maxRetries = 0,
    retryDelayMs = 1000,
  } = config;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { signal, clear } = createAbortControllerWithTimeout(timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal,
      });

      clear();

      // Si la respuesta indica que debemos reintentar (503, 429)
      if (response.status === 503 || response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '1', 10) * 1000;
        if (attempt < maxRetries) {
          logger.warn(`[${operation}] Servicio temporalmente no disponible, reintentando`, {
            status: response.status,
            attempt: attempt + 1,
            retryAfter,
          });
          await sleep(Math.min(retryAfter, retryDelayMs * Math.pow(2, attempt)));
          continue;
        }
      }

      return response;
    } catch (error) {
      clear();
      lastError = error;

      // Si es un abort/timeout o error de red, reintentar si quedan intentos
      if (attempt < maxRetries && (error.name === 'AbortError' || error.code === 'ECONNRESET')) {
        logger.warn(`[${operation}] Error de red, reintentando`, {
          error: error.message,
          attempt: attempt + 1,
        });
        await sleep(retryDelayMs * Math.pow(2, attempt));
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

/**
 * Wrapper para cualquier función async con timeout y nombre de operación
 * @param {Function} fn - Función async a ejecutar
 * @param {Object} options - Opciones
 * @returns {Promise}
 */
async function executeWithTimeout(fn, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUTS.external,
    operation = 'operation',
    onTimeout = null,
  } = options;

  try {
    return await withTimeout(fn(), timeoutMs, operation);
  } catch (error) {
    if (error instanceof TimeoutError && onTimeout) {
      return onTimeout(error);
    }
    throw error;
  }
}

/**
 * Crea un wrapper de timeout para un servicio específico
 * @param {string} serviceName - Nombre del servicio
 * @param {number} defaultTimeout - Timeout por defecto
 * @returns {Function} - Función wrapper
 */
function createServiceTimeoutWrapper(serviceName, defaultTimeout = DEFAULT_TIMEOUTS.external) {
  return function (fn, customTimeout) {
    return executeWithTimeout(fn, {
      timeoutMs: customTimeout || defaultTimeout,
      operation: serviceName,
    });
  };
}

// Wrappers pre-configurados para servicios comunes
const timeouts = {
  whatsapp: createServiceTimeoutWrapper('whatsapp', DEFAULT_TIMEOUTS.whatsapp),
  ai: createServiceTimeoutWrapper('ai', DEFAULT_TIMEOUTS.ai),
  vision: createServiceTimeoutWrapper('vision', DEFAULT_TIMEOUTS.vision),
  database: createServiceTimeoutWrapper('database', DEFAULT_TIMEOUTS.database),
  blob: createServiceTimeoutWrapper('blob', DEFAULT_TIMEOUTS.blob),
  external: createServiceTimeoutWrapper('external', DEFAULT_TIMEOUTS.external),
};

module.exports = {
  TimeoutError,
  TimeoutBudget,
  withTimeout,
  createAbortControllerWithTimeout,
  fetchWithTimeout,
  executeWithTimeout,
  createServiceTimeoutWrapper,
  timeouts,
  DEFAULT_TIMEOUTS,
};
