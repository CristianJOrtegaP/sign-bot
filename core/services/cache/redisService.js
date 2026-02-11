/**
 * Sign Bot - Redis Cache Service
 * Servicio de cache distribuido con Azure Cache for Redis
 * Incluye fallback automático a cache local (Map) si Redis no está disponible
 *
 * @module services/cache/redisService
 */

const config = require('../../config');
const { logger } = require('../infrastructure/errorHandler');

// ============================================================================
// CACHE LOCAL CON LÍMITE DE MEMORIA (LRU)
// Previene memory leaks cuando Redis no está disponible
// ============================================================================
const MAX_LOCAL_CACHE_ENTRIES = 10000; // Máximo 10,000 entradas
const localCache = new Map();

/**
 * Evicta entradas antiguas cuando el cache excede el límite
 * Usa estrategia LRU simplificada (elimina las primeras entradas insertadas)
 */
function evictIfNeeded() {
  if (localCache.size <= MAX_LOCAL_CACHE_ENTRIES) {
    return;
  }

  // Calcular cuántas entradas eliminar (20% del exceso + buffer)
  const toRemove = Math.ceil((localCache.size - MAX_LOCAL_CACHE_ENTRIES) * 1.2);
  let removed = 0;

  // Map mantiene orden de inserción, eliminamos las más antiguas
  for (const key of localCache.keys()) {
    if (removed >= toRemove) {
      break;
    }
    localCache.delete(key);
    removed++;
  }

  if (removed > 0) {
    logger.warn('[RedisService] Cache local: evictadas entradas por límite de memoria', {
      removed,
      currentSize: localCache.size,
      maxSize: MAX_LOCAL_CACHE_ENTRIES,
    });
  }
}

// Estado de conexión
let redisClient = null;
let isConnected = false;
let isConnecting = false;
let connectionAttempts = 0;
let usingFallback = false;

/**
 * Inicializa el cliente de Redis
 * @returns {Promise<boolean>} - true si la conexión fue exitosa
 */
async function connect() {
  // Si Redis no está habilitado, usar fallback
  if (!config.redis.enabled) {
    logger.info('[RedisService] Redis deshabilitado, usando cache local');
    usingFallback = true;
    return false;
  }

  // Validar configuración
  if (!config.redis.host || !config.redis.password) {
    logger.warn('[RedisService] Configuración de Redis incompleta, usando cache local');
    usingFallback = true;
    return false;
  }

  // Evitar conexiones simultáneas
  if (isConnecting) {
    logger.debug('[RedisService] Conexión en progreso...');
    return false;
  }

  isConnecting = true;

  try {
    // Importar redis dinámicamente (puede no estar instalado)
    const redis = require('redis');

    // Limpiar listeners de conexiones previas para evitar acumulación
    if (redisClient) {
      redisClient.removeAllListeners();
    }

    // Crear cliente con configuración de Azure Redis
    redisClient = redis.createClient({
      socket: {
        host: config.redis.host,
        port: config.redis.port,
        tls: config.redis.tls,
        reconnectStrategy: (retries) => {
          if (retries > config.redis.reconnect.maxRetries) {
            logger.warn('[RedisService] Máximo de reconexiones alcanzado, usando fallback');
            usingFallback = true;
            return false; // Detener reconexión
          }
          const delay = Math.min(retries * config.redis.reconnect.retryDelayMs, 5000);
          return delay;
        },
      },
      password: config.redis.password,
    });

    // Eventos de conexión
    redisClient.on('connect', () => {
      logger.info('[RedisService] Conectando a Azure Redis...');
    });

    redisClient.on('ready', () => {
      isConnected = true;
      usingFallback = false;
      connectionAttempts = 0;
      logger.info('[RedisService] Conexión a Azure Redis establecida');
    });

    redisClient.on('error', (err) => {
      logger.error('[RedisService] Error de Redis', err);
      isConnected = false;
    });

    redisClient.on('end', () => {
      isConnected = false;
      logger.warn('[RedisService] Conexión a Redis cerrada');
    });

    redisClient.on('reconnecting', () => {
      connectionAttempts++;
      logger.info('[RedisService] Reconectando a Redis...', { attempt: connectionAttempts });
    });

    // Conectar
    await redisClient.connect();
    isConnecting = false;
    return true;
  } catch (error) {
    isConnecting = false;

    // Si el módulo redis no está instalado
    if (error.code === 'MODULE_NOT_FOUND') {
      logger.warn('[RedisService] Módulo redis no instalado, usando cache local');
    } else {
      logger.error('[RedisService] Error conectando a Redis, usando fallback', error);
    }

    usingFallback = true;
    return false;
  }
}

/**
 * Construye la key con prefix
 * @param {string} key - Key original
 * @returns {string} - Key con prefix
 */
function buildKey(key) {
  return `${config.redis.keyPrefix}${key}`;
}

/**
 * Obtiene un valor del cache
 * @param {string} key - Clave del cache
 * @returns {Promise<any|null>} - Valor cacheado o null
 */
