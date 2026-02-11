/**
 * Sign Bot - Retry Utilities
 * Utilities para reintentar operaciones con exponential backoff
 */

const { logger } = require('../services/infrastructure/errorHandler');
const { ConcurrencyError } = require('../errors');
const { sleep } = require('./promises');

/**
 * Implementa exponential backoff con jitter
 * @param {number} attempt - Número de intento (0-based)
 * @param {number} baseDelayMs - Delay base en ms (default: 50ms)
 * @param {number} maxDelayMs - Delay máximo en ms (default: 1000ms)
 * @returns {number} - Delay en ms con jitter aplicado
 */
function calculateBackoffDelay(attempt, baseDelayMs = 50, maxDelayMs = 1000) {
  // Exponential backoff: 2^attempt * baseDelay
  const exponentialDelay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);

  // Jitter: ±25% del delay para evitar thundering herd
  const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1);

  return Math.floor(exponentialDelay + jitter);
}

/**
 * Reintenta una operación con exponential backoff
 * Útil para operaciones que pueden fallar por race conditions (optimistic locking)
 *
 * @param {Function} operation - Función async a ejecutar
 * @param {Object} options - Opciones de retry
 * @param {number} options.maxAttempts - Número máximo de intentos (default: 3)
 * @param {Function} options.shouldRetry - Función que determina si debe reintentar (default: solo ConcurrencyError)
 * @param {Function} options.onRetry - Callback ejecutado antes de cada reintento
 * @param {number} options.baseDelayMs - Delay base en ms (default: 50ms)
 * @param {number} options.maxDelayMs - Delay máximo en ms (default: 1000ms)
 * @param {string} options.operationName - Nombre de la operación para logging (default: 'operation')
 * @returns {Promise<any>} - Resultado de la operación
 * @throws {Error} - Lanza el último error si todos los intentos fallan
 *
 * @example
 * const result = await withRetry(
 *   async () => {
 *     const session = await db.getSessionWithVersion(telefono);
 *     await db.updateSession(telefono, newState, session.Version);
 *   },
 *   {
 *     maxAttempts: 3,
 *     operationName: 'updateSession'
 *   }
 * );
 */
async function withRetry(operation, options = {}) {
  const {
    maxAttempts = 3,
    shouldRetry = (error) => error instanceof ConcurrencyError,
    onRetry = null,
    baseDelayMs = 50,
    maxDelayMs = 1000,
    operationName = 'operation',
  } = options;

  let lastError;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Ejecutar la operación
      return await operation();
    } catch (error) {
      lastError = error;

      // Verificar si debemos reintentar
      const shouldRetryThis = shouldRetry(error);
      const isLastAttempt = attempt === maxAttempts - 1;

      if (!shouldRetryThis || isLastAttempt) {
        // No reintentar o fue el último intento
        logger.warn(`[Retry] ${operationName} failed`, {
          attempt: attempt + 1,
          maxAttempts,
          willRetry: false,
          error: error.message,
        });
        throw error;
      }

      // Calcular delay con backoff
      const delayMs = calculateBackoffDelay(attempt, baseDelayMs, maxDelayMs);

      logger.info(
        `[ConcurrencyRetry] ${operationName} - Intento ${attempt + 1}/${maxAttempts} falló, reintentando en ${delayMs}ms`,
        {
          attempt: attempt + 1,
          maxAttempts,
          delayMs,
          error: error.message,
        }
      );

      // Callback antes de reintentar (opcional)
      if (onRetry) {
        await onRetry(attempt, delayMs, error);
      }

      // Esperar antes de reintentar
      await sleep(delayMs);
    }
  }

  // Esto nunca debería ejecutarse, pero por si acaso
  throw lastError;
}

/**
 * Wrapper específico para operaciones de actualización de sesión con optimistic locking
 * @param {string} telefono - Número de teléfono
 * @param {Function} operation - Función que recibe (session) y ejecuta la actualización
 * @param {Object} options - Opciones adicionales de retry
 * @returns {Promise<any>}
 *
 * @example
 * await withSessionRetry(telefono, async (session) => {
 *   await db.updateSession(telefono, ESTADO.FINALIZADO, null, null, 'BOT', 'Reporte creado', session.Version);
 * });
 */
async function withSessionRetry(telefono, operation, options = {}) {
  const db = require('../services/storage/databaseService');

  return withRetry(
    async () => {
      // Leer sesión con versión
      const session = await db.getSessionWithVersion(telefono);

      // Ejecutar operación con la sesión
      return operation(session);
    },
    {
      ...options,
      operationName: options.operationName || `updateSession(${telefono})`,
      shouldRetry: (error) => error instanceof ConcurrencyError,
    }
  );
}

module.exports = {
  withRetry,
  withSessionRetry,
  calculateBackoffDelay,
};
