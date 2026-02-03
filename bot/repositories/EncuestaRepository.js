/**
 * AC FIXBOT - EncuestaRepository
 * Repositorio para operaciones de encuestas de satisfaccion
 *
 * v2.0 - Soporte para estructura normalizada:
 * - CatEstadoEncuesta: Estados normalizados
 * - CatTipoEncuesta: Tipos de encuesta configurables
 * - PreguntasEncuesta: Preguntas dinámicas por tipo
 * - RespuestasEncuesta: Respuestas normalizadas
 */

const sql = require('mssql');
const BaseRepository = require('./BaseRepository');
const { logger, DatabaseError } = require('../../core/services/infrastructure/errorHandler');

// Cache de preguntas (no cambian frecuentemente)
let preguntasCache = null;
let preguntasCacheTimestamp = 0;
const PREGUNTAS_CACHE_TTL = 30 * 60 * 1000; // 30 minutos

// Cache de tipos de encuesta
let tiposEncuestaCache = null;
let tiposCacheTimestamp = 0;
const TIPOS_CACHE_TTL = 30 * 60 * 1000; // 30 minutos

// Cache de estados de encuesta
let estadosEncuestaCache = null;
let estadosCacheTimestamp = 0;
const ESTADOS_CACHE_TTL = 60 * 60 * 1000; // 1 hora

class EncuestaRepository extends BaseRepository {
    constructor() {
        super('EncuestaRepository', 1 * 60 * 1000); // 1 minuto cache
    }

    // ============================================
    // MÉTODOS PARA CATÁLOGOS NORMALIZADOS
    // ============================================

    /**
     * Obtiene todos los tipos de encuesta disponibles
     * @param {boolean} skipCache - Si true, bypasea el caché
     * @returns {Promise<Array>}
     */
    async getTiposEncuesta(skipCache = false) {
        const now = Date.now();
        if (!skipCache && tiposEncuestaCache && (now - tiposCacheTimestamp) < TIPOS_CACHE_TTL) {
            return tiposEncuestaCache;
        }

        try {
            const result = await this.executeQuery(async () => {
                const pool = await this.getPool();
                const res = await pool.request().query(`
                    SELECT
                        TipoEncuestaId,
                        Codigo,
                        Nombre,
                        Descripcion,
                        NumeroPreguntas,
                        TienePasoComentario,
                        MensajeInvitacion,
                        MensajeAgradecimiento,
                        Activo
                    FROM CatTipoEncuesta
                    WHERE Activo = 1
                    ORDER BY TipoEncuestaId
                `);
                return res.recordset;
            });

            tiposEncuestaCache = result;
            tiposCacheTimestamp = now;
            return result;
        } catch (error) {
            logger.error('Error obteniendo tipos de encuesta', error);
            return tiposEncuestaCache || [];
        }
    }

    /**
     * Obtiene un tipo de encuesta por código
     * @param {string} codigo - Código del tipo (ej: 'SATISFACCION_SERVICIO')
     * @returns {Promise<Object|null>}
     */
    async getTipoEncuestaByCodigo(codigo) {
        const tipos = await this.getTiposEncuesta();
        return tipos.find(t => t.Codigo === codigo) || null;
    }

    /**
     * Obtiene todos los estados de encuesta
     * @param {boolean} skipCache - Si true, bypasea el caché
     * @returns {Promise<Array>}
     */
    async getEstadosEncuesta(skipCache = false) {
        const now = Date.now();
        if (!skipCache && estadosEncuestaCache && (now - estadosCacheTimestamp) < ESTADOS_CACHE_TTL) {
            return estadosEncuestaCache;
        }

        try {
            const result = await this.executeQuery(async () => {
                const pool = await this.getPool();
                const res = await pool.request().query(`
                    SELECT
                        EstadoEncuestaId,
                        Codigo,
                        Nombre,
                        Descripcion,
                        EsFinal,
                        Orden
                    FROM CatEstadoEncuesta
                    WHERE Activo = 1
                    ORDER BY Orden
                `);
                return res.recordset;
            });

            estadosEncuestaCache = result;
            estadosCacheTimestamp = now;
            return result;
        } catch (error) {
            logger.error('Error obteniendo estados de encuesta', error);
            return estadosEncuestaCache || [];
        }
    }

