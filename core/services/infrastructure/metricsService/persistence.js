/**
 * Sign Bot - Métricas: Persistencia
 * Funciones para persistir y leer métricas de Azure Table Storage
 */

const { logger } = require('../errorHandler');
const {
  isStorageEnabled,
  getMetricsTableClient,
  getErrorsTableClient,
  getPartitionKey,
  getRowKey,
} = require('./storage');

/**
 * Persiste una métrica de operación en Azure Table Storage
 */
async function persistMetric(operationName, durationMs, metadata = {}) {
  if (!isStorageEnabled() || !getMetricsTableClient()) {
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

    await getMetricsTableClient().createEntity(entity);
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
  if (!isStorageEnabled() || !getErrorsTableClient()) {
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

    await getErrorsTableClient().createEntity(entity);
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
async function persistMetricsSummary(getMetricsSummary) {
  if (!isStorageEnabled() || !getMetricsTableClient()) {
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

    await getMetricsTableClient().createEntity(entity);
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
  if (!isStorageEnabled() || !getMetricsTableClient()) {
    return [];
  }

  try {
    const partitionKey = date || getPartitionKey();
    let filter = `PartitionKey eq '${partitionKey}'`;

    if (operationType) {
      filter += ` and operation eq '${operationType}'`;
    }

    const entities = [];
    const iterator = getMetricsTableClient().listEntities({
      queryOptions: { filter },
    });

    for await (const entity of iterator) {
      let parsedMetadata = {};
      if (entity.metadata) {
        try {
          parsedMetadata = JSON.parse(entity.metadata);
        } catch (parseError) {
          logger.warn('Error parseando metadata de métrica', {
            error: parseError.message,
            operation: entity.operation,
          });
        }
      }
      entities.push({
        operation: entity.operation,
        durationMs: entity.durationMs,
        metadata: parsedMetadata,
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
  if (!isStorageEnabled() || !getErrorsTableClient()) {
    return [];
  }

  try {
    const partitionKey = date || getPartitionKey();
    const entities = [];
    const iterator = getErrorsTableClient().listEntities({
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

module.exports = {
  persistMetric,
  persistError,
  persistMetricsSummary,
  getHistoricalMetrics,
  getHistoricalErrors,
};
