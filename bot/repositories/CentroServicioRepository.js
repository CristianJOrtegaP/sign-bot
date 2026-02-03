/**
 * AC FIXBOT - CentroServicioRepository
 * Repositorio para operaciones de centros de servicio
 * Usado para encontrar el centro más cercano a una ubicación de vehículo
 */

const sql = require('mssql');
const BaseRepository = require('./BaseRepository');
const { logger } = require('../../core/services/infrastructure/errorHandler');

// Cache TTL largo porque los centros de servicio rara vez cambian
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

/**
 * Repositorio de centros de servicio
 */
class CentroServicioRepository extends BaseRepository {
    constructor() {
        super('CentroServicioRepository', CACHE_TTL_MS);
        // No iniciamos cleanup automático porque los datos cambian muy poco
    }

    /**
     * Query base para centros de servicio
     */
    get baseQuery() {
        return `
            SELECT
                CentroServicioId,
                Codigo,
                Nombre,
                Direccion,
                Ciudad,
                Estado,
                CodigoPostal,
                Latitud,
                Longitud,
                Telefono,
                Email,
                HorarioApertura,
                HorarioCierre,
                DiasOperacion
            FROM CentrosServicio
            WHERE Activo = 1
        `;
    }

    /**
     * Obtiene todos los centros de servicio activos
     * @returns {Promise<Array>} - Lista de centros de servicio
     */
    async getAll() {
        const cacheKey = 'all_centros';

        try {
            // Verificar caché
            const cached = this.getFromCache(cacheKey);
            if (cached) {
                this.logOperation('getAll', true, { source: 'cache', count: cached.length });
                return cached;
            }

            const result = await this.executeQuery(async () => {
                const pool = await this.getPool();
                const result = await pool.request()
                    .query(`${this.baseQuery} ORDER BY Nombre`);
                return result.recordset;
            });

            // Guardar en caché
            this.setInCache(cacheKey, result);
            this.logOperation('getAll', true, { source: 'database', count: result.length });

            return result;
        } catch (error) {
            logger.error('Error obteniendo centros de servicio', error);
            return [];
        }
    }

    /**
     * Obtiene un centro de servicio por código
     * @param {string} codigo - Código del centro (ej: 'CS-MTY')
     * @returns {Promise<Object|null>}
     */
    async getByCodigo(codigo) {
        const cacheKey = `codigo_${codigo}`;

        try {
            const cached = this.getFromCache(cacheKey);
            if (cached) {
                return cached;
            }

            const result = await this.executeQuery(async () => {
                const pool = await this.getPool();
                const result = await pool.request()
                    .input('codigo', sql.NVarChar, codigo)
                    .query(`${this.baseQuery} AND Codigo = @codigo`);
                return result.recordset[0] || null;
            });

            if (result) {
                this.setInCache(cacheKey, result);
            }

            return result;
        } catch (error) {
            logger.error('Error obteniendo centro por código', error, { codigo });
            return null;
        }
    }

    /**
     * Obtiene un centro de servicio por ID
     * @param {number} centroId - ID del centro
     * @returns {Promise<Object|null>}
     */
    async getById(centroId) {
        const cacheKey = `id_${centroId}`;

        try {
            const cached = this.getFromCache(cacheKey);
            if (cached) {
                return cached;
            }

            const result = await this.executeQuery(async () => {
                const pool = await this.getPool();
                const result = await pool.request()
                    .input('centroId', sql.Int, centroId)
                    .query(`${this.baseQuery} AND CentroServicioId = @centroId`);
                return result.recordset[0] || null;
            });

            if (result) {
                this.setInCache(cacheKey, result);
            }

            return result;
        } catch (error) {
            logger.error('Error obteniendo centro por ID', error, { centroId });
            return null;
        }
    }

