/**
 * AC FIXBOT - Métricas: Performance Timer
 * Clase para medir tiempos de operaciones
 */

const { logger } = require('../errorHandler');
const { metrics } = require('./state');
const {
  updateRawTimings,
  updateLatencyHistogram,
  updateSlaTracking,
  updateErrorRate,
} = require('./helpers');
const { persistMetric } = require('./persistence');

/**
 * Clase para medir tiempos de operaciones
 */
class PerformanceTimer {
  constructor(operationName, context = null) {
    this.operationName = operationName;
    this.context = context;
    this.startTime = Date.now();
  }

  /**
   * Finaliza el timer y registra la métrica
   */
  end(metadata = {}) {
    const duration = Date.now() - this.startTime;
    const isError = metadata.error || metadata.success === false;

    // Actualizar contador de operaciones
    const count = metrics.operations.get(this.operationName) || 0;
    metrics.operations.set(this.operationName, count + 1);

    // Actualizar tiempos promedio
    const existing = metrics.timings.get(this.operationName) || {
      sum: 0,
      count: 0,
      min: Infinity,
      max: 0,
    };
    existing.sum += duration;
    existing.count += 1;
    existing.min = Math.min(existing.min, duration);
    existing.max = Math.max(existing.max, duration);
    existing.avg = existing.sum / existing.count;
    metrics.timings.set(this.operationName, existing);

    // FASE 2: Enhanced Metrics
    updateRawTimings(this.operationName, duration);
    updateLatencyHistogram(this.operationName, duration);
    updateSlaTracking(this.operationName, duration, !isError);
    updateErrorRate(this.operationName, isError);

    // Log estructurado
    const logData = {
      timestamp: new Date().toISOString(),
      operation: this.operationName,
      duration_ms: duration,
      ...metadata,
    };

    if (this.context) {
      this.context.log(`[METRICS] ${this.operationName}: ${duration}ms`, logData);
    } else {
      logger.metrics(`${this.operationName}: ${duration}ms`, logData);
    }

    // Persistir en Azure Table Storage (async, no bloqueante)
    persistMetric(this.operationName, duration, metadata).catch((err) => {
      logger.error('Error persistiendo métrica', err, { operation: this.operationName });
    });

    // FASE 10/10: Enviar a Application Insights
    try {
      const appInsights = require('../appInsightsService');
      if (appInsights.isInitialized()) {
        appInsights.trackMetric(`${this.operationName}.duration`, duration, {
          success: !isError,
          ...metadata,
        });
      }
    } catch (_err) {
      // Ignorar si appInsights no está disponible
    }

    return duration;
  }
}

/**
 * Inicia un timer para una operación
 */
function startTimer(operationName, context = null) {
  return new PerformanceTimer(operationName, context);
}

module.exports = {
  PerformanceTimer,
  startTimer,
};