    /**
     * Obtiene el ID de un estado por código
     * @param {string} codigo - Código del estado (ej: 'ENVIADA', 'EN_PROCESO')
     * @returns {Promise<number|null>}
     */
    async getEstadoIdByCodigo(codigo) {
        const estados = await this.getEstadosEncuesta();
        const estado = estados.find(e => e.Codigo === codigo);
        return estado?.EstadoEncuestaId || null;
    }

    /**
     * Obtiene las preguntas de un tipo de encuesta
     * @param {number} tipoEncuestaId - ID del tipo de encuesta
     * @param {boolean} skipCache - Si true, bypasea el caché
     * @returns {Promise<Array>}
     */
    async getPreguntasByTipo(tipoEncuestaId, skipCache = false) {
        const now = Date.now();
        const cacheKey = `tipo_${tipoEncuestaId}`;

        if (!skipCache && preguntasCache?.[cacheKey] && (now - preguntasCacheTimestamp) < PREGUNTAS_CACHE_TTL) {
            return preguntasCache[cacheKey];
        }

        try {
            const result = await this.executeQuery(async () => {
                const pool = await this.getPool();
                const res = await pool.request()
                    .input('tipoEncuestaId', sql.Int, tipoEncuestaId)
                    .query(`
                        SELECT
                            PreguntaId,
                            TipoEncuestaId,
                            NumeroPregunta,
                            TextoPregunta,
                            TextoCorto,
                            ValorMinimo,
                            ValorMaximo,
                            EtiquetaMinimo,
                            EtiquetaMaximo,
                            Orden
                        FROM PreguntasEncuesta
                        WHERE TipoEncuestaId = @tipoEncuestaId
                          AND Activo = 1
                        ORDER BY Orden
                    `);
                return res.recordset;
            });

            if (!preguntasCache) {preguntasCache = {};}
            preguntasCache[cacheKey] = result;
            preguntasCacheTimestamp = now;

            this.logOperation('getPreguntasByTipo', true, { tipoEncuestaId, count: result.length });
            return result;
        } catch (error) {
            logger.error('Error obteniendo preguntas de encuesta', error, { tipoEncuestaId });
            return preguntasCache?.[cacheKey] || [];
        }
    }

    /**
     * Obtiene las preguntas del tipo de encuesta por defecto (SATISFACCION_SERVICIO)
     * @returns {Promise<Array>}
     */
    async getPreguntasDefault() {
        const tipo = await this.getTipoEncuestaByCodigo('SATISFACCION_SERVICIO');
        if (!tipo) {
            logger.warn('Tipo de encuesta SATISFACCION_SERVICIO no encontrado');
            return [];
        }
        return this.getPreguntasByTipo(tipo.TipoEncuestaId);
    }

    /**
     * Obtiene una pregunta específica por número
     * @param {number} tipoEncuestaId - ID del tipo de encuesta
     * @param {number} numeroPregunta - Número de pregunta (1-based)
     * @returns {Promise<Object|null>}
     */
    async getPreguntaByNumero(tipoEncuestaId, numeroPregunta) {
        const preguntas = await this.getPreguntasByTipo(tipoEncuestaId);
        return preguntas.find(p => p.NumeroPregunta === numeroPregunta) || null;
    }

    /**
     * Limpia los cachés de catálogos
     */
    clearCatalogosCache() {
        preguntasCache = null;
        preguntasCacheTimestamp = 0;
        tiposEncuestaCache = null;
        tiposCacheTimestamp = 0;
        estadosEncuestaCache = null;
        estadosCacheTimestamp = 0;
        logger.info('[EncuestaRepository] Cachés de catálogos limpiados');
    }

    /**
     * Obtiene reportes resueltos que no tienen encuesta enviada
     * @param {number} minutosMinimasResolucion - Minutos minimos desde resolucion
     * @returns {Promise<Array>}
     */
    async getReportesPendientesEncuesta(minutosMinimasResolucion = 1440) {
        try {
            return await this.executeQuery(async () => {
                const pool = await this.getPool();
                const result = await pool.request()
                    .input('MinutosMinimasResolucion', sql.Int, minutosMinimasResolucion)
                    .execute('sp_GetReportesPendientesEncuesta');

                this.logOperation('getReportesPendientesEncuesta', true, {
                    count: result.recordset.length
                });

                return result.recordset;
            });
        } catch (error) {
            logger.error('Error obteniendo reportes pendientes de encuesta', error);
            return [];
        }
    }

