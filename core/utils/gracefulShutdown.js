/**
 * Sign Bot - Graceful Shutdown Handler
 * Maneja el cierre ordenado de la aplicación
 *
 * @module utils/gracefulShutdown
 */

const { logger } = require('../services/infrastructure/errorHandler');

/**
 * Lista de manejadores de cleanup registrados
 * @type {Array<{name: string, handler: Function, priority: number}>}
 */
const cleanupHandlers = [];

/**
 * Estado del shutdown
 */
let isShuttingDown = false;
let shutdownTimeout = parseInt(process.env.SHUTDOWN_TIMEOUT_MS || '10000', 10);

/**
 * Registra un manejador de cleanup para ser ejecutado durante el shutdown
 * @param {string} name - Nombre del servicio (para logging)
 * @param {Function} handler - Función async de cleanup
 * @param {number} priority - Prioridad (mayor = se ejecuta primero, default: 100)
 */
function registerCleanupHandler(name, handler, priority = 100) {
  cleanupHandlers.push({ name, handler, priority });
  // Ordenar por prioridad descendente
  cleanupHandlers.sort((a, b) => b.priority - a.priority);
  logger.debug(`[Shutdown] Handler registrado: ${name} (prioridad: ${priority})`);
}

/**
 * Ejecuta todos los manejadores de cleanup
 * @returns {Promise<void>}
 */
async function executeCleanup() {
  if (isShuttingDown) {
    logger.warn('[Shutdown] Cleanup ya en progreso, ignorando');
    return;
  }

  isShuttingDown = true;
  logger.info('[Shutdown] Iniciando cleanup graceful...', {
    handlers: cleanupHandlers.length,
    timeoutMs: shutdownTimeout,
  });

  const startTime = Date.now();
  const results = { success: 0, failed: 0, skipped: 0 };

  for (const { name, handler } of cleanupHandlers) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= shutdownTimeout) {
      logger.warn(`[Shutdown] Timeout alcanzado, saltando handler: ${name}`);
      results.skipped++;
      continue;
    }

    const remainingTime = shutdownTimeout - elapsed;

    try {
      // Ejecutar handler con timeout individual
      await Promise.race([
        handler(),
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error('Handler timeout')), remainingTime);
        }),
      ]);
      logger.info(`[Shutdown] ✓ ${name} cerrado correctamente`);
      results.success++;
    } catch (error) {
      logger.error(`[Shutdown] ✗ Error en ${name}`, error);
      results.failed++;
    }
  }

  const totalTime = Date.now() - startTime;
  logger.info('[Shutdown] Cleanup completado', {
    ...results,
    totalTimeMs: totalTime,
  });
}

/**
 * Configura los listeners de señales del sistema
 */
function setupSignalHandlers() {
  const signals = ['SIGTERM', 'SIGINT', 'SIGHUP'];

  for (const signal of signals) {
    process.on(signal, async () => {
      logger.info(`[Shutdown] Señal ${signal} recibida`);
      await executeCleanup();
      process.exit(0);
    });
  }

  // Manejar errores no capturados
  process.on('uncaughtException', async (error) => {
    logger.error('[Shutdown] Uncaught exception', error);
    await executeCleanup();
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason, promise) => {
    logger.error('[Shutdown] Unhandled rejection', reason, { promise: String(promise) });
    // No cerramos aquí, solo logueamos
  });

  logger.debug('[Shutdown] Signal handlers configurados');
}

/**
 * Verifica si el proceso está en shutdown
 * @returns {boolean}
 */
function isInShutdown() {
  return isShuttingDown;
}

/**
 * Configura el timeout de shutdown
 * @param {number} ms - Timeout en milisegundos
 */
function setShutdownTimeout(ms) {
  shutdownTimeout = ms;
}

/**
 * Registra handlers comunes de la aplicación
 * Debe llamarse después de inicializar los servicios
 */
function registerCommonHandlers() {
  // Redis
  try {
    const redis = require('../services/cache/redisService');
    registerCleanupHandler(
      'Redis',
      async () => {
        await redis.disconnect();
      },
      200
    );
  } catch {
    // Redis no disponible
  }

  // Service Bus
  try {
    const serviceBus = require('../services/messaging/serviceBusService');
    registerCleanupHandler(
      'ServiceBus',
      async () => {
        await serviceBus.disconnect();
      },
      200
    );
  } catch {
    // Service Bus no disponible
  }

  // Database connection pool
  try {
    const connectionPool = require('../services/storage/connectionPool');
    registerCleanupHandler(
      'Database',
      async () => {
        await connectionPool.closePool();
      },
      100
    ); // Menor prioridad - cerrar al final
  } catch {
    // Connection pool no disponible
  }

  // Application Insights - flush antes de cerrar
  try {
    const appInsights = require('../services/infrastructure/appInsightsService');
    registerCleanupHandler(
      'AppInsights',
      async () => {
        await appInsights.flush();
      },
      300
    ); // Alta prioridad - flush primero
  } catch {
    // App Insights no disponible
  }
}

module.exports = {
  registerCleanupHandler,
  executeCleanup,
  setupSignalHandlers,
  isInShutdown,
  setShutdownTimeout,
  registerCommonHandlers,
};
