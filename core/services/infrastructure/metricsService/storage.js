/**
 * Sign Bot - Métricas: Azure Table Storage
 * Inicialización y gestión de clientes de Azure Table Storage
 */

const {
  TableClient,
  AzureNamedKeyCredential: _AzureNamedKeyCredential,
} = require('@azure/data-tables');
const { logger } = require('../errorHandler');
const { TABLE_NAMES } = require('./state');

// Clientes de Azure Table Storage
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
    metricsTableClient = TableClient.fromConnectionString(connectionString, TABLE_NAMES.METRICS);
    errorsTableClient = TableClient.fromConnectionString(connectionString, TABLE_NAMES.ERRORS);

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
 * Verifica si el storage está habilitado
 */
function isStorageEnabled() {
  return storageEnabled;
}

/**
 * Obtiene el cliente de la tabla de métricas
 */
function getMetricsTableClient() {
  return metricsTableClient;
}

/**
 * Obtiene el cliente de la tabla de errores
 */
function getErrorsTableClient() {
  return errorsTableClient;
}

module.exports = {
  initializeStorage,
  getPartitionKey,
  getRowKey,
  isStorageEnabled,
  getMetricsTableClient,
  getErrorsTableClient,
};