    /**
     * Crea una nueva encuesta para un reporte (versión normalizada)
     * @param {number} reporteId - ID del reporte
     * @param {string} telefono - Telefono del encuestado
     * @param {string} tipoEncuestaCodigo - Código del tipo de encuesta (default: 'SATISFACCION_SERVICIO')
     * @returns {Promise<{encuestaId: number, tipoEncuesta: Object, preguntas: Array}|null>}
     */
    async create(reporteId, telefono, tipoEncuestaCodigo = 'SATISFACCION_SERVICIO') {
        try {
            // Obtener tipo de encuesta y estado inicial
            const tipoEncuesta = await this.getTipoEncuestaByCodigo(tipoEncuestaCodigo);
            if (!tipoEncuesta) {
                logger.error('Tipo de encuesta no encontrado', { tipoEncuestaCodigo });
                throw new DatabaseError(`Tipo de encuesta '${tipoEncuestaCodigo}' no encontrado`, null, 'create');
            }

            const estadoEnviadaId = await this.getEstadoIdByCodigo('ENVIADA');

            return await this.executeQuery(async () => {
                const pool = await this.getPool();
                const result = await pool.request()
                    .input('reporteId', sql.Int, reporteId)
                    .input('telefono', sql.NVarChar, telefono)
                    .input('tipoEncuestaId', sql.Int, tipoEncuesta.TipoEncuestaId)
                    .input('estadoEncuestaId', sql.Int, estadoEnviadaId)
                    .query(`
                        INSERT INTO Encuestas (
                            ReporteId,
                            TelefonoEncuestado,
                            TipoEncuestaId,
                            EstadoEncuestaId,
                            Estado
                        )
                        OUTPUT INSERTED.EncuestaId
                        VALUES (
                            @reporteId,
                            @telefono,
                            @tipoEncuestaId,
                            @estadoEncuestaId,
                            'ENVIADA'
                        )
                    `);

                const encuestaId = result.recordset[0].EncuestaId;

                // Obtener preguntas para esta encuesta
                const preguntas = await this.getPreguntasByTipo(tipoEncuesta.TipoEncuestaId);

                this.logOperation('create', true, {
                    reporteId,
                    telefono,
                    encuestaId,
                    tipoEncuesta: tipoEncuestaCodigo,
                    numPreguntas: preguntas.length
                });

                return {
                    encuestaId,
                    tipoEncuesta,
                    preguntas
                };
            });
        } catch (error) {
            // Si es error de duplicado (UNIQUE constraint), retornar null
            if (error.number === 2601 || error.number === 2627) {
                logger.warn('Encuesta ya existe para reporte', { reporteId });
                return null;
            }
            logger.error('Error creando encuesta', error, { reporteId });
            throw new DatabaseError('No se pudo crear la encuesta', error, 'create');
        }
    }

    /**
     * Obtiene encuesta por ID
     * @param {number} encuestaId - ID de la encuesta
     * @returns {Promise<Object|null>}
     */
    async getById(encuestaId) {
        try {
            return await this.executeQuery(async () => {
                const pool = await this.getPool();
                const result = await pool.request()
                    .input('encuestaId', sql.Int, encuestaId)
                    .query(`
                        SELECT
                            e.*,
                            r.NumeroTicket,
                            r.Descripcion AS DescripcionReporte
                        FROM Encuestas e
                        INNER JOIN Reportes r ON e.ReporteId = r.ReporteId
                        WHERE e.EncuestaId = @encuestaId
                    `);
                return result.recordset[0] || null;
            });
        } catch (error) {
            logger.error('Error obteniendo encuesta por ID', error, { encuestaId });
            return null;
        }
    }

    /**
     * Obtiene encuesta activa por telefono
     * @param {string} telefono - Numero de telefono
     * @returns {Promise<Object|null>}
     */
    async getActivaByTelefono(telefono) {
        try {
            return await this.executeQuery(async () => {
                const pool = await this.getPool();
                const result = await pool.request()
                    .input('telefono', sql.NVarChar, telefono)
                    .query(`
                        SELECT TOP 1
                            e.*,
                            r.NumeroTicket,
                            r.Descripcion AS DescripcionReporte
                        FROM Encuestas e
                        INNER JOIN Reportes r ON e.ReporteId = r.ReporteId
                        WHERE e.TelefonoEncuestado = @telefono
                          AND e.Estado IN ('ENVIADA', 'EN_PROCESO')
                        ORDER BY e.FechaEnvio DESC
                    `);
                return result.recordset[0] || null;
            });
        } catch (error) {
            logger.error('Error obteniendo encuesta activa', error, { telefono });
            return null;
        }
    }

