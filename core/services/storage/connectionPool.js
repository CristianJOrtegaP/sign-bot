/**
 * AC FIXBOT - Connection Pool Singleton
 * Pool de conexiones SQL compartido entre todos los servicios
 * Elimina la duplicación de lógica de conexión
 */

const sql = require('mssql');
const config = require('../../config');
const { logger, ConfigurationError } = require('../infrastructure/errorHandler');

// Singleton: única instancia del pool
let pool = null;
let isConnecting = false;
let connectionPromise = null;

/**
 * Obtiene o crea el pool de conexiones con manejo de reconexión
 * Este es el único punto de acceso al pool SQL en toda la aplicación
 * @returns {Promise<sql.ConnectionPool>} - Pool de conexiones activo
 */
async function getPool() {
  // Si ya existe un pool conectado, devolverlo
  if (pool && pool.connected) {
    return pool;
  }

  // Si ya se está conectando, esperar a que termine esa conexión
  if (isConnecting && connectionPromise) {
    logger.debug('Esperando conexión SQL en progreso...');
    return connectionPromise;
  }

  // Iniciar nueva conexión
  isConnecting = true;
  connectionPromise = createConnection();

  try {
    pool = await connectionPromise;
    return pool;
  } finally {
    isConnecting = false;
    connectionPromise = null;
  }
}

/**
 * Configuración del pool de conexiones
 * Valores leídos de config (env vars SQL_POOL_MIN, SQL_POOL_MAX, etc.)
 * Defaults: min=0, max=10, idle=120s, acquire=15s
 */
const POOL_CONFIG = config.database.pool;

/**
 * Parsea un connection string y lo convierte a objeto de configuración
 * El paquete mssql no siempre parsea correctamente los connection strings,
 * así que lo hacemos manualmente para mayor confiabilidad
 * @param {string} connString - Connection string estilo ADO.NET
 * @returns {Object} - Configuración parseada
 */
function parseConnectionString(connString) {
  const params = {};
  const parts = connString.split(';');

  for (const part of parts) {
    const [key, ...valueParts] = part.split('=');
    if (key && valueParts.length > 0) {
      const value = valueParts.join('='); // Reconectar si el valor tiene '='
      params[key.trim().toLowerCase()] = value.trim();
    }
  }

  // Obtener el servidor raw
  let server = params['server'] || params['data source'] || params['host'];
  let port = 1433; // Puerto default de SQL Server

  if (server) {
    // Remover prefijo 'tcp:' si existe (formato Azure)
    // Ejemplo: "tcp:sql-server.database.windows.net,1433" -> "sql-server.database.windows.net"
    if (server.toLowerCase().startsWith('tcp:')) {
      server = server.substring(4);
    }

    // Extraer puerto si está separado por coma (formato Azure)
    // Ejemplo: "sql-server.database.windows.net,1433" -> server + port
    const commaIndex = server.indexOf(',');
    if (commaIndex > -1) {
      const portStr = server.substring(commaIndex + 1).trim();
      if (portStr && !isNaN(parseInt(portStr, 10))) {
        port = parseInt(portStr, 10);
      }
      server = server.substring(0, commaIndex).trim();
    }
  }

  // Mapear las claves del connection string a propiedades de mssql
  return {
    server,
    port,
    database: params['database'] || params['initial catalog'],
    user: params['user id'] || params['uid'] || params['user'],
    password: params['password'] || params['pwd'],
    encrypt: params['encrypt']?.toLowerCase() === 'true',
    trustServerCertificate: params['trustservercertificate']?.toLowerCase() === 'true',
  };
}

/**
 * Crea una nueva conexión al pool
 * @returns {Promise<sql.ConnectionPool>} - Pool de conexiones
 */
