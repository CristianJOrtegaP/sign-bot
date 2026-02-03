/**
 * AC FIXBOT - ReporteRepository
 * Repositorio para operaciones de reportes de fallas
 * Abstrae el acceso a datos de reportes
 */

const sql = require('mssql');
const BaseRepository = require('./BaseRepository');
const _config = require('../../core/config');
const { logger, DatabaseError } = require('../../core/services/infrastructure/errorHandler');
const { generateTicketNumber } = require('../../core/utils/helpers');
const { TIPO_REPORTE_ID, ESTADO_REPORTE_ID, getEstadoReporteId } = require('../constants/sessionStates');

/**
 * Repositorio de reportes
 */
class ReporteRepository extends BaseRepository {
    constructor() {
        // Reportes no necesitan caché largo (datos de escritura)
        super('ReporteRepository', 1 * 60 * 1000); // 1 minuto
    }

    /**
     * Crea un nuevo reporte de falla para refrigerador
     * @param {number} equipoId - ID del equipo
     * @param {number} clienteId - ID del cliente
     * @param {string} telefono - Teléfono del reportante
     * @param {string} descripcion - Descripción del problema
     * @param {string} imagenUrl - URL de la imagen (opcional)
     * @returns {Promise<string>} - Número de ticket generado
     */
    async createRefrigerador(equipoId, clienteId, telefono, descripcion, imagenUrl = null) {
        try {
            return await this.executeQuery(async () => {
                const pool = await this.getPool();
                const numeroTicket = generateTicketNumber();

                await pool.request()
                    .input('numeroTicket', sql.NVarChar, numeroTicket)
                    .input('equipoId', sql.Int, equipoId)
                    .input('clienteId', sql.Int, clienteId)
                    .input('telefono', sql.NVarChar, telefono)
                    .input('descripcion', sql.NVarChar, descripcion)
                    .input('imagenUrl', sql.NVarChar, imagenUrl)
                    .input('tipoReporteId', sql.Int, TIPO_REPORTE_ID.REFRIGERADOR)
                    .input('estadoReporteId', sql.Int, ESTADO_REPORTE_ID.PENDIENTE)
                    .query(`
                        INSERT INTO Reportes
                        (NumeroTicket, EquipoId, ClienteId, TelefonoReportante, Descripcion, ImagenUrl, TipoReporteId, EstadoReporteId)
                        VALUES
                        (@numeroTicket, @equipoId, @clienteId, @telefono, @descripcion, @imagenUrl, @tipoReporteId, @estadoReporteId)
                    `);

                this.logOperation('createRefrigerador', true, { numeroTicket });
                return numeroTicket;
            });
        } catch (error) {
            logger.error('Error creando reporte de refrigerador', error, { equipoId, clienteId });
            throw new DatabaseError('No se pudo crear el reporte de refrigerador', error, 'createRefrigerador');
        }
    }