    /**
     * Actualiza el estado de una encuesta (versión normalizada)
     * @param {number} encuestaId - ID de la encuesta
     * @param {string} estado - Nuevo estado (ENVIADA, EN_PROCESO, COMPLETADA, RECHAZADA, EXPIRADA)
     * @returns {Promise<boolean>}
     */
    async updateEstado(encuestaId, estado) {
        try {
            // Obtener el ID del estado normalizado
            const estadoId = await this.getEstadoIdByCodigo(estado);

            await this.executeQuery(async () => {
                const pool = await this.getPool();

                // Si es EN_PROCESO, también eliminar respuestas anteriores de RespuestasEncuesta
                if (estado === 'EN_PROCESO') {
                    await pool.request()
                        .input('encuestaId', sql.Int, encuestaId)
                        .query(`DELETE FROM RespuestasEncuesta WHERE EncuestaId = @encuestaId`);
                }

                await pool.request()
                    .input('encuestaId', sql.Int, encuestaId)
                    .input('estado', sql.NVarChar, estado)
                    .input('estadoId', sql.Int, estadoId)
                    .query(`
                        UPDATE Encuestas
                        SET Estado = @estado,
                            EstadoEncuestaId = @estadoId,
                            FechaActualizacion = GETDATE(),
                            FechaInicio = CASE
                                WHEN @estado = 'EN_PROCESO' AND FechaInicio IS NULL
                                THEN GETDATE()
                                ELSE FechaInicio
                            END,
                            FechaFinalizacion = CASE
                                WHEN @estado IN ('COMPLETADA', 'RECHAZADA', 'EXPIRADA')
                                THEN GETDATE()
                                ELSE FechaFinalizacion
                            END,
                            -- Resetear PreguntaActual y respuestas cuando se inicia la encuesta
                            PreguntaActual = CASE
                                WHEN @estado = 'EN_PROCESO'
                                THEN 0
                                ELSE PreguntaActual
                            END,
                            -- Mantener retrocompatibilidad con columnas legacy
                            Pregunta1 = CASE WHEN @estado = 'EN_PROCESO' THEN NULL ELSE Pregunta1 END,
                            Pregunta2 = CASE WHEN @estado = 'EN_PROCESO' THEN NULL ELSE Pregunta2 END,
                            Pregunta3 = CASE WHEN @estado = 'EN_PROCESO' THEN NULL ELSE Pregunta3 END,
                            Pregunta4 = CASE WHEN @estado = 'EN_PROCESO' THEN NULL ELSE Pregunta4 END,
                            Pregunta5 = CASE WHEN @estado = 'EN_PROCESO' THEN NULL ELSE Pregunta5 END,
                            Pregunta6 = CASE WHEN @estado = 'EN_PROCESO' THEN NULL ELSE Pregunta6 END,
                            Comentario = CASE WHEN @estado = 'EN_PROCESO' THEN NULL ELSE Comentario END,
                            TieneComentario = CASE WHEN @estado = 'EN_PROCESO' THEN NULL ELSE TieneComentario END
                        WHERE EncuestaId = @encuestaId
                    `);
            });

            this.logOperation('updateEstado', true, { encuestaId, estado, estadoId });
            return true;
        } catch (error) {
            logger.error('Error actualizando estado de encuesta', error, { encuestaId, estado });
            return false;
        }
    }

