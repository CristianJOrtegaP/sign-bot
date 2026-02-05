/**
 * AC FIXBOT - Servicio de Métricas y Performance
 * Sistema de logging estructurado y medición de tiempos
 * Con persistencia en Azure Table Storage
 */

const config = require('../../config');
const {
  TableClient,
  AzureNamedKeyCredential: _AzureNamedKeyCredential,
} = require('@azure/data-tables');
const { logger } = require('./errorHandler');

// Métricas acumuladas en memoria
const metrics = {
  operations: new Map(), // Contador de operaciones por tipo
  timings: new Map(), // Tiempos promedio por operación
  errors: new Map(), // Contadores de errores por tipo
  cache: {
    hits: 0,
    misses: 0,
  },
  // FASE 2: Enhanced Metrics
  latencyHistograms: new Map(), // Histogramas de latencia por operación
  rawTimings: new Map(), // Timings raw para cálculo de percentiles (últimos N)
  slaTracking: new Map(), // Tracking de SLA compliance
  errorRates: new Map(), // Error rates por operación
};

// Configuración para enhanced metrics
const MAX_RAW_TIMINGS = 1000; // Mantener últimos 1000 timings para percentiles
const LATENCY_BUCKETS = [50, 100, 200, 500, 1000, 2000, 5000]; // ms
const SLA_TARGETS = {
  'webhook.process': 1000, // 1s SLA para procesamiento de webhook
  'ai.generateResponse': 3000, // 3s SLA para respuesta de AI
  'db.query': 500, // 500ms SLA para queries DB
  'whatsapp.sendMessage': 2000, // 2s SLA para envío WhatsApp
  default: 2000, // 2s SLA default
};

// ============================================================================
// CONFIGURACIÓN DE AZURE TABLE STORAGE
// ============================================================================

const METRICS_TABLE_NAME = 'ACFixBotMetrics';
const ERRORS_TABLE_NAME = 'ACFixBotErrors';

let metricsTableClient = null;
let errorsTableClient = null;
let storageEnabled = false;

/**
 * Inicializa los clientes de Azure Table Storage
 */
async function initializeStorage() {
  const connectionString = process.env.BLOB_CONNECTION_STRING || process.env.AzureWebJobsStorage;

  if (!connectionString) {
    logger.warn(
      'No se encontró connection string de Azure Storage. Las métricas solo se guardarán en memoria.'
    );
    return false;
  }

  try {
    // Crear clientes de tabla
    metricsTableClient = TableClient.fromConnectionString(connectionString, METRICS_TABLE_NAME);
    errorsTableClient = TableClient.fromConnectionString(connectionString, ERRORS_TABLE_NAME);

    // Crear tablas si no existen
    await metricsTableClient.createTable().catch((err) => {
      if (err.statusCode !== 409) {
        throw err;
      } // 409 = tabla ya existe
    });

    await errorsTableClient.createTable().catch((err) => {
      if (err.statusCode !== 409) {
        throw err;
      }
    });

    storageEnabled = true;
    logger.metrics('Azure Table Storage inicializado correctamente');
    return true;
  } catch (error) {
    logger.error('Error inicializando Azure Table Storage', error);
    storageEnabled = false;
    return false;
  }
}

// Inicializar storage al cargar el módulo
initializeStorage();

/**
 * Genera una clave de partición basada en la fecha (YYYY-MM-DD)
 */
function getPartitionKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Genera una clave de fila única
 */