    /**
     * Crea un nuevo reporte de falla para vehículo
     * @param {string} codigoSAPVehiculo - Código SAP del vehículo
     * @param {string} numeroEmpleado - Número de empleado del reportante
     * @param {string} telefono - Teléfono del reportante
     * @param {string} descripcion - Descripción del problema
     * @param {string} imagenUrl - URL de la imagen (opcional)
     * @param {Object} ubicacion - Ubicación del vehículo (opcional)
     * @param {number} ubicacion.latitud - Latitud
     * @param {number} ubicacion.longitud - Longitud
     * @param {string} ubicacion.direccion - Dirección (opcional)
     * @param {number} centroServicioId - ID del centro de servicio más cercano (opcional)
     * @param {number} tiempoEstimadoMinutos - Tiempo estimado de llegada en minutos (opcional)
     * @param {number} distanciaCentroKm - Distancia al centro de servicio en km (opcional)
     * @returns {Promise<string>} - Número de ticket generado
     */
    async createVehiculo(codigoSAPVehiculo, numeroEmpleado, telefono, descripcion, imagenUrl = null, ubicacion = null, centroServicioId = null, tiempoEstimadoMinutos = null, distanciaCentroKm = null) {
        try {
            return await this.executeQuery(async () => {
                const pool = await this.getPool();
                const numeroTicket = generateTicketNumber();

                const request = pool.request()
                    .input('numeroTicket', sql.NVarChar, numeroTicket)
                    .input('codigoSAPVehiculo', sql.NVarChar, codigoSAPVehiculo)
                    .input('numeroEmpleado', sql.NVarChar, numeroEmpleado)
                    .input('telefono', sql.NVarChar, telefono)
                    .input('descripcion', sql.NVarChar, descripcion)
                    .input('imagenUrl', sql.NVarChar, imagenUrl)
                    .input('tipoReporteId', sql.Int, TIPO_REPORTE_ID.VEHICULO)
                    .input('estadoReporteId', sql.Int, ESTADO_REPORTE_ID.PENDIENTE);

                // Campos base de la consulta
                let campos = 'NumeroTicket, TelefonoReportante, Descripcion, ImagenUrl, TipoReporteId, CodigoSAPVehiculo, NumeroEmpleado, EstadoReporteId';
                let valores = '@numeroTicket, @telefono, @descripcion, @imagenUrl, @tipoReporteId, @codigoSAPVehiculo, @numeroEmpleado, @estadoReporteId';

                // Agregar ubicación si está disponible
                if (ubicacion) {
                    request
                        .input('latitud', sql.Decimal(10, 8), ubicacion.latitud)
                        .input('longitud', sql.Decimal(11, 8), ubicacion.longitud)
                        .input('direccion', sql.NVarChar, ubicacion.direccion);

                    campos += ', Latitud, Longitud, DireccionUbicacion';
                    valores += ', @latitud, @longitud, @direccion';
                }

                // Agregar centro de servicio y tiempo estimado si están disponibles
                if (centroServicioId !== null) {
                    request.input('centroServicioId', sql.Int, centroServicioId);
                    campos += ', CentroServicioId';
                    valores += ', @centroServicioId';
                }

                if (tiempoEstimadoMinutos !== null) {
                    request.input('tiempoEstimadoMinutos', sql.Int, tiempoEstimadoMinutos);
                    campos += ', TiempoEstimadoMinutos';
                    valores += ', @tiempoEstimadoMinutos';
                }

                if (distanciaCentroKm !== null) {
                    request.input('distanciaCentroKm', sql.Decimal(10, 2), distanciaCentroKm);
                    campos += ', DistanciaCentroKm';
                    valores += ', @distanciaCentroKm';
                }

                await request.query(`
                    INSERT INTO Reportes (${campos})
                    VALUES (${valores})
                `);

                this.logOperation('createVehiculo', true, {
                    numeroTicket,
                    hasUbicacion: Boolean(ubicacion),
                    centroServicioId,
                    tiempoEstimadoMinutos
                });
                return numeroTicket;
            });
        } catch (error) {
            logger.error('Error creando reporte de vehículo', error, { codigoSAPVehiculo, numeroEmpleado });
            throw new DatabaseError('No se pudo crear el reporte de vehículo', error, 'createVehiculo');
        }
    }

    /**
     * Obtiene un reporte por número de ticket
     * @param {string} numeroTicket - Número de ticket
     * @returns {Promise<Object|null>}
     */
    async getByTicket(numeroTicket) {
        try {
            // Verificar caché
            const cached = this.getFromCache(numeroTicket);
            if (cached) {
                return cached;
            }

            const result = await this.executeQuery(async () => {
                const pool = await this.getPool();
                const result = await pool.request()
                    .input('numeroTicket', sql.NVarChar, numeroTicket)
                    .query(`
                        SELECT
                            r.ReporteId,
                            r.NumeroTicket,
                            tr.Codigo as TipoReporte,
                            r.Descripcion,
                            er.Codigo as Estado,
                            er.Nombre as EstadoNombre,
                            er.Emoji as EstadoEmoji,
                            r.FechaCreacion,
                            r.FechaActualizacion,
                            r.TelefonoReportante,
                            r.EquipoId,
                            r.ClienteId,
                            r.CodigoSAPVehiculo,
                            r.NumeroEmpleado,
                            e.CodigoSAP,
                            e.Modelo,
                            c.Nombre as NombreCliente
                        FROM Reportes r
                        INNER JOIN CatTipoReporte tr ON r.TipoReporteId = tr.TipoReporteId
                        INNER JOIN CatEstadoReporte er ON r.EstadoReporteId = er.EstadoReporteId
                        LEFT JOIN Equipos e ON r.EquipoId = e.EquipoId
                        LEFT JOIN Clientes c ON r.ClienteId = c.ClienteId
                        WHERE r.NumeroTicket = @numeroTicket
                    `);
                return result.recordset[0] || null;
            });

            if (result) {
                this.setInCache(numeroTicket, result);
            }

            return result;
        } catch (error) {
            logger.error('Error obteniendo reporte', error, { numeroTicket });
            return null;
        }
    }

    /**
     * Obtiene reportes por teléfono del reportante
     * @param {string} telefono - Teléfono del reportante
     * @param {number} limit - Límite de resultados
     * @returns {Promise<Array>}
     */
    async getByTelefono(telefono, limit = 10) {
        try {
            return await this.executeQuery(async () => {
                const pool = await this.getPool();
                const result = await pool.request()
                    .input('telefono', sql.NVarChar, telefono)
                    .input('limit', sql.Int, limit)
                    .query(`
                        SELECT TOP (@limit)
                            r.NumeroTicket,
                            tr.Codigo as TipoReporte,
                            r.Descripcion,
                            er.Codigo as Estado,
                            er.Nombre as EstadoNombre,
                            er.Emoji as EstadoEmoji,
                            r.FechaCreacion,
                            CASE
                                WHEN tr.Codigo = 'REFRIGERADOR' THEN e.CodigoSAP
                                ELSE r.CodigoSAPVehiculo
                            END as CodigoSAP
                        FROM Reportes r
                        INNER JOIN CatTipoReporte tr ON r.TipoReporteId = tr.TipoReporteId
                        INNER JOIN CatEstadoReporte er ON r.EstadoReporteId = er.EstadoReporteId
                        LEFT JOIN Equipos e ON r.EquipoId = e.EquipoId
                        WHERE r.TelefonoReportante = @telefono
                        ORDER BY r.FechaCreacion DESC
                    `);
                return result.recordset;
            });
        } catch (error) {
            logger.error('Error obteniendo reportes por teléfono', error, { telefono });
            return [];
        }
    }