    /**
     * Guarda respuesta de una pregunta de forma ATÓMICA
     * Usa PreguntaActual para evitar race conditions - solo actualiza si es la pregunta esperada
     * @param {number} encuestaId - ID de la encuesta
     * @param {number} numeroPregunta - Numero de pregunta (1-6)
     * @param {number} respuesta - Valor de respuesta (1-5)
     * @returns {Promise<{success: boolean, alreadyAnswered: boolean}>}
     */
    async guardarRespuesta(encuestaId, numeroPregunta, respuesta) {
        if (numeroPregunta < 1 || numeroPregunta > 6) {
            logger.warn('Numero de pregunta invalido', { encuestaId, numeroPregunta });
            return { success: false, alreadyAnswered: false };
        }

        if (respuesta < 1 || respuesta > 5) {
            logger.warn('Respuesta invalida', { encuestaId, respuesta });
            return { success: false, alreadyAnswered: false };
        }

        try {
            const result = await this.executeQuery(async () => {
                const pool = await this.getPool();
                const columna = `Pregunta${numeroPregunta}`;
                const preguntaAnteriorEsperada = numeroPregunta - 1; // 0 para pregunta 1

                // UPDATE ATÓMICO: solo actualiza si PreguntaActual es la esperada
                // Esto evita race conditions cuando llegan múltiples webhooks
                const updateResult = await pool.request()
                    .input('encuestaId', sql.Int, encuestaId)
                    .input('respuesta', sql.TinyInt, respuesta)
                    .input('preguntaActual', sql.TinyInt, numeroPregunta)
                    .input('preguntaAnterior', sql.TinyInt, preguntaAnteriorEsperada)
                    .query(`
                        UPDATE Encuestas
                        SET ${columna} = @respuesta,
                            PreguntaActual = @preguntaActual,
                            FechaActualizacion = GETDATE()
                        WHERE EncuestaId = @encuestaId
                          AND (PreguntaActual = @preguntaAnterior OR PreguntaActual IS NULL)
                    `);

                return updateResult.rowsAffected[0];
            });

            if (result > 0) {
                this.logOperation('guardarRespuesta', true, { encuestaId, numeroPregunta, respuesta });
                return { success: true, alreadyAnswered: false };
            } 
                // La pregunta ya fue respondida (otro webhook la procesó primero)
                logger.warn('Pregunta ya respondida (race condition evitada)', {
                    encuestaId,
                    numeroPregunta,
                    respuesta
                });
                return { success: false, alreadyAnswered: true };
            
        } catch (error) {
            logger.error('Error guardando respuesta', error, { encuestaId, numeroPregunta });
            return { success: false, alreadyAnswered: false };
        }
    }

    /**
     * Obtiene la pregunta actual de una encuesta (source of truth)
     * @param {number} encuestaId - ID de la encuesta
     * @returns {Promise<number|null>} - Número de última pregunta respondida (0 = ninguna)
     */
    async getPreguntaActual(encuestaId) {
        try {
            return await this.executeQuery(async () => {
                const pool = await this.getPool();
                const result = await pool.request()
                    .input('encuestaId', sql.Int, encuestaId)
                    .query(`
                        SELECT PreguntaActual
                        FROM Encuestas
                        WHERE EncuestaId = @encuestaId
                    `);
                return result.recordset[0]?.PreguntaActual ?? 0;
            });
        } catch (error) {
            logger.error('Error obteniendo pregunta actual', error, { encuestaId });
            return null;
        }
    }

    /**
     * Guarda el comentario final y marca como completada (versión normalizada)
     * @param {number} encuestaId - ID de la encuesta
     * @param {string} comentario - Texto del comentario
     * @returns {Promise<boolean>}
     */
    async guardarComentario(encuestaId, comentario) {
        try {
            const estadoCompletadaId = await this.getEstadoIdByCodigo('COMPLETADA');

            await this.executeQuery(async () => {
                const pool = await this.getPool();
                await pool.request()
                    .input('encuestaId', sql.Int, encuestaId)
                    .input('comentario', sql.NVarChar, comentario?.substring(0, 1000))
                    .input('estadoId', sql.Int, estadoCompletadaId)
                    .query(`
                        UPDATE Encuestas
                        SET TieneComentario = 1,
                            Comentario = @comentario,
                            Estado = 'COMPLETADA',
                            EstadoEncuestaId = @estadoId,
                            PreguntaActual = 7,
                            FechaFinalizacion = GETDATE(),
                            FechaActualizacion = GETDATE()
                        WHERE EncuestaId = @encuestaId
                    `);
            });

            this.logOperation('guardarComentario', true, { encuestaId });
            return true;
        } catch (error) {
            logger.error('Error guardando comentario', error, { encuestaId });
            return false;
        }
    }

    /**
     * Finaliza encuesta sin comentario (versión normalizada)
     * @param {number} encuestaId - ID de la encuesta
     * @returns {Promise<boolean>}
     */
    async finalizarSinComentario(encuestaId) {
        try {
            const estadoCompletadaId = await this.getEstadoIdByCodigo('COMPLETADA');

            await this.executeQuery(async () => {
                const pool = await this.getPool();
                await pool.request()
                    .input('encuestaId', sql.Int, encuestaId)
                    .input('estadoId', sql.Int, estadoCompletadaId)
                    .query(`
                        UPDATE Encuestas
                        SET TieneComentario = 0,
                            Estado = 'COMPLETADA',
                            EstadoEncuestaId = @estadoId,
                            PreguntaActual = 7,
                            FechaFinalizacion = GETDATE(),
                            FechaActualizacion = GETDATE()
                        WHERE EncuestaId = @encuestaId
                    `);
            });

            this.logOperation('finalizarSinComentario', true, { encuestaId });
            return true;
        } catch (error) {
            logger.error('Error finalizando encuesta', error, { encuestaId });
            return false;
        }
    }