async function createConnection() {
  const connString = config.database.connectionString;

  if (!connString) {
    throw new ConfigurationError('SQL_CONNECTION_STRING no está definida', 'SQL_CONNECTION_STRING');
  }

  // Cerrar pool anterior si existe pero está desconectado
  if (pool) {
    try {
      await pool.close();
      logger.info('Pool SQL anterior cerrado');
    } catch (err) {
      logger.warn('Error cerrando pool anterior', { error: err.message });
    }
    pool = null;
  }

  // Opciones de conexión con timeouts configurables
  const connectionTimeout = config.database.connectionTimeout || 30000;
  const requestTimeout = config.database.requestTimeout || 30000;

  // Parsear connection string a configuración explícita
  const parsed = parseConnectionString(connString);

  if (!parsed.server) {
    throw new ConfigurationError(
      `No se pudo extraer el servidor del connection string. Recibido: ${connString.substring(0, 50)}...`,
      'SQL_CONNECTION_STRING'
    );
  }

  // Crear configuración explícita para mssql (más confiable que connectionString)
  const poolConfig = {
    server: parsed.server,
    port: parsed.port,
    database: parsed.database,
    user: parsed.user,
    password: parsed.password,
    pool: {
      min: POOL_CONFIG.min,
      max: POOL_CONFIG.max,
      idleTimeoutMillis: POOL_CONFIG.idleTimeoutMillis,
      acquireTimeoutMillis: POOL_CONFIG.acquireTimeoutMillis,
    },
    options: {
      encrypt: parsed.encrypt !== false, // Default true para Azure
      trustServerCertificate: parsed.trustServerCertificate || false,
      enableArithAbort: true,
      connectTimeout: connectionTimeout,
      requestTimeout: requestTimeout,
    },
  };

  logger.debug('Conectando a SQL Server', {
    server: parsed.server,
    port: parsed.port,
    database: parsed.database,
    user: parsed.user,
  });

  const newPool = await sql.connect(poolConfig);

  logger.database('Conexión SQL establecida', true, {
    connectionTimeout,
    requestTimeout,
    poolMin: POOL_CONFIG.min,
    poolMax: POOL_CONFIG.max,
  });

  // Configurar eventos del pool
  newPool.on('error', (err) => {
    logger.error('Error en pool SQL', err, { component: 'ConnectionPool' });
    pool = null; // Forzar reconexión en siguiente uso
  });

  return newPool;
}

/**
 * Verifica si un error es transitorio y merece reintento
 * @param {Error} error - Error a verificar
 * @returns {boolean}
 */
function isTransientError(error) {
  // Error de conexión de red
  if (config.database.reconnectErrorCodes.includes(error.code)) {
    return true;
  }

  // Error transitorio de SQL Server (por número de error)
  if (
    error.number &&
    typeof error.number === 'number' &&
    config.database.transientErrorNumbers.includes(error.number)
  ) {
    return true;
  }

  // Errores específicos de mssql
  if (error.name === 'ConnectionError' || error.name === 'TransactionError') {
    return true;
  }

  // RequestError con timeout (ETIMEOUT)
  if (
    error.name === 'RequestError' &&
    (error.code === 'ETIMEOUT' || error.message?.includes('Timeout'))
  ) {
    return true;
  }

  return false;
}

/**
 * Calcula el delay con backoff exponencial
 * @param {number} attempt - Número de intento (1, 2, 3...)
 * @returns {number} - Delay en milisegundos
 */
function calculateBackoffDelay(attempt) {
  const { initialDelayMs, maxDelayMs, backoffMultiplier } = config.database.retry;
  const delay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1);
  // Agregar jitter (variación aleatoria) para evitar thundering herd
  const jitter = delay * 0.2 * Math.random();
  return Math.min(delay + jitter, maxDelayMs);
}

/**
 * Ejecuta una query con reintentos automáticos en caso de error transitorio
 * Implementa backoff exponencial con jitter
 * @param {Function} queryFn - Función que ejecuta la query
 * @param {number} retriesRemaining - Número de reintentos restantes
 * @returns {Promise<any>} - Resultado de la query
 */
async function executeWithRetry(queryFn, retriesRemaining = config.database.retry.maxRetries) {
  const attempt = config.database.retry.maxRetries - retriesRemaining + 1;

  try {
    return await queryFn();
  } catch (error) {
    // Verificar si es error transitorio y quedan reintentos
    if (retriesRemaining > 0 && isTransientError(error)) {
      const delay = calculateBackoffDelay(attempt);

      logger.warn('Error transitorio SQL, reintentando con backoff...', {
        attempt,
        maxRetries: config.database.retry.maxRetries,
        errorCode: error.code,
        errorNumber: error.number,
        errorName: error.name,
        delayMs: Math.round(delay),
      });

      // Forzar reconexión si es error de conexión
      if (config.database.reconnectErrorCodes.includes(error.code)) {
        pool = null;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, delay);
      });
      return executeWithRetry(queryFn, retriesRemaining - 1);
    }

    // Error no transitorio o sin reintentos: propagar
    logger.error('Error SQL no recuperable', error, {
      attempt,
      errorCode: error.code,
      errorNumber: error.number,
    });
    throw error;
  }
}

/**
 * Cierra el pool de conexiones (útil para cleanup)
 */
async function closePool() {
  if (pool) {
    try {
      await pool.close();
      pool = null;
      logger.info('Pool SQL cerrado correctamente');
    } catch (err) {
      logger.error('Error cerrando pool SQL', err, { component: 'ConnectionPool' });
    }
  }
}

/**
 * Verifica si el pool está conectado
 * @returns {boolean}
 */
function isConnected() {
  return pool && pool.connected;
}

module.exports = {
  getPool,
  executeWithRetry,
  closePool,
  isConnected,
};
