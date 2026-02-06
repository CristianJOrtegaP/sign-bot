/**
 * AC FIXBOT - Servicio de Métricas y Performance
 * Sistema de logging estructurado y medición de tiempos
 * Con persistencia en Azure Table Storage
 *
 * Módulo principal que re-exporta todas las funciones públicas
 */

const config = require('../../../config');
const { logger } = require('../errorHandler');

// Importar módulos internos
const { initializeStorage, isStorageEnabled } = require('./storage');
const { startTimer, PerformanceTimer } = require('./timer');
const {
  persistMetricsSummary,
  getHistoricalMetrics,
  getHistoricalErrors,
} = require('./persistence');
const {
  recordCacheHit,
  recordCacheMiss,
  recordError,
  resetMetrics,
  getMetricsSummary,
  printMetricsSummary,
} = require('./summary');

// Inicializar storage al cargar el módulo
initializeStorage();

// Imprimir y persistir resumen periódicamente
// .unref() permite que el proceso termine sin esperar este timer
setInterval(() => {
  printMetricsSummary();
  persistMetricsSummary(getMetricsSummary).catch((err) => {
    logger.error('Error en persistencia periódica de métricas', err);
  });

  // FASE 2: Evaluar métricas y generar alertas si es necesario
  try {
    const alertingService = require('../alertingService');
    const summary = getMetricsSummary();
    alertingService.evaluateMetrics(summary).catch((err) => {
      logger.error('Error evaluando métricas para alertas', err);
    });
  } catch (err) {
    // Ignorar si alertingService no está disponible
    logger.debug('Alerting service no disponible', { error: err.message });
  }
}, config.metrics.printIntervalMs).unref();

// Re-exportar todas las funciones públicas
module.exports = {
  // Timer
  startTimer,
  PerformanceTimer,

  // Cache tracking
  recordCacheHit,
  recordCacheMiss,

  // Error tracking
  recordError,

  // Summary
  getMetricsSummary,
  printMetricsSummary,

  // Persistencia
  persistMetricsSummary: () => persistMetricsSummary(getMetricsSummary),
  getHistoricalMetrics,
  getHistoricalErrors,

  // Estado del storage
  isStorageEnabled,
  initializeStorage,

  // Para tests
  resetMetrics,
};