    // ============================================
    // MÉTODOS PARA RESPUESTAS NORMALIZADAS
    // ============================================

    /**
     * Obtiene todas las respuestas de una encuesta desde la tabla normalizada
     * @param {number} encuestaId - ID de la encuesta
     * @returns {Promise<Array>} - Array de {NumeroPregunta, TextoCorto, TextoPregunta, Valor, FechaRespuesta}
     */
    async getRespuestasEncuesta(encuestaId) {
        try {
            return await this.executeQuery(async () => {
                const pool = await this.getPool();
                const result = await pool.request()
                    .input('encuestaId', sql.Int, encuestaId)
                    .query(`
                        SELECT
                            p.NumeroPregunta,
                            p.TextoCorto,
                            p.TextoPregunta,
                            r.Valor,
                            r.FechaRespuesta
                        FROM RespuestasEncuesta r
                        INNER JOIN PreguntasEncuesta p ON r.PreguntaId = p.PreguntaId
                        WHERE r.EncuestaId = @encuestaId
                        ORDER BY p.Orden
                    `);
                return result.recordset;
            });
        } catch (error) {
            logger.error('Error obteniendo respuestas de encuesta', error, { encuestaId });
            return [];
        }
    }

    /**
     * Obtiene el promedio de respuestas de una encuesta
     * @param {number} encuestaId - ID de la encuesta
     * @returns {Promise<number|null>}
     */
    async getPromedioEncuesta(encuestaId) {
        try {
            return await this.executeQuery(async () => {
                const pool = await this.getPool();
                const result = await pool.request()
                    .input('encuestaId', sql.Int, encuestaId)
                    .query(`
                        SELECT AVG(CAST(Valor AS DECIMAL(5,2))) AS Promedio
                        FROM RespuestasEncuesta
                        WHERE EncuestaId = @encuestaId
                    `);
                return result.recordset[0]?.Promedio || null;
            });
        } catch (error) {
            logger.error('Error obteniendo promedio de encuesta', error, { encuestaId });
            return null;
        }
    }

    /**
     * Verifica si un reporte ya tiene encuesta
     * @param {number} reporteId - ID del reporte
     * @returns {Promise<boolean>}
     */
    async tieneEncuesta(reporteId) {
        try {
            return await this.executeQuery(async () => {
                const pool = await this.getPool();
                const result = await pool.request()
                    .input('reporteId', sql.Int, reporteId)
                    .query(`
                        SELECT COUNT(*) AS count
                        FROM Encuestas
                        WHERE ReporteId = @reporteId
                    `);
                return result.recordset[0].count > 0;
            });
        } catch (error) {
            logger.error('Error verificando encuesta de reporte', error, { reporteId });
            return false;
        }
    }

    /**
     * Obtiene estadisticas de encuestas
     * @param {Date} desde - Fecha inicio
     * @param {Date} hasta - Fecha fin
     * @returns {Promise<Object>}
     */
    async getEstadisticas(desde = null, hasta = null) {
        try {
            return await this.executeQuery(async () => {
                const pool = await this.getPool();
                const request = pool.request();

                if (desde) {request.input('desde', sql.DateTime, desde);}
                if (hasta) {request.input('hasta', sql.DateTime, hasta);}

                const result = await request.execute('sp_GetEstadisticasEncuestas');

                return {
                    resumen: result.recordsets[0]?.[0] || {},
                    promedios: result.recordsets[1] || [],
                    promedioGeneral: result.recordsets[2]?.[0]?.PromedioGeneral || null
                };
            });
        } catch (error) {
            logger.error('Error obteniendo estadisticas de encuestas', error);
            return { resumen: {}, promedios: [], promedioGeneral: null };
        }
    }

    /**
     * Expira encuestas sin respuesta despues de un tiempo
     * @param {number} horasExpiracion - Horas para expirar
     * @returns {Promise<number>} - Cantidad de encuestas expiradas
     */
    async expirarSinRespuesta(horasExpiracion = 72) {
        try {
            return await this.executeQuery(async () => {
                const pool = await this.getPool();
                const result = await pool.request()
                    .input('horasExpiracion', sql.Int, horasExpiracion)
                    .execute('sp_ExpirarEncuestasSinRespuesta');

                const expiradas = result.recordset[0]?.EncuestasExpiradas || 0;
                this.logOperation('expirarSinRespuesta', true, { expiradas });
                return expiradas;
            });
        } catch (error) {
            logger.error('Error expirando encuestas', error);
            return 0;
        }
    }

