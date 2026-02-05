/**
 * AC FIXBOT - BaseRepository
 * Clase base abstracta para todos los repositorios
 * Define interfaz común y comportamiento compartido
 *
 * @module repositories/BaseRepository
 *
 * ## Arquitectura de Cache
 *
 * El cache utiliza un Map con estructura:
 * ```
 * Map<key, { data: any, timestamp: number }>
 * ```
 *
 * - **TTL**: Configurable por repositorio (default: 5 minutos)
 * - **Limpieza**: Automática mediante interval (default: cada 2 minutos)
 * - **Invalidación**: Manual via invalidateCache() o clearCache()
 *
 * ## Ejemplo de uso
 *
 * ```javascript
 * class MiRepositorio extends BaseRepository {
 *     constructor() {
 *         super('MiRepositorio', 10 * 60 * 1000); // 10 min TTL
 *         this.startCacheCleanup();
 *     }
 *
 *     async getById(id) {
 *         const cached = this.getFromCache(`item_${id}`);
 *         if (cached) return cached;
 *
 *         const data = await this.executeQuery(async () => {
 *             const pool = await this.getPool();
 *             return pool.request().query(`SELECT * FROM Items WHERE Id = ${id}`);
 *         });
 *
 *         this.setInCache(`item_${id}`, data);
 *         return data;
 *     }
 * }
 * ```
 */

const { getPool, executeWithRetry } = require('../../core/services/storage/connectionPool');
const { logger } = require('../../core/services/infrastructure/errorHandler');
const metrics = require('../../core/services/infrastructure/metricsService');
const redisService = require('../../core/services/cache/redisService');
const config = require('../../core/config');

/**
 * @typedef {Object} CacheEntry
 * @property {any} data - Datos cacheados
 * @property {number} timestamp - Timestamp de cuando se cacheo (Date.now())
 */

/**
 * @typedef {Object} CacheStats
 * @property {string} name - Nombre del repositorio
 * @property {number} size - Número de entradas en cache
 * @property {number} ttlMinutes - TTL en minutos
 * @property {string[]} keys - Primeras 10 claves (para debug)
 */

/**
 * Clase base para repositorios
 * Proporciona métodos comunes de caché y acceso a BD
 * @abstract
 */
class BaseRepository {
  /**
   * @param {string} name - Nombre del repositorio (para logging)
   * @param {number} cacheTtlMs - TTL del caché en milisegundos
   */
  constructor(name, cacheTtlMs = 5 * 60 * 1000) {
    this.name = name;
    this.cacheTtlMs = cacheTtlMs;
    this.cache = new Map();
    this.cleanupInterval = null;
  }

  /**
   * Inicia la limpieza automática del caché
   * @param {number} intervalMs - Intervalo de limpieza en ms
   */
  startCacheCleanup(intervalMs = 2 * 60 * 1000) {
    if (this.cleanupInterval) {
      return;
    }

    this.cleanupInterval = setInterval(() => {
      this.cleanExpiredCache();
    }, intervalMs);

    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Detiene la limpieza automática del caché
   */
  stopCacheCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Limpia entradas expiradas del caché
   */
  cleanExpiredCache() {
    const now = Date.now();
    let deleted = 0;

    for (const [key, data] of this.cache.entries()) {
      if (now - data.timestamp > this.cacheTtlMs) {
        this.cache.delete(key);
        deleted++;
      }
    }

    if (deleted > 0) {
      logger.debug(`[${this.name}] Caché limpiado: ${deleted} entradas expiradas`);
    }
  }

  /**
   * Obtiene un valor del caché (síncrono - solo cache local)
   * @param {string} key - Clave del caché
   * @returns {any|null} - Valor cacheado o null
   * @deprecated Usar getFromCacheAsync para soporte de Redis
   */
  getFromCache(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      metrics.recordCacheHit();
      return cached.data;
    }
    metrics.recordCacheMiss();
    return null;
  }