    /**
     * Encuentra el centro de servicio más cercano a una ubicación
     * Usa la fórmula Haversine para calcular distancia esférica
     *
     * @param {number} latitud - Latitud del punto
     * @param {number} longitud - Longitud del punto
     * @returns {Promise<Object|null>} - Centro más cercano con distancia
     */
    async findNearest(latitud, longitud) {
        try {
            const result = await this.executeQuery(async () => {
                const pool = await this.getPool();
                const result = await pool.request()
                    .input('latitud', sql.Decimal(10, 8), latitud)
                    .input('longitud', sql.Decimal(11, 8), longitud)
                    .query(`
                        SELECT TOP 1
                            CentroServicioId,
                            Codigo,
                            Nombre,
                            Direccion,
                            Ciudad,
                            Estado,
                            Latitud,
                            Longitud,
                            Telefono,
                            -- Distancia usando fórmula Haversine (en km)
                            6371 * ACOS(
                                COS(RADIANS(@latitud)) * COS(RADIANS(Latitud)) *
                                COS(RADIANS(Longitud) - RADIANS(@longitud)) +
                                SIN(RADIANS(@latitud)) * SIN(RADIANS(Latitud))
                            ) AS DistanciaKm
                        FROM CentrosServicio
                        WHERE Activo = 1
                        ORDER BY
                            6371 * ACOS(
                                COS(RADIANS(@latitud)) * COS(RADIANS(Latitud)) *
                                COS(RADIANS(Longitud) - RADIANS(@longitud)) +
                                SIN(RADIANS(@latitud)) * SIN(RADIANS(Latitud))
                            )
                    `);
                return result.recordset[0] || null;
            });

            if (result) {
                // Redondear distancia a 1 decimal
                result.DistanciaKm = Math.round(result.DistanciaKm * 10) / 10;

                logger.debug('Centro más cercano encontrado', {
                    centro: result.Codigo,
                    nombre: result.Nombre,
                    distanciaKm: result.DistanciaKm,
                    ubicacionBuscada: { latitud, longitud }
                });
            }

            return result;
        } catch (error) {
            logger.error('Error buscando centro más cercano', error, { latitud, longitud });
            return null;
        }
    }

    /**
     * Obtiene los N centros más cercanos a una ubicación
     * @param {number} latitud - Latitud del punto
     * @param {number} longitud - Longitud del punto
     * @param {number} limit - Cantidad de centros a devolver
     * @returns {Promise<Array>} - Lista de centros ordenados por distancia
     */
    async findNearestMultiple(latitud, longitud, limit = 3) {
        try {
            return await this.executeQuery(async () => {
                const pool = await this.getPool();
                const result = await pool.request()
                    .input('latitud', sql.Decimal(10, 8), latitud)
                    .input('longitud', sql.Decimal(11, 8), longitud)
                    .input('limit', sql.Int, limit)
                    .query(`
                        SELECT TOP (@limit)
                            CentroServicioId,
                            Codigo,
                            Nombre,
                            Ciudad,
                            Estado,
                            Latitud,
                            Longitud,
                            6371 * ACOS(
                                COS(RADIANS(@latitud)) * COS(RADIANS(Latitud)) *
                                COS(RADIANS(Longitud) - RADIANS(@longitud)) +
                                SIN(RADIANS(@latitud)) * SIN(RADIANS(Latitud))
                            ) AS DistanciaKm
                        FROM CentrosServicio
                        WHERE Activo = 1
                        ORDER BY
                            6371 * ACOS(
                                COS(RADIANS(@latitud)) * COS(RADIANS(Latitud)) *
                                COS(RADIANS(Longitud) - RADIANS(@longitud)) +
                                SIN(RADIANS(@latitud)) * SIN(RADIANS(Latitud))
                            )
                    `);

                // Redondear distancias
                return result.recordset.map(centro => ({
                    ...centro,
                    DistanciaKm: Math.round(centro.DistanciaKm * 10) / 10
                }));
            });
        } catch (error) {
            logger.error('Error buscando centros cercanos', error, { latitud, longitud, limit });
            return [];
        }
    }
}

// Singleton
const instance = new CentroServicioRepository();

module.exports = instance;