    /**
     * Actualiza el estado de un reporte
     * @param {string} numeroTicket - Número de ticket
     * @param {string} nuevoEstado - Código del nuevo estado (PENDIENTE, EN_PROCESO, RESUELTO, CANCELADO)
     * @returns {Promise<boolean>}
     */
    async updateEstado(numeroTicket, nuevoEstado) {
        try {
            // Obtener ID del estado
            const estadoId = getEstadoReporteId(nuevoEstado);
            if (!estadoId) {
                logger.warn('Estado de reporte no válido', { nuevoEstado });
                return false;
            }

            await this.executeQuery(async () => {
                const pool = await this.getPool();
                await pool.request()
                    .input('numeroTicket', sql.NVarChar, numeroTicket)
                    .input('estadoId', sql.Int, estadoId)
                    .query(`
                        UPDATE Reportes
                        SET EstadoReporteId = @estadoId,
                            FechaActualizacion = GETDATE()
                        WHERE NumeroTicket = @numeroTicket
                    `);
            });

            // Invalidar caché
            this.invalidateCache(numeroTicket);

            this.logOperation('updateEstado', true, { numeroTicket, nuevoEstado, estadoId });
            return true;
        } catch (error) {
            logger.error('Error actualizando estado de reporte', error, { numeroTicket, nuevoEstado });
            return false;
        }
    }

    /**
     * Resuelve un reporte - actualiza estado a RESUELTO y guarda FechaResolucion
     * Este método es específico para resolver tickets y habilita el envío de encuestas
     * @param {string} numeroTicket - Número de ticket
     * @returns {Promise<boolean>}
     */
    async resolverReporte(numeroTicket) {
        try {
            const estadoId = ESTADO_REPORTE_ID.RESUELTO;

            await this.executeQuery(async () => {
                const pool = await this.getPool();
                await pool.request()
                    .input('numeroTicket', sql.NVarChar, numeroTicket)
                    .input('estadoId', sql.Int, estadoId)
                    .query(`
                        UPDATE Reportes
                        SET EstadoReporteId = @estadoId,
                            FechaResolucion = GETDATE(),
                            FechaActualizacion = GETDATE()
                        WHERE NumeroTicket = @numeroTicket
                    `);
            });

            // Invalidar caché
            this.invalidateCache(numeroTicket);

            this.logOperation('resolverReporte', true, { numeroTicket });
            return true;
        } catch (error) {
            logger.error('Error resolviendo reporte', error, { numeroTicket });
            return false;
        }
    }

    /**
     * Obtiene estadísticas de reportes
     * @param {Date} desde - Fecha desde
     * @param {Date} hasta - Fecha hasta
     * @returns {Promise<Object>}
     */
    async getEstadisticas(desde = null, hasta = null) {
        try {
            return await this.executeQuery(async () => {
                const pool = await this.getPool();
                const request = pool.request();

                let whereClause = '';
                if (desde && hasta) {
                    request.input('desde', sql.DateTime, desde);
                    request.input('hasta', sql.DateTime, hasta);
                    whereClause = 'WHERE r.FechaCreacion BETWEEN @desde AND @hasta';
                }

                const result = await request.query(`
                    SELECT
                        COUNT(*) as Total,
                        SUM(CASE WHEN r.TipoReporteId = 1 THEN 1 ELSE 0 END) as Refrigeradores,
                        SUM(CASE WHEN r.TipoReporteId = 2 THEN 1 ELSE 0 END) as Vehiculos,
                        SUM(CASE WHEN er.Codigo = 'PENDIENTE' THEN 1 ELSE 0 END) as Pendientes,
                        SUM(CASE WHEN er.Codigo = 'EN_PROCESO' THEN 1 ELSE 0 END) as EnProceso,
                        SUM(CASE WHEN er.Codigo = 'RESUELTO' THEN 1 ELSE 0 END) as Resueltos,
                        SUM(CASE WHEN er.Codigo = 'CANCELADO' THEN 1 ELSE 0 END) as Cancelados
                    FROM Reportes r
                    INNER JOIN CatEstadoReporte er ON r.EstadoReporteId = er.EstadoReporteId
                    ${whereClause}
                `);

                return result.recordset[0];
            });
        } catch (error) {
            logger.error('Error obteniendo estadísticas', error);
            return null;
        }
    }
}

// Singleton
const instance = new ReporteRepository();

module.exports = instance;