function getRowKey(prefix = '') {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}${timestamp}-${random}`;
}

// ============================================================================
// FUNCIONES HELPER PARA ENHANCED METRICS
// ============================================================================

/**
 * Calcula percentiles de un array de valores
 */
function calculatePercentiles(values, percentiles = [50, 75, 95, 99]) {
  if (values.length === 0) {
    return {};
  }

  const sorted = [...values].sort((a, b) => a - b);
  const result = {};

  for (const p of percentiles) {
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    result[`p${p}`] = sorted[Math.max(0, index)];
  }

  return result;
}

/**
 * Actualiza histograma de latencia
 */
function updateLatencyHistogram(operationName, duration) {
  let histogram = metrics.latencyHistograms.get(operationName);
  if (!histogram) {
    histogram = {};
    for (const bucket of LATENCY_BUCKETS) {
      histogram[`<${bucket}ms`] = 0;
    }
    histogram[`>${LATENCY_BUCKETS[LATENCY_BUCKETS.length - 1]}ms`] = 0;
    metrics.latencyHistograms.set(operationName, histogram);
  }

  let bucketFound = false;
  for (const bucket of LATENCY_BUCKETS) {
    if (duration < bucket) {
      histogram[`<${bucket}ms`]++;
      bucketFound = true;
      break;
    }
  }

  if (!bucketFound) {
    histogram[`>${LATENCY_BUCKETS[LATENCY_BUCKETS.length - 1]}ms`]++;
  }
}

/**
 * Actualiza tracking de SLA compliance
 */
function updateSlaTracking(operationName, duration, success = true) {
  let sla = metrics.slaTracking.get(operationName);
  if (!sla) {
    const target = SLA_TARGETS[operationName] || SLA_TARGETS.default;
    sla = {
      target,
      within: 0,
      exceeded: 0,
      successCount: 0,
      errorCount: 0,
    };
    metrics.slaTracking.set(operationName, sla);
  }

  if (duration <= sla.target) {
    sla.within++;
  } else {
    sla.exceeded++;
  }

  if (success) {
    sla.successCount++;
  } else {
    sla.errorCount++;
  }
}

/**
 * Actualiza raw timings para cálculo de percentiles
 */
function updateRawTimings(operationName, duration) {
  let timings = metrics.rawTimings.get(operationName);
  if (!timings) {
    timings = [];
    metrics.rawTimings.set(operationName, timings);
  }

  timings.push(duration);

  // Mantener solo los últimos MAX_RAW_TIMINGS
  if (timings.length > MAX_RAW_TIMINGS) {
    timings.shift();
  }
}

/**
 * Actualiza error rate
 */
function updateErrorRate(operationName, isError = false) {
  let errorRate = metrics.errorRates.get(operationName);
  if (!errorRate) {
    errorRate = { total: 0, errors: 0 };
    metrics.errorRates.set(operationName, errorRate);
  }

  errorRate.total++;
  if (isError) {
    errorRate.errors++;
  }
}

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
      const appInsights = require('./appInsightsService');
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

// ============================================================================
// FUNCIONES DE PERSISTENCIA EN AZURE TABLE STORAGE
// ============================================================================

/**
 * Persiste una métrica de operación en Azure Table Storage
 */
async function persistMetric(operationName, durationMs, metadata = {}) {
  if (!storageEnabled || !metricsTableClient) {
    return; // Storage no disponible, solo mantener en memoria
  }

  try {
    const entity = {
      partitionKey: getPartitionKey(),
      rowKey: getRowKey('op-'),
      operation: operationName,
      durationMs: durationMs,
      metadata: JSON.stringify(metadata),
      timestamp: new Date().toISOString(),
    };

    await metricsTableClient.createEntity(entity);
  } catch (error) {
    // No propagar errores de persistencia para no afectar el flujo principal
    if (error.statusCode !== 409) {
      // Ignorar conflictos de duplicados
      logger.debug('Error persistiendo métrica en storage', {
        error: error.message,
        operation: operationName,
      });
    }
  }
}

/**
 * Persiste un error en Azure Table Storage
 */
async function persistError(errorType, errorMessage) {
  if (!storageEnabled || !errorsTableClient) {
    return; // Storage no disponible, solo mantener en memoria
  }

  try {
    const entity = {
      partitionKey: getPartitionKey(),
      rowKey: getRowKey('err-'),
      errorType: errorType,
      errorMessage: errorMessage.substring(0, 1000), // Limitar tamaño
      timestamp: new Date().toISOString(),
    };

    await errorsTableClient.createEntity(entity);
  } catch (error) {
    if (error.statusCode !== 409) {
      logger.debug('Error persistiendo error en storage', { error: error.message, errorType });
    }
  }
}

/**
 * Persiste un resumen de métricas acumuladas
 * Se llama periódicamente para guardar el estado
 */
async function persistMetricsSummary() {
  if (!storageEnabled || !metricsTableClient) {
    return;
  }

  try {
    const summary = getMetricsSummary();
    const entity = {
      partitionKey: getPartitionKey(),
      rowKey: getRowKey('summary-'),
      type: 'SUMMARY',
      operations: JSON.stringify(summary.operations),
      timings: JSON.stringify(summary.timings),
      errors: JSON.stringify(summary.errors),
      cacheHits: summary.cache.hits,
      cacheMisses: summary.cache.misses,
      cacheHitRate: summary.cache.hitRate,
      timestamp: new Date().toISOString(),
    };

    await metricsTableClient.createEntity(entity);
    logger.metrics('Resumen de métricas persistido en Azure Table Storage');
  } catch (error) {
    logger.error('Error persistiendo resumen de métricas', error);
  }
}

/**
 * Obtiene métricas históricas de Azure Table Storage
 * @param {string} date - Fecha en formato YYYY-MM-DD (opcional, default: hoy)
 * @param {string} operationType - Tipo de operación a filtrar (opcional)
 * @returns {Promise<Array>}
 */
async function getHistoricalMetrics(date = null, operationType = null) {
  if (!storageEnabled || !metricsTableClient) {
    return [];
  }

  try {
    const partitionKey = date || getPartitionKey();
    let filter = `PartitionKey eq '${partitionKey}'`;

    if (operationType) {
      filter += ` and operation eq '${operationType}'`;
    }

    const entities = [];
    const iterator = metricsTableClient.listEntities({
      queryOptions: { filter },
    });

    for await (const entity of iterator) {
      entities.push({
        operation: entity.operation,
        durationMs: entity.durationMs,
        metadata: entity.metadata ? JSON.parse(entity.metadata) : {},
        timestamp: entity.timestamp,
      });
    }

    return entities;
  } catch (error) {
    logger.error('Error obteniendo métricas históricas', error);
    return [];
  }
}

/**
 * Obtiene errores históricos de Azure Table Storage
 * @param {string} date - Fecha en formato YYYY-MM-DD (opcional, default: hoy)
 * @returns {Promise<Array>}
 */
async function getHistoricalErrors(date = null) {
  if (!storageEnabled || !errorsTableClient) {
    return [];
  }

  try {
    const partitionKey = date || getPartitionKey();
    const entities = [];
    const iterator = errorsTableClient.listEntities({
      queryOptions: { filter: `PartitionKey eq '${partitionKey}'` },
    });

    for await (const entity of iterator) {
      entities.push({
        errorType: entity.errorType,
        errorMessage: entity.errorMessage,
        timestamp: entity.timestamp,
      });
    }

    return entities;
  } catch (error) {
    logger.error('Error obteniendo errores históricos', error);
    return [];
  }
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

// Imprimir y persistir resumen periódicamente
// .unref() permite que el proceso termine sin esperar este timer
setInterval(() => {
  printMetricsSummary();
  persistMetricsSummary().catch((err) => {
    logger.error('Error en persistencia periódica de métricas', err);
  });

  // FASE 2: Evaluar métricas y generar alertas si es necesario
  try {
    const alertingService = require('./alertingService');
    const summary = getMetricsSummary();
    alertingService.evaluateMetrics(summary).catch((err) => {
      logger.error('Error evaluando métricas para alertas', err);
    });
  } catch (err) {
    // Ignorar si alertingService no está disponible
    logger.debug('Alerting service no disponible', { error: err.message });
  }
}, config.metrics.printIntervalMs).unref();

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

module.exports = {
  startTimer,
  recordCacheHit,
  recordCacheMiss,
  recordError,
  getMetricsSummary,
  printMetricsSummary,
  // Funciones de persistencia
  persistMetricsSummary,
  getHistoricalMetrics,
  getHistoricalErrors,
  // Estado del storage
  isStorageEnabled: () => storageEnabled,
  initializeStorage,
  // Para tests
  resetMetrics,
};
