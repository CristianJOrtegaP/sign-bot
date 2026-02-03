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
        if (this.cleanupInterval) {return;}

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
     * Obtiene un valor del caché
     * @param {string} key - Clave del caché
     * @returns {any|null} - Valor cacheado o null
     */
    getFromCache(key) {
        const cached = this.cache.get(key);
        if (cached && (Date.now() - cached.timestamp < this.cacheTtlMs)) {
            metrics.recordCacheHit();
            return cached.data;
        }
        metrics.recordCacheMiss();
        return null;
    }

    /**
     * Guarda un valor en el caché
     * @param {string} key - Clave del caché
     * @param {any} data - Datos a cachear
     */
    setInCache(key, data) {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }

    /**
     * Invalida una entrada del caché
     * @param {string} key - Clave a invalidar
     */
    invalidateCache(key) {
        this.cache.delete(key);
    }

    /**
     * Limpia todo el caché
     */
    clearCache() {
        const size = this.cache.size;
        this.cache.clear();
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
            keys: Array.from(this.cache.keys()).slice(0, 10) // Primeras 10 claves
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
