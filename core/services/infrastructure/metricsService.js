/**
 * AC FIXBOT - Servicio de Métricas y Performance
 * Sistema de logging estructurado y medición de tiempos
 * Con persistencia en Azure Table Storage
 */

const config = require('../../config');
const { TableClient, AzureNamedKeyCredential: _AzureNamedKeyCredential } = require('@azure/data-tables');
const { logger } = require('./errorHandler');

// Métricas acumuladas en memoria
const metrics = {
    operations: new Map(), // Contador de operaciones por tipo
    timings: new Map(),    // Tiempos promedio por operación
    errors: new Map(),     // Contadores de errores por tipo
    cache: {
        hits: 0,
        misses: 0
    }
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
        logger.warn('No se encontró connection string de Azure Storage. Las métricas solo se guardarán en memoria.');
        return false;
    }

    try {
        // Crear clientes de tabla
        metricsTableClient = TableClient.fromConnectionString(connectionString, METRICS_TABLE_NAME);
        errorsTableClient = TableClient.fromConnectionString(connectionString, ERRORS_TABLE_NAME);

        // Crear tablas si no existen
        await metricsTableClient.createTable().catch(err => {
            if (err.statusCode !== 409) {throw err;} // 409 = tabla ya existe
        });

        await errorsTableClient.createTable().catch(err => {
            if (err.statusCode !== 409) {throw err;}
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

        // Actualizar contador de operaciones
        const count = metrics.operations.get(this.operationName) || 0;
        metrics.operations.set(this.operationName, count + 1);

        // Actualizar tiempos promedio
        const existing = metrics.timings.get(this.operationName) || { sum: 0, count: 0, min: Infinity, max: 0 };
        existing.sum += duration;
        existing.count += 1;
        existing.min = Math.min(existing.min, duration);
        existing.max = Math.max(existing.max, duration);
        existing.avg = existing.sum / existing.count;
        metrics.timings.set(this.operationName, existing);

        // Log estructurado
        const logData = {
            timestamp: new Date().toISOString(),
            operation: this.operationName,
            duration_ms: duration,
            ...metadata
        };

        if (this.context) {
            this.context.log(`[METRICS] ${this.operationName}: ${duration}ms`, logData);
        } else {
            logger.metrics(`${this.operationName}: ${duration}ms`, logData);
        }

        // Persistir en Azure Table Storage (async, no bloqueante)
        persistMetric(this.operationName, duration, metadata).catch(err => {
            logger.error('Error persistiendo métrica', err, { operation: this.operationName });
        });

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
    persistError(errorType, errorMessage).catch(err => {
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
            timestamp: new Date().toISOString()
        };

        await metricsTableClient.createEntity(entity);
    } catch (error) {
        // No propagar errores de persistencia para no afectar el flujo principal
        if (error.statusCode !== 409) { // Ignorar conflictos de duplicados
            logger.debug('Error persistiendo métrica en storage', { error: error.message, operation: operationName });
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
            timestamp: new Date().toISOString()
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
            timestamp: new Date().toISOString()
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
            queryOptions: { filter }
        });

        for await (const entity of iterator) {
            entities.push({
                operation: entity.operation,
                durationMs: entity.durationMs,
                metadata: entity.metadata ? JSON.parse(entity.metadata) : {},
                timestamp: entity.timestamp
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
            queryOptions: { filter: `PartitionKey eq '${partitionKey}'` }
        });

        for await (const entity of iterator) {
            entities.push({
                errorType: entity.errorType,
                errorMessage: entity.errorMessage,
                timestamp: entity.timestamp
            });
        }

        return entities;
    } catch (error) {
        logger.error('Error obteniendo errores históricos', error);
        return [];
    }
}

/**
 * Obtiene resumen de métricas
 */
function getMetricsSummary() {
    const summary = {
        timestamp: new Date().toISOString(),
        operations: {},
        timings: {},
        errors: {},
        cache: {
            ...metrics.cache,
            hitRate: metrics.cache.hits + metrics.cache.misses > 0
                ? `${(metrics.cache.hits / (metrics.cache.hits + metrics.cache.misses) * 100).toFixed(2)  }%`
                : 'N/A'
        }
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
            count: value.count
        };
    }

    for (const [key, value] of metrics.errors.entries()) {
        summary.errors[key] = value;
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
        operationCount: Object.keys(summary.operations).length
    });
}

// Imprimir y persistir resumen periódicamente
// .unref() permite que el proceso termine sin esperar este timer
setInterval(() => {
    printMetricsSummary();
    persistMetricsSummary().catch(err => {
        logger.error('Error en persistencia periódica de métricas', err);
    });
}, config.metrics.printIntervalMs).unref();

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
    initializeStorage
};
