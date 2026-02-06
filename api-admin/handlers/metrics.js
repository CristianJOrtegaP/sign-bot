/**
 * Handler: Metrics Dashboard
 * Rutas: GET /api/admin/metrics
 *
 * Autenticación: Azure Function Keys (validado automáticamente por Azure)
 * Rate Limiting: Manejado en index.js (60 req/min por IP)
 */

const metricsService = require('../../core/services/infrastructure/metricsService');
const { applySecurityHeaders } = require('../../core/middleware/securityHeaders');

/**
 * Formatea métricas para respuesta HTTP
 */
function formatMetricsResponse(summary, options = {}) {
  const response = {
    timestamp: summary.timestamp,
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0',
  };

  if (options.operation) {
    const op = options.operation;
    response.operation = op;
    response.metrics = {
      count: summary.operations[op] || 0,
      timing: summary.timings[op] || null,
      percentiles: summary.percentiles[op] || null,
      histogram: summary.latencyHistograms[op] || null,
      sla: summary.slaCompliance[op] || null,
      errorRate: summary.errorRates[op] || null,
    };
  } else {
    response.summary = {
      totalOperations: Object.keys(summary.operations).length,
      cache: summary.cache,
    };
    response.operations = summary.operations;
    response.timings = summary.timings;
    response.percentiles = summary.percentiles;
    response.histograms = summary.latencyHistograms;
    response.slaCompliance = summary.slaCompliance;
    response.errorRates = summary.errorRates;
    response.errors = summary.errors;
  }

  return response;
}

/**
 * Obtiene métricas históricas
 */
async function getHistoricalMetricsData(date, operationType) {
  try {
    if (!metricsService.isStorageEnabled()) {
      return {
        available: false,
        message: 'Historical metrics not available (Azure Storage not configured)',
      };
    }

    const metrics = await metricsService.getHistoricalMetrics(date, operationType);
    const errors = await metricsService.getHistoricalErrors(date);

    return {
      available: true,
      date: date || new Date().toISOString().split('T')[0],
      metrics,
      errors,
      count: metrics.length,
    };
  } catch (error) {
    return {
      available: false,
      error: error.message,
    };
  }
}

module.exports = async function metricsHandler(context, req) {
  const startTime = Date.now();

  // Autenticación: Azure valida Function Key antes de llegar aquí
  // Rate Limiting: Manejado en index.js

  try {
    const operation = req.query.operation;
    const historical = req.query.historical === 'true';
    const date = req.query.date;

    let response;

    if (historical) {
      response = {
        type: 'historical',
        data: await getHistoricalMetricsData(date, operation),
      };
    } else {
      const summary = metricsService.getMetricsSummary();
      response = {
        type: 'real-time',
        data: formatMetricsResponse(summary, { operation }),
      };
    }

    const duration = Date.now() - startTime;
    context.log(`Metrics: ${historical ? 'historical' : 'real-time'} - ${duration}ms`);

    context.res = {
      status: 200,
      headers: applySecurityHeaders({
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      }),
      body: response,
    };
  } catch (error) {
    context.log.error('Error en metrics handler:', error);
    context.res = {
      status: 500,
      headers: applySecurityHeaders({ 'Content-Type': 'application/json' }),
      body: {
        error: 'internal_error',
        message: 'Error retrieving metrics',
      },
    };
  }
};