    // ============================================
    // MÉTODOS OPTIMIZADOS PARA REDUCIR QUERIES
    // ============================================

    /**
     * Obtiene encuesta activa con todos los datos necesarios (versión normalizada)
     * Incluye: EncuestaId, ReporteId, NumeroTicket, PreguntaActual, Estado, TipoEncuesta, NumeroPreguntas
     * @param {string} telefono - Numero de telefono
     * @param {boolean} incluirPreguntas - Si true, también obtiene las preguntas del tipo
     * @returns {Promise<Object|null>}
     */
    async getEncuestaCompletaByTelefono(telefono, incluirPreguntas = false) {
        try {
            const encuesta = await this.executeQuery(async () => {
                const pool = await this.getPool();
                const result = await pool.request()
                    .input('telefono', sql.NVarChar, telefono)
                    .query(`
                        SELECT TOP 1
                            e.EncuestaId,
                            e.ReporteId,
                            e.Estado,
                            e.PreguntaActual,
                            e.FechaEnvio,
                            e.TipoEncuestaId,
                            te.Codigo AS TipoEncuestaCodigo,
                            te.Nombre AS TipoEncuestaNombre,
                            te.NumeroPreguntas,
                            te.TienePasoComentario,
                            te.MensajeAgradecimiento,
                            r.NumeroTicket,
                            r.Descripcion AS DescripcionReporte
                        FROM Encuestas e
                        INNER JOIN Reportes r ON e.ReporteId = r.ReporteId
                        LEFT JOIN CatTipoEncuesta te ON e.TipoEncuestaId = te.TipoEncuestaId
                        WHERE e.TelefonoEncuestado = @telefono
                          AND e.Estado IN ('ENVIADA', 'EN_PROCESO')
                        ORDER BY e.FechaEnvio DESC
                    `);
                return result.recordset[0] || null;
            });

            if (!encuesta) {return null;}

            // Si se solicitan las preguntas, agregarlas
            if (incluirPreguntas && encuesta.TipoEncuestaId) {
                encuesta.Preguntas = await this.getPreguntasByTipo(encuesta.TipoEncuestaId);
            }

            return encuesta;
        } catch (error) {
            logger.error('Error obteniendo encuesta completa', error, { telefono });
            return null;
        }
    }

