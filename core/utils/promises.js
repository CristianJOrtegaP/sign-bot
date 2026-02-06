/**
 * AC FIXBOT - Promise Utilities
 * Utilities para manejo de promesas con timeouts y fallbacks
 */

const { logger } = require('../services/infrastructure/errorHandler');

/**
 * Error personalizado para timeout
 */
class TimeoutError extends Error {
  constructor(operationName, timeoutMs) {
    super(`Operation '${operationName}' timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
    this.operationName = operationName;
    this.timeoutMs = timeoutMs;
    this.isTimeout = true;
  }
}

/**
 * Ejecuta una promesa con timeout
 * Si la promesa no se resuelve en el tiempo especificado, lanza TimeoutError
 *
 * @param {Promise} promise - Promesa a ejecutar
 * @param {number} timeoutMs - Timeout en milisegundos
 * @param {string} operationName - Nombre de la operación para logging (default: 'operation')
 * @returns {Promise<any>} - Resultado de la promesa
 * @throws {TimeoutError} Si la operación excede el timeout
 *
 * @example
 * const result = await withTimeout(
 *   aiService.extractData(text),
 *   3000,
 *   'extractData'
 * );
 */
async function withTimeout(promise, timeoutMs, operationName = 'operation') {
  // Validar parámetros
  if (!promise || typeof promise.then !== 'function') {
    throw new Error('El primer parámetro debe ser una Promise');
  }

  if (typeof timeoutMs !== 'number' || timeoutMs <= 0) {
    throw new Error('timeoutMs debe ser un número positivo');
  }

  return new Promise((resolve, reject) => {
    // Timer de timeout
    const timer = setTimeout(() => {
      const error = new TimeoutError(operationName, timeoutMs);
      logger.warn(`[Timeout] ${operationName} excedió ${timeoutMs}ms`, {
        operationName,
        timeoutMs,
      });
      reject(error);
    }, timeoutMs);

    // Ejecutar promesa original
    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
        return result;
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * Ejecuta una promesa con timeout y valor de fallback
 * Si la promesa falla o excede el timeout, devuelve el valor de fallback
 *
 * IMPORTANTE: NO lanza error, siempre devuelve un resultado (promise original o fallback)
 *
 * @param {Promise} promise - Promesa a ejecutar
 * @param {number} timeoutMs - Timeout en milisegundos
 * @param {any} fallbackValue - Valor a devolver si falla o timeout
 * @param {string} operationName - Nombre de la operación para logging
 * @returns {Promise<any>} - Resultado de la promesa o fallbackValue
 *
 * @example
 * // Si la detección de intención falla o tarda >3s, usar 'REPORTAR_FALLA' por defecto
 * const intent = await withTimeoutAndFallback(
 *   aiService.detectIntent(text),
 *   3000,
 *   { intencion: 'REPORTAR_FALLA', confianza: 0, metodo: 'fallback' },
 *   'detectIntent'
 * );
 */
async function withTimeoutAndFallback(
  promise,
  timeoutMs,
  fallbackValue,
  operationName = 'operation'
) {
  try {
    return await withTimeout(promise, timeoutMs, operationName);
  } catch (error) {
    // Si es timeout o cualquier otro error, devolver fallback
    if (error.isTimeout) {
      logger.warn(`[Timeout] ${operationName} excedió ${timeoutMs}ms, usando fallback`, {
        operationName,
        timeoutMs,
        fallbackValue:
          typeof fallbackValue === 'object' ? JSON.stringify(fallbackValue) : fallbackValue,
      });
    } else {
      logger.error(`[Error] ${operationName} falló, usando fallback`, error, {
        operationName,
        fallbackValue:
          typeof fallbackValue === 'object' ? JSON.stringify(fallbackValue) : fallbackValue,
      });
    }

    return fallbackValue;
  }
}

/**
 * Ejecuta una promesa con timeout y función de fallback
 * Similar a withTimeoutAndFallback pero permite calcular el fallback dinámicamente
 *
 * @param {Promise} promise - Promesa a ejecutar
 * @param {number} timeoutMs - Timeout en milisegundos
 * @param {Function} fallbackFn - Función que devuelve el valor de fallback (puede ser async)
 * @param {string} operationName - Nombre de la operación para logging
 * @returns {Promise<any>} - Resultado de la promesa o resultado de fallbackFn
 *
 * @example
 * const description = await withTimeoutAndFallbackFn(
 *   aiService.extractDescription(text),
 *   4000,
 *   async () => {
 *     // Fallback: extraer con regex simple
 *     return text.substring(0, 100);
 *   },
 *   'extractDescription'
 * );
 */
async function withTimeoutAndFallbackFn(
  promise,
  timeoutMs,
  fallbackFn,
  operationName = 'operation'
) {
  try {
    return await withTimeout(promise, timeoutMs, operationName);
  } catch (error) {
    // Si es timeout o cualquier otro error, ejecutar función de fallback
    if (error.isTimeout) {
      logger.warn(
        `[Timeout] ${operationName} excedió ${timeoutMs}ms, ejecutando fallback function`,
        {
          operationName,
          timeoutMs,
        }
      );
    } else {
      logger.error(`[Error] ${operationName} falló, ejecutando fallback function`, error, {
        operationName,
      });
    }

    // Ejecutar función de fallback (puede ser async)
    return fallbackFn(error);
  }
}

/**
 * Ejecuta múltiples promesas en paralelo con timeout individual
 * Similar a Promise.all pero cada promesa tiene su propio timeout
 *
 * @param {Array<{promise: Promise, timeout: number, name: string}>} operations - Array de operaciones
 * @returns {Promise<Array<any>>} - Array de resultados
 *
 * @example
 * const [intent, extracted] = await allWithTimeout([
 *   { promise: aiService.detectIntent(text), timeout: 3000, name: 'detectIntent' },
 *   { promise: aiService.extractData(text), timeout: 4000, name: 'extractData' }
 * ]);
 */
async function allWithTimeout(operations) {
  const promises = operations.map(({ promise, timeout, name }) =>
    withTimeout(promise, timeout, name)
  );

  return Promise.all(promises);
}

/**
 * Ejecuta múltiples promesas en paralelo con timeout individual y fallbacks
 * Similar a Promise.allSettled pero con timeouts individuales
 *
 * @param {Array<{promise: Promise, timeout: number, fallback: any, name: string}>} operations
 * @returns {Promise<Array<any>>} - Array de resultados (nunca falla)
 *
 * @example
 * const [intent, extracted] = await allWithTimeoutAndFallback([
 *   {
 *     promise: aiService.detectIntent(text),
 *     timeout: 3000,
 *     fallback: { intencion: 'REPORTAR_FALLA', confianza: 0 },
 *     name: 'detectIntent'
 *   },
 *   {
 *     promise: aiService.extractData(text),
 *     timeout: 4000,
 *     fallback: { datos_encontrados: [] },
 *     name: 'extractData'
 *   }
 * ]);
 */
async function allWithTimeoutAndFallback(operations) {
  const promises = operations.map(({ promise, timeout, fallback, name }) =>
    withTimeoutAndFallback(promise, timeout, fallback, name)
  );

  return Promise.all(promises);
}

/**
 * Crea una promesa que se resuelve después de un delay
 * Útil para testing, retry con backoff, o pausas entre operaciones
 *
 * @param {number} ms - Milisegundos a esperar
 * @returns {Promise<void>}
 *
 * @example
 * await sleep(1000); // Espera 1 segundo
 * await delay(500);  // Alias de sleep
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Alias para compatibilidad
const delay = sleep;

module.exports = {
  withTimeout,
  withTimeoutAndFallback,
  withTimeoutAndFallbackFn,
  allWithTimeout,
  allWithTimeoutAndFallback,
  sleep,
  delay, // Alias de sleep para compatibilidad
  TimeoutError,
};
