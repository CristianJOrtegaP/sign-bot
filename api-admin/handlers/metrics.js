/**
 * Handler: Metrics Dashboard
 * Rutas: GET /api/admin/metrics
 */

const metricsService = require('../../core/services/infrastructure/metricsService');
const security = require('../../core/services/infrastructure/securityService');
const { applySecurityHeaders } = require('../../core/middleware/securityHeaders');

/**
 * Valida API key para acceso a métricas
 */
function validateApiKey(req) {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  const validKey = process.env.ADMIN_API_KEY;

  if (!validKey) {
    return { valid: true, warning: 'No API key configured' };
  }

  if (!apiKey) {
    return { valid: false, error: 'Missing API key' };
  }

  if (apiKey !== validKey) {
    return { valid: false, error: 'Invalid API key' };
  }

  return { valid: true };
}

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

  // Rate limiting
  const clientIp = security.getClientIp(req);
  const rateLimit = security.checkIpRateLimit(clientIp);

  if (!rateLimit.allowed) {
    context.log.warn(`Rate limit excedido: ${clientIp}`);
    context.res = {
      status: 429,
      headers: applySecurityHeaders({
        'Content-Type': 'application/json',
        'Retry-After': Math.ceil(rateLimit.resetMs / 1000).toString(),
      }),
      body: {
        error: 'rate_limited',
        message: 'Too many requests',
        retryAfterMs: rateLimit.resetMs,
      },
    };
    return;
  }

  // Validar API key
  const auth = validateApiKey(req);
  if (!auth.valid) {
    context.log.warn(`Acceso no autorizado a metrics: ${clientIp}`);
    context.res = {
      status: 401,
      headers: applySecurityHeaders({ 'Content-Type': 'application/json' }),
      body: {
        error: 'unauthorized',
        message: auth.error,
      },
    };
    return;
  }

  if (auth.warning) {
    context.log.warn(auth.warning);
  }

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