  /**
   * Obtiene un valor del caché (async - Redis con fallback a local)
   * @param {string} key - Clave del caché
   * @returns {Promise<any|null>} - Valor cacheado o null
   */
  async getFromCacheAsync(key) {
    const fullKey = `${this.name}:${key}`;

    // Intentar Redis primero si está habilitado
    if (config.redis.enabled) {
      try {
        const redisValue = await redisService.get(fullKey);
        if (redisValue !== null) {
          metrics.recordCacheHit();
          return redisValue;
        }
      } catch (error) {
        logger.debug(`[${this.name}] Error leyendo de Redis, usando cache local`, {
          error: error.message,
        });
      }
    }

    // Fallback a cache local
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      metrics.recordCacheHit();
      return cached.data;
    }

    metrics.recordCacheMiss();
    return null;
  }

  /**
   * Guarda un valor en el caché (síncrono - solo cache local)
   * @param {string} key - Clave del caché
   * @param {any} data - Datos a cachear
   * @deprecated Usar setInCacheAsync para soporte de Redis
   */
  setInCache(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Guarda un valor en el caché (async - Redis con fallback a local)
   * @param {string} key - Clave del caché
   * @param {any} data - Datos a cachear
   * @returns {Promise<void>}
   */
  async setInCacheAsync(key, data) {
    const fullKey = `${this.name}:${key}`;
    const ttlSeconds = Math.floor(this.cacheTtlMs / 1000);

    // Guardar en cache local siempre (para fallback rápido)
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });

    // Guardar en Redis si está habilitado
    if (config.redis.enabled) {
      try {
        await redisService.set(fullKey, data, ttlSeconds);
      } catch (error) {
        logger.debug(`[${this.name}] Error escribiendo a Redis`, { error: error.message });
        // No falla, el dato está en cache local
      }
    }
  }

  /**
   * Invalida una entrada del caché (síncrono - solo cache local)
   * @param {string} key - Clave a invalidar
   * @deprecated Usar invalidateCacheAsync para soporte de Redis
   */
  invalidateCache(key) {
    this.cache.delete(key);
  }

  /**
   * Invalida una entrada del caché (async - Redis y local)
   * @param {string} key - Clave a invalidar
   * @returns {Promise<void>}
   */
  async invalidateCacheAsync(key) {
    const fullKey = `${this.name}:${key}`;

    // Eliminar de cache local
    this.cache.delete(key);

    // Eliminar de Redis si está habilitado
    if (config.redis.enabled) {
      try {
        await redisService.del(fullKey);
      } catch (error) {
        logger.debug(`[${this.name}] Error eliminando de Redis`, { error: error.message });
      }
    }
  }

  /**
   * Limpia todo el caché (síncrono - solo local)
   * @deprecated Usar clearCacheAsync para soporte de Redis
   */
  clearCache() {
    const size = this.cache.size;
    this.cache.clear();
    logger.info(`[${this.name}] Caché local limpiado`, { entriesDeleted: size });
    return size;
  }

  /**
   * Limpia todo el caché (async - Redis y local)
   * @returns {Promise<number>} - Número de entradas eliminadas del cache local
   */
  async clearCacheAsync() {
    const size = this.cache.size;
    this.cache.clear();

    // Limpiar Redis si está habilitado
    if (config.redis.enabled) {
      try {
        await redisService.delByPattern(`${this.name}:*`);
      } catch (error) {
        logger.debug(`[${this.name}] Error limpiando Redis`, { error: error.message });
      }
    }

    logger.info(`[${this.name}] Caché limpiado completamente`, { entriesDeleted: size });
    return size;
  }

  /**
   * Obtiene estadísticas del caché
   */
  getCacheStats() {
    return {
      name: this.name,
      size: this.cache.size,
      ttlMinutes: this.cacheTtlMs / 60000,
      keys: Array.from(this.cache.keys()).slice(0, 10), // Primeras 10 claves
    };
  }

  /**
   * Ejecuta una query con reintentos
   * @param {Function} queryFn - Función que ejecuta la query
   * @returns {Promise<any>}
   */
  async executeQuery(queryFn) {
    return executeWithRetry(queryFn);
  }

  /**
   * Obtiene el pool de conexiones
   * @returns {Promise<sql.ConnectionPool>}
   */
  async getPool() {
    return getPool();
  }

  /**
   * Helper para logging
   * @param {string} operation - Nombre de la operación
   * @param {boolean} success - Si fue exitosa
   * @param {Object} data - Datos adicionales
   */
  logOperation(operation, success, data = {}) {
    logger.database(`[${this.name}] ${operation}`, success, data);
  }
}

module.exports = BaseRepository;