async function get(key) {
  const fullKey = buildKey(key);

  // Usar Redis si está conectado
  if (isConnected && redisClient && !usingFallback) {
    try {
      const value = await redisClient.get(fullKey);
      if (value) {
        try {
          return JSON.parse(value);
        } catch (parseError) {
          logger.warn('[RedisService] Error parseando valor de cache', {
            key,
            error: parseError.message,
          });
          // Eliminar valor corrupto del cache
          await redisClient.del(fullKey).catch(() => {});
          return null;
        }
      }
      return null;
    } catch (error) {
      logger.warn('[RedisService] Error en GET, usando fallback', { key, error: error.message });
      // Fallback a cache local
    }
  }

  // Fallback: cache local
  const cached = localCache.get(fullKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  // Limpiar si expiró
  if (cached) {
    localCache.delete(fullKey);
  }

  return null;
}

/**
 * Guarda un valor en el cache
 * @param {string} key - Clave del cache
 * @param {any} value - Valor a cachear
 * @param {number} ttlSeconds - TTL en segundos (default desde config)
 * @returns {Promise<boolean>} - true si se guardó correctamente
 */
async function set(key, value, ttlSeconds = config.redis.ttl.default) {
  const fullKey = buildKey(key);
  const serialized = JSON.stringify(value);

  // Usar Redis si está conectado
  if (isConnected && redisClient && !usingFallback) {
    try {
      await redisClient.setEx(fullKey, ttlSeconds, serialized);
      return true;
    } catch (error) {
      logger.warn('[RedisService] Error en SET, usando fallback', { key, error: error.message });
      // Fallback a cache local
    }
  }

  // Fallback: cache local (con límite de memoria)
  evictIfNeeded(); // Prevenir memory leaks
  localCache.set(fullKey, {
    data: value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
  return true;
}

/**
 * Elimina un valor del cache
 * @param {string} key - Clave a eliminar
 * @returns {Promise<boolean>} - true si se eliminó
 */
async function del(key) {
  const fullKey = buildKey(key);

  // Usar Redis si está conectado
  if (isConnected && redisClient && !usingFallback) {
    try {
      await redisClient.del(fullKey);
    } catch (error) {
      logger.warn('[RedisService] Error en DEL', { key, error: error.message });
    }
  }

  // Siempre eliminar del cache local también
  localCache.delete(fullKey);
  return true;
}

/**
 * Elimina todas las claves que coinciden con un patrón
 * @param {string} pattern - Patrón (ej: "session:*")
 * @returns {Promise<number>} - Número de claves eliminadas
 */
async function delByPattern(pattern) {
  const fullPattern = buildKey(pattern);
  let deleted = 0;

  // Usar Redis si está conectado
  if (isConnected && redisClient && !usingFallback) {
    try {
      const keys = await redisClient.keys(fullPattern);
      if (keys.length > 0) {
        deleted = await redisClient.del(keys);
      }
    } catch (error) {
      logger.warn('[RedisService] Error en delByPattern', { pattern, error: error.message });
    }
  }

  // También limpiar cache local
  const regex = new RegExp(`^${fullPattern.replace('*', '.*')}$`);
  for (const key of localCache.keys()) {
    if (regex.test(key)) {
      localCache.delete(key);
      deleted++;
    }
  }

  return deleted;
}

/**
 * Limpia todo el cache (local y Redis)
 * @returns {Promise<void>}
 */
async function clear() {
  // Limpiar cache local
  const localSize = localCache.size;
  localCache.clear();

  // Limpiar Redis (solo keys con nuestro prefix)
  if (isConnected && redisClient && !usingFallback) {
    try {
      const keys = await redisClient.keys(`${config.redis.keyPrefix}*`);
      if (keys.length > 0) {
        await redisClient.del(keys);
        logger.info('[RedisService] Cache Redis limpiado', { keysDeleted: keys.length });
      }
    } catch (error) {
      logger.warn('[RedisService] Error limpiando Redis', { error: error.message });
    }
  }

  logger.info('[RedisService] Cache local limpiado', { entriesDeleted: localSize });
}

/**
 * Obtiene estadísticas del servicio
 * @returns {Object} - Estadísticas
 */
function getStats() {
  return {
    mode: usingFallback ? 'local' : 'redis',
    isConnected,
    usingFallback,
    connectionAttempts,
    localCacheSize: localCache.size,
    localCacheMaxSize: MAX_LOCAL_CACHE_ENTRIES,
    redisEnabled: config.redis.enabled,
    redisHost: config.redis.host ? `${config.redis.host}:${config.redis.port}` : 'not configured',
  };
}

/**
 * Desconecta del servidor Redis
 * @returns {Promise<void>}
 */
async function disconnect() {
  if (redisClient) {
    try {
      await redisClient.quit();
      logger.info('[RedisService] Desconectado de Redis');
    } catch (error) {
      logger.warn('[RedisService] Error desconectando', { error: error.message });
    }
    redisClient = null;
    isConnected = false;
  }
}

/**
 * Verifica si el servicio está usando fallback
 * @returns {boolean}
 */
function isUsingFallback() {
  return usingFallback;
}

/**
 * Limpia entradas expiradas del cache local
 * Llamar periódicamente si se usa fallback por tiempo extendido
 */
function cleanupLocalCache() {
  const now = Date.now();
  let deleted = 0;

  for (const [key, entry] of localCache.entries()) {
    if (now >= entry.expiresAt) {
      localCache.delete(key);
      deleted++;
    }
  }

  if (deleted > 0) {
    logger.debug('[RedisService] Cache local limpiado', { entriesDeleted: deleted });
  }

  return deleted;
}

// Cleanup automático cada 2 minutos
setInterval(cleanupLocalCache, 2 * 60 * 1000).unref();

module.exports = {
  connect,
  get,
  set,
  del,
  delByPattern,
  clear,
  getStats,
  disconnect,
  isUsingFallback,
  cleanupLocalCache,
};