    /**
     * OPERACIÓN ATÓMICA: Guarda respuesta y retorna el estado actualizado (versión normalizada)
     * Evita race conditions verificando PreguntaActual esperada
     * Escribe tanto en columnas legacy (Pregunta1-6) como en RespuestasEncuesta
     * @param {number} encuestaId - ID de la encuesta
     * @param {number} numeroPregunta - Numero de pregunta esperada (1-N)
     * @param {number} respuesta - Valor de respuesta (1-5)
     * @param {number} tipoEncuestaId - ID del tipo de encuesta (opcional, para obtener PreguntaId)
     * @returns {Promise<{success: boolean, alreadyAnswered: boolean, nuevaPreguntaActual: number|null}>}
     */
    async guardarRespuestaAtomica(encuestaId, numeroPregunta, respuesta, tipoEncuestaId = null) {
        if (numeroPregunta < 1) {
            logger.warn('Numero de pregunta invalido', { encuestaId, numeroPregunta });
            return { success: false, alreadyAnswered: false, nuevaPreguntaActual: null };
        }

        if (respuesta < 1 || respuesta > 5) {
            logger.warn('Respuesta invalida', { encuestaId, respuesta });
            return { success: false, alreadyAnswered: false, nuevaPreguntaActual: null };
        }

        try {
            return await this.executeQuery(async () => {
                const pool = await this.getPool();
                const preguntaAnteriorEsperada = numeroPregunta - 1;

                // Determinar si usamos columnas legacy (Pregunta1-6) o solo tabla normalizada
                const usarLegacy = numeroPregunta <= 6;
                const columna = usarLegacy ? `Pregunta${numeroPregunta}` : null;

                // UPDATE ATÓMICO con OUTPUT para obtener el resultado
                let query;
                if (usarLegacy) {
                    query = `
                        UPDATE Encuestas
                        SET ${columna} = @respuesta,
                            PreguntaActual = @preguntaActual,
                            FechaActualizacion = GETDATE()
                        OUTPUT INSERTED.PreguntaActual, INSERTED.TipoEncuestaId
                        WHERE EncuestaId = @encuestaId
                          AND (PreguntaActual = @preguntaAnterior OR PreguntaActual IS NULL)
                    `;
                } else {
                    query = `
                        UPDATE Encuestas
                        SET PreguntaActual = @preguntaActual,
                            FechaActualizacion = GETDATE()
                        OUTPUT INSERTED.PreguntaActual, INSERTED.TipoEncuestaId
                        WHERE EncuestaId = @encuestaId
                          AND (PreguntaActual = @preguntaAnterior OR PreguntaActual IS NULL)
                    `;
                }

                const result = await pool.request()
                    .input('encuestaId', sql.Int, encuestaId)
                    .input('respuesta', sql.TinyInt, respuesta)
                    .input('preguntaActual', sql.TinyInt, numeroPregunta)
                    .input('preguntaAnterior', sql.TinyInt, preguntaAnteriorEsperada)
                    .query(query);

                if (result.recordset.length > 0) {
                    const tipoId = tipoEncuestaId || result.recordset[0].TipoEncuestaId;

                    // Guardar también en tabla normalizada RespuestasEncuesta
                    try {
                        const pregunta = await this.getPreguntaByNumero(tipoId, numeroPregunta);
                        if (pregunta) {
                            await pool.request()
                                .input('encuestaId', sql.Int, encuestaId)
                                .input('preguntaId', sql.Int, pregunta.PreguntaId)
                                .input('valor', sql.TinyInt, respuesta)
                                .query(`
                                    INSERT INTO RespuestasEncuesta (EncuestaId, PreguntaId, Valor)
                                    VALUES (@encuestaId, @preguntaId, @valor)
                                `);
                        }
                    } catch (insertError) {
                        // Si falla el insert normalizado (ej: ya existe), solo loguear
                        // La columna legacy ya se actualizó exitosamente
                        logger.warn('Error guardando respuesta normalizada (posible duplicado)', {
                            encuestaId, numeroPregunta, error: insertError.message
                        });
                    }

                    this.logOperation('guardarRespuestaAtomica', true, {
                        encuestaId, numeroPregunta, respuesta,
                        nuevaPreguntaActual: result.recordset[0].PreguntaActual
                    });
                    return {
                        success: true,
                        alreadyAnswered: false,
                        nuevaPreguntaActual: result.recordset[0].PreguntaActual
                    };
                }

                // No se actualizó - verificar por qué
                logger.warn('Respuesta no guardada (race condition o estado inválido)', {
                    encuestaId,
                    numeroPregunta,
                    respuesta
                });
                return { success: false, alreadyAnswered: true, nuevaPreguntaActual: null };
            });
        } catch (error) {
            logger.error('Error en guardarRespuestaAtomica', error, { encuestaId, numeroPregunta });
            return { success: false, alreadyAnswered: false, nuevaPreguntaActual: null };
        }
    }

    /**
     * Verifica si una encuesta está en un estado válido para procesar respuesta
     * Operación rápida para validar antes de enviar mensajes
     * @param {number} encuestaId - ID de la encuesta
     * @param {number} preguntaEsperada - Número de pregunta que esperamos procesar
     * @returns {Promise<{valido: boolean, preguntaActual: number, estado: string}>}
     */
    async verificarEstadoEncuesta(encuestaId, preguntaEsperada) {
        try {
            return await this.executeQuery(async () => {
                const pool = await this.getPool();
                const result = await pool.request()
                    .input('encuestaId', sql.Int, encuestaId)
                    .query(`
                        SELECT PreguntaActual, Estado
                        FROM Encuestas WITH (NOLOCK)
                        WHERE EncuestaId = @encuestaId
                    `);

                if (!result.recordset[0]) {
                    return { valido: false, preguntaActual: null, estado: null };
                }

                const { PreguntaActual, Estado } = result.recordset[0];
                const preguntaActual = PreguntaActual ?? 0;
                const esValido = Estado === 'EN_PROCESO' && preguntaActual === preguntaEsperada - 1;

                return {
                    valido: esValido,
                    preguntaActual,
                    estado: Estado
                };
            });
        } catch (error) {
            logger.error('Error verificando estado de encuesta', error, { encuestaId });
            return { valido: false, preguntaActual: null, estado: null };
        }
    }
}

// Singleton
const instance = new EncuestaRepository();
module.exports = instance;
