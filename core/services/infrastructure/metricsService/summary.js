/**
 * Sign Bot - Métricas: Resumen y Logging
 * Funciones para obtener resúmenes de métricas y logging
 */

const { logger } = require('../errorHandler');
const { metrics } = require('./state');
const { calculatePercentiles } = require('./helpers');
const { persistError } = require('./persistence');

/**
 * Registra un hit de caché
 */
function recordCacheHit() {
  metrics.cache.hits++;
}

/**
 * Registra un miss de caché
 */
function recordCacheMiss() {
  metrics.cache.misses++;
}

/**
 * Registra un error
 */
function recordError(errorType, errorMessage = '') {
  const count = metrics.errors.get(errorType) || 0;
  metrics.errors.set(errorType, count + 1);

  logger.error(`Error registrado: ${errorType}`, null, { errorType, errorMessage });

  // Persistir error en Azure Table Storage (async, no bloqueante)
  persistError(errorType, errorMessage).catch((err) => {
    logger.error('Error persistiendo error en storage', err, { errorType });
  });
}

/**
 * Reset de métricas (solo para tests)
 * FASE 2: Necesario para arreglar tests de enhancedMetrics
 */
function resetMetrics() {
  metrics.operations.clear();
  metrics.timings.clear();
  metrics.errors.clear();
  metrics.cache.hits = 0;
  metrics.cache.misses = 0;
  metrics.latencyHistograms.clear();
  metrics.rawTimings.clear();
  metrics.slaTracking.clear();
  metrics.errorRates.clear();
}

/**
 * Obtiene resumen de métricas (FASE 2: Enhanced con percentiles, SLA, error rates)
 */
function getMetricsSummary() {
  const summary = {
    timestamp: new Date().toISOString(),
    operations: {},
    timings: {},
    errors: {},
    cache: {
      ...metrics.cache,
      hitRate:
        metrics.cache.hits + metrics.cache.misses > 0
          ? `${((metrics.cache.hits / (metrics.cache.hits + metrics.cache.misses)) * 100).toFixed(2)}%`
          : 'N/A',
    },
    // FASE 2: Enhanced Metrics
    percentiles: {},
    latencyHistograms: {},
    slaCompliance: {},
    errorRates: {},
  };

  // Convertir Maps a objetos
  for (const [key, value] of metrics.operations.entries()) {
    summary.operations[key] = value;
  }

  for (const [key, value] of metrics.timings.entries()) {
    summary.timings[key] = {
      avg: Math.round(value.avg),
      min: value.min,
      max: value.max,
      count: value.count,
    };
  }

  for (const [key, value] of metrics.errors.entries()) {
    summary.errors[key] = value;
  }

  // FASE 2: Percentiles
  for (const [key, timings] of metrics.rawTimings.entries()) {
    if (timings.length > 0) {
      summary.percentiles[key] = calculatePercentiles(timings);
    }
  }

  // FASE 2: Latency Histograms
  for (const [key, histogram] of metrics.latencyHistograms.entries()) {
    summary.latencyHistograms[key] = { ...histogram };
  }

  // FASE 2: SLA Compliance
  for (const [key, sla] of metrics.slaTracking.entries()) {
    const total = sla.within + sla.exceeded;
    const complianceRate = total > 0 ? ((sla.within / total) * 100).toFixed(2) : 'N/A';
    const errorRate =
      sla.successCount + sla.errorCount > 0
        ? ((sla.errorCount / (sla.successCount + sla.errorCount)) * 100).toFixed(2)
        : '0';

    summary.slaCompliance[key] = {
      target: `${sla.target}ms`,
      within: sla.within,
      exceeded: sla.exceeded,
      complianceRate: `${complianceRate}%`,
      successCount: sla.successCount,
      errorCount: sla.errorCount,
      errorRate: `${errorRate}%`,
    };
  }

  // FASE 2: Error Rates
  for (const [key, errorRate] of metrics.errorRates.entries()) {
    const rate =
      errorRate.total > 0 ? ((errorRate.errors / errorRate.total) * 100).toFixed(2) : '0';

    summary.errorRates[key] = {
      total: errorRate.total,
      errors: errorRate.errors,
      rate: `${rate}%`,
    };
  }

  return summary;
}

/**
 * Imprime resumen de métricas en consola
 */
function printMetricsSummary() {
  const summary = getMetricsSummary();

  // Usar logger.metrics para resumen estructurado
  logger.metrics('Resumen periódico', {
    timings: summary.timings,
    cache: summary.cache,
    errors: summary.errors,
    operationCount: Object.keys(summary.operations).length,
  });
}

module.exports = {
  recordCacheHit,
  recordCacheMiss,
  recordError,
  resetMetrics,
  getMetricsSummary,
  printMetricsSummary,
};
