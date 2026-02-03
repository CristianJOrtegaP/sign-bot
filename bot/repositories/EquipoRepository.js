/**
 * AC FIXBOT - EquipoRepository
 * Repositorio para operaciones de equipos (refrigeradores)
 * Abstrae el acceso a datos de equipos
 */

const sql = require('mssql');
const BaseRepository = require('./BaseRepository');
const config = require('../../core/config');
const { logger } = require('../../core/services/infrastructure/errorHandler');
const metrics = require('../../core/services/infrastructure/metricsService');

/**
 * Repositorio de equipos
 */
class EquipoRepository extends BaseRepository {
    constructor() {
        super('EquipoRepository', config.database.equipoCache.ttlMs);
        this.startCacheCleanup(config.database.equipoCache.cleanupIntervalMs);
    }

    /**
     * Query base para equipos con datos de cliente
     */
    get baseQuery() {
        return `
            SELECT
                e.EquipoId,
                e.CodigoSAP,
                e.CodigoBarras,
                e.NumeroSerie,
                e.Modelo,
                e.Marca,
                e.Descripcion,
                e.Ubicacion,
                e.ClienteId,
                c.Nombre as NombreCliente,
                c.Direccion as DireccionCliente,
                c.Ciudad as CiudadCliente
            FROM Equipos e
            INNER JOIN Clientes c ON e.ClienteId = c.ClienteId
        `;
    }

    /**
     * Busca un equipo por código SAP con fallback automático
     * @param {string} codigoSAP - Código SAP del equipo
     * @param {boolean} skipCache - Si true, bypasea el caché
     * @returns {Promise<Object|null>} - Datos del equipo o null
     */
    async getBySAP(codigoSAP, skipCache = false) {
        const timer = metrics.startTimer('db_getEquipoBySAP');

        try {
            // Verificar caché (solo si no se pide skipCache)
            if (!skipCache) {
                const cached = this.cache.get(codigoSAP);
                if (cached && (Date.now() - cached.timestamp < this.cacheTtlMs)) {
                    // FALLBACK: Si el caché tiene un resultado positivo, usarlo
                    if (cached.data !== null) {
                        this.logOperation('getBySAP', true, { source: 'cache', codigoSAP });
                        metrics.recordCacheHit();
                        timer.end({ source: 'cache', codigoSAP, found: true });
                        return cached.data;
                    }

                    // FALLBACK: Si el caché dice "null", NO confiar en él
                    // Siempre verificar en BD para evitar falsos negativos
                    logger.warn(`Caché indica equipo NO encontrado para ${codigoSAP}. Verificando en BD...`);
                    this.cache.delete(codigoSAP);
                }
            }

            metrics.recordCacheMiss();

            // Buscar en BD
            const result = await this.executeQuery(async () => {
                const pool = await this.getPool();
                const result = await pool.request()
                    .input('codigo', sql.NVarChar, codigoSAP)
                    .query(`${this.baseQuery} WHERE e.CodigoSAP = @codigo AND e.Activo = 1`);
                return result.recordset[0] || null;
            });

            // Guardar en caché
            this.setInCache(codigoSAP, result);

            timer.end({ source: 'database', codigoSAP, found: Boolean(result) });
            return result;
        } catch (error) {
            logger.error('Error buscando equipo', error, { codigoSAP, operation: 'getBySAP' });
            metrics.recordError('db_getEquipoBySAP_error', error.message);
            timer.end({ error: true });
            return null;
        }
    }

    /**
     * Busca un equipo por ID
     * @param {number} equipoId - ID del equipo
     * @returns {Promise<Object|null>} - Datos del equipo o null
     */
    async getById(equipoId) {
        const cacheKey = `id_${equipoId}`;

        try {
            // Verificar caché
            const cached = this.getFromCache(cacheKey);
            if (cached) {
                return cached;
            }

            const result = await this.executeQuery(async () => {
                const pool = await this.getPool();
                const result = await pool.request()
                    .input('equipoId', sql.Int, equipoId)
                    .query(`${this.baseQuery} WHERE e.EquipoId = @equipoId AND e.Activo = 1`);
                return result.recordset[0] || null;
            });

            if (result) {
                this.setInCache(cacheKey, result);
                // También cachear por SAP para búsquedas cruzadas
                this.setInCache(result.CodigoSAP, result);
            }

            return result;
        } catch (error) {
            logger.error('Error buscando equipo por ID', error, { equipoId, operation: 'getById' });
            return null;
        }
    }

    /**
     * Busca un equipo por código de barras
     * @param {string} codigoBarras - Código de barras del equipo
     * @returns {Promise<Object|null>} - Datos del equipo o null
     */
    async getByCodigoBarras(codigoBarras) {
        const cacheKey = `barras_${codigoBarras}`;

        try {
            const cached = this.getFromCache(cacheKey);
            if (cached) {
                return cached;
            }

            const result = await this.executeQuery(async () => {
                const pool = await this.getPool();
                const result = await pool.request()
                    .input('codigoBarras', sql.NVarChar, codigoBarras)
                    .query(`${this.baseQuery} WHERE e.CodigoBarras = @codigoBarras AND e.Activo = 1`);
                return result.recordset[0] || null;
            });

            if (result) {
                this.setInCache(cacheKey, result);
                this.setInCache(result.CodigoSAP, result);
            }

            return result;
        } catch (error) {
            logger.error('Error buscando equipo por código de barras', error, { codigoBarras });
            return null;
        }
    }

    /**
     * Busca equipos por cliente
     * @param {number} clienteId - ID del cliente
     * @param {number} limit - Límite de resultados
     * @returns {Promise<Array>} - Lista de equipos
     */
    async getByCliente(clienteId, limit = 100) {
        try {
            return await this.executeQuery(async () => {
                const pool = await this.getPool();
                const result = await pool.request()
                    .input('clienteId', sql.Int, clienteId)
                    .input('limit', sql.Int, limit)
                    .query(`
                        SELECT TOP (@limit)
                            e.EquipoId,
                            e.CodigoSAP,
                            e.Modelo,
                            e.Marca,
                            e.Ubicacion
                        FROM Equipos e
                        WHERE e.ClienteId = @clienteId AND e.Activo = 1
                        ORDER BY e.CodigoSAP
                    `);
                return result.recordset;
            });
        } catch (error) {
            logger.error('Error buscando equipos por cliente', error, { clienteId });
            return [];
        }
    }

    /**
     * Busca equipos que coincidan con un patrón de SAP
     * Útil para autocompletado o búsqueda parcial
     * @param {string} pattern - Patrón de búsqueda
     * @param {number} limit - Límite de resultados
     * @returns {Promise<Array>}
     */
    async searchBySAP(pattern, limit = 10) {
        try {
            return await this.executeQuery(async () => {
                const pool = await this.getPool();
                const result = await pool.request()
                    .input('pattern', sql.NVarChar, `${pattern}%`)
                    .input('limit', sql.Int, limit)
                    .query(`
                        SELECT TOP (@limit)
                            e.EquipoId,
                            e.CodigoSAP,
                            e.Modelo,
                            e.Marca,
                            c.Nombre as NombreCliente
                        FROM Equipos e
                        INNER JOIN Clientes c ON e.ClienteId = c.ClienteId
                        WHERE e.CodigoSAP LIKE @pattern AND e.Activo = 1
                        ORDER BY e.CodigoSAP
                    `);
                return result.recordset;
            });
        } catch (error) {
            logger.error('Error buscando equipos por patrón', error, { pattern });
            return [];
        }
    }
}

// Singleton
const instance = new EquipoRepository();

module.exports = instance;
