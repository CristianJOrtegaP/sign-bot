/**
 * AC FIXBOT - SesionRepository V2
 * Repositorio para operaciones de sesiones de chat
 * Compatible con schema V2 (catálogos normalizados)
 */

const sql = require('mssql');
const BaseRepository = require('./BaseRepository');
const config = require('../../core/config');
const { logger } = require('../../core/services/infrastructure/errorHandler');
const metrics = require('../../core/services/infrastructure/metricsService');
const { ConcurrencyError } = require('../../core/errors');
const appInsights = require('../../core/services/infrastructure/appInsightsService');
const {
  ESTADO,
  ESTADO_ID,
  TIPO_REPORTE_ID: _TIPO_REPORTE_ID,
  ORIGEN_ACCION,
  TIPO_MENSAJE,
  SPAM_CONFIG,
  esEstadoTerminal,
  getEstadoId,
  getTipoReporteId,
} = require('../constants/sessionStates');

/**
 * Repositorio de sesiones de chat
 */
class SesionRepository extends BaseRepository {
  constructor() {
    super('SesionRepository', config.database.sessionCache.ttlMs);
    this.startCacheCleanup(config.database.sessionCache.cleanupIntervalMs);
  }

  /**
   * Obtiene o crea una sesión de chat para un usuario
   * @param {string} telefono - Número de teléfono
   * @param {boolean} skipCache - Si true, fuerza lectura desde BD (útil para ubicaciones)
   * @returns {Promise<Object>} - Datos de la sesión
   */
  async getSession(telefono, skipCache = false) {
    const timer = metrics.startTimer('db_getSession');

    try {
      // Verificar caché (solo si no se solicita skipCache)
      if (!skipCache) {
        const cached = this.getFromCache(telefono);
        if (cached) {
          logger.debug(`Sesión encontrada en caché: ${telefono}`);
          timer.end({ source: 'cache', telefono });
          return cached;
        }
      } else {
        logger.debug(`Bypass de caché solicitado para: ${telefono}`);
      }

      // Buscar en BD usando la vista
      const session = await this.executeQuery(async () => {
        const pool = await this.getPool();

        // Buscar sesión existente
        let result = await pool.request().input('telefono', sql.NVarChar, telefono).query(`
                        SELECT
                            s.SesionId,
                            s.Telefono,
                            s.TipoReporteId,
                            s.EstadoId,
                            es.Codigo AS Estado,
                            tr.Codigo AS TipoReporte,
                            s.DatosTemp,
                            s.EquipoIdTemp,
                            s.ContadorMensajes,
                            s.UltimoResetContador,
                            s.FechaCreacion,
                            s.UltimaActividad,
                            ISNULL(s.Version, 0) AS Version
                        FROM SesionesChat s
                        INNER JOIN CatEstadoSesion es ON s.EstadoId = es.EstadoId
                        LEFT JOIN CatTipoReporte tr ON s.TipoReporteId = tr.TipoReporteId
                        WHERE s.Telefono = @telefono
                    `);

        // Si no existe, crear nueva con estado INICIO
        if (result.recordset.length === 0) {
          const estadoInicioId = ESTADO_ID.INICIO;

          await pool
            .request()
            .input('telefono', sql.NVarChar, telefono)
            .input('estadoId', sql.Int, estadoInicioId).query(`
                            INSERT INTO SesionesChat (Telefono, EstadoId, TipoReporteId)
                            VALUES (@telefono, @estadoId, NULL)
                        `);

          result = await pool.request().input('telefono', sql.NVarChar, telefono).query(`
                            SELECT
                                s.SesionId,
                                s.Telefono,
                                s.TipoReporteId,
                                s.EstadoId,
                                es.Codigo AS Estado,
                                tr.Codigo AS TipoReporte,
                                s.DatosTemp,
                                s.EquipoIdTemp,
                                s.ContadorMensajes,
                                s.UltimoResetContador,
                                s.FechaCreacion,
                                s.UltimaActividad,
                                ISNULL(s.Version, 0) AS Version
                            FROM SesionesChat s
                            INNER JOIN CatEstadoSesion es ON s.EstadoId = es.EstadoId
                            LEFT JOIN CatTipoReporte tr ON s.TipoReporteId = tr.TipoReporteId
                            WHERE s.Telefono = @telefono
                        `);
        }

        return result.recordset[0];
      });

      // Guardar en caché
      this.setInCache(telefono, session);

      timer.end({ source: 'database', telefono });
      return session;
    } catch (error) {
      logger.error('Error obteniendo sesión', error, { telefono, operation: 'getSession' });
      metrics.recordError('db_getSession_error', error.message);
      timer.end({ error: true });
      // Devolver sesión por defecto si hay error
      return { Estado: ESTADO.INICIO, EquipoIdTemp: null, DatosTemp: null };
    }
  }

  /**
   * Obtiene una sesión CON su versión para optimistic locking
   * SIEMPRE lee desde BD (skipCache=true) para garantizar versión actualizada
   * Usar este método cuando se va a actualizar la sesión después
   * @param {string} telefono - Número de teléfono
   * @returns {Promise<Object>} - Datos de la sesión con campo Version
   */
  async getSessionWithVersion(telefono) {
    // Forzar lectura desde BD para obtener versión actualizada
    return this.getSession(telefono, true);
  }

  /**
   * Actualiza el estado de una sesión y guarda en historial
   * OPTIMISTIC LOCKING: Si expectedVersion se proporciona, verifica que coincida
   * antes de actualizar. Si no coincide, lanza ConcurrencyError.
   * @param {string} telefono - Número de teléfono
   * @param {string} estadoCodigo - Código del nuevo estado (ej: 'REFRI_ESPERA_SAP')
   * @param {Object} datosTemp - Datos temporales (opcional)
   * @param {number} equipoIdTemp - ID de equipo temporal (opcional)
   * @param {string} origenAccion - Origen: 'USUARIO', 'BOT', 'TIMER', 'SISTEMA'
   * @param {string} descripcion - Descripción de la acción
   * @param {number} reporteId - ID del reporte si se generó uno
   * @param {number} expectedVersion - Versión esperada para optimistic locking (opcional)
   * @throws {ConcurrencyError} Si expectedVersion no coincide con la versión actual en BD
   */
  async updateSession(
    telefono,
    estadoCodigo,
    datosTemp = null,
    equipoIdTemp = null,
    origenAccion = ORIGEN_ACCION.BOT,
    descripcion = null,
    reporteId = null,
    expectedVersion = null
  ) {
    try {
      const estadoId = getEstadoId(estadoCodigo);
      if (!estadoId) {
        logger.error(`Estado inválido: ${estadoCodigo}`);
        return;
      }

      // Capturar estado anterior para telemetría (read-only, sin mutación)
      const cachedEntry = this.cache.get(telefono);
      const previousEstado = cachedEntry?.data?.Estado || 'unknown';

      // Determinar TipoReporteId basado en datosTemp o estado
      let tipoReporteId = null;
      if (datosTemp && datosTemp.tipoReporte) {
        tipoReporteId = getTipoReporteId(datosTemp.tipoReporte);
      }

      // IMPORTANTE: Limpiar datosTemp automáticamente cuando:
      // 1. Estado terminal (FINALIZADO, CANCELADO, TIMEOUT)
      // 2. Estado INICIO (reinicio de flujo)
      // Esto evita que datos de sesiones anteriores afecten nuevos flujos
      const esEstadoQueDebeReiniciar =
        esEstadoTerminal(estadoCodigo) || estadoCodigo === ESTADO.INICIO;
      if (esEstadoQueDebeReiniciar && datosTemp !== null) {
        logger.debug(`Limpiando datosTemp porque nuevo estado es ${estadoCodigo}`, { telefono });
        datosTemp = null;
      }

      // OPTIMIZACIÓN: Un solo roundtrip SQL con batch (SELECT + UPDATE + INSERT historial)
      await this.executeQuery(async () => {
        const pool = await this.getPool();

        const esTerminal = esEstadoTerminal(estadoCodigo);
        const request = pool
          .request()
          .input('telefono', sql.NVarChar, telefono)
          .input('estadoId', sql.Int, estadoId)
          .input('tipoReporteId', sql.Int, tipoReporteId)
          .input('datosTemp', sql.NVarChar, datosTemp ? JSON.stringify(datosTemp) : null)
          .input('equipoIdTemp', sql.Int, equipoIdTemp)
          .input('origenAccion', sql.NVarChar, origenAccion)
          .input('descripcion', sql.NVarChar, descripcion)
          .input('reporteId', sql.Int, reporteId)
          .input('esTerminal', sql.Bit, esTerminal ? 1 : 0);

        // Construir batch SQL dinámico según optimistic locking
        const versionClause =
          expectedVersion !== null && expectedVersion !== undefined
            ? (request.input('expectedVersion', sql.Int, expectedVersion),
              'AND ISNULL(Version, 0) = @expectedVersion')
            : '';

        const batchQuery = `
          -- 1. Capturar estado anterior en una sola lectura
          DECLARE @estadoAnteriorId INT, @tipoReporteIdAnterior INT;
          SELECT @estadoAnteriorId = EstadoId, @tipoReporteIdAnterior = TipoReporteId
          FROM SesionesChat WHERE Telefono = @telefono;

          -- Resolver TipoReporteId: nuevo > anterior > null si terminal
          DECLARE @tipoReporteFinal INT = CASE
            WHEN @esTerminal = 1 THEN NULL
            WHEN @tipoReporteId IS NOT NULL THEN @tipoReporteId
            ELSE @tipoReporteIdAnterior
          END;

          -- 2. UPDATE sesión (con o sin optimistic locking)
          UPDATE SesionesChat
          SET EstadoId = @estadoId,
              TipoReporteId = @tipoReporteFinal,
              DatosTemp = @datosTemp,
              EquipoIdTemp = @equipoIdTemp,
              UltimaActividad = GETDATE(),
              Version = ISNULL(Version, 0) + 1
          WHERE Telefono = @telefono ${versionClause};

          -- 3. INSERT historial (solo si UPDATE afectó filas)
          IF @@ROWCOUNT > 0
            INSERT INTO HistorialSesiones
              (Telefono, TipoReporteId, EstadoAnteriorId, EstadoNuevoId, OrigenAccion, Descripcion, ReporteId)
            VALUES
              (@telefono, @tipoReporteFinal, @estadoAnteriorId, @estadoId, @origenAccion, @descripcion, @reporteId);

          -- Devolver filas afectadas del UPDATE para verificar optimistic locking
          SELECT @@ROWCOUNT AS HistorialInserted, @tipoReporteFinal AS TipoReporteFinal;
        `;

        const batchResult = await request.query(batchQuery);

        // Verificar optimistic locking: si UPDATE no afectó filas = race condition
        const historialInserted = batchResult.recordset?.[0]?.HistorialInserted ?? 0;
        if (expectedVersion !== null && expectedVersion !== undefined && historialInserted === 0) {
          throw new ConcurrencyError(telefono, expectedVersion, 'updateSession');
        }

        logger.debug(`Sesión actualizada: ${telefono} -> ${estadoCodigo}`);
        return batchResult.recordset?.[0];
      });

      // Cache-aside: Invalidar cache tras DB write exitoso
      // Próximo getSession() re-populate desde BD (1 extra read, elimina phantom reads)
      this.invalidateCache(telefono);

      // App Insights: rastrear transiciones de estado del flujo
      appInsights.trackEvent('flow_state_change', {
        from: previousEstado,
        to: estadoCodigo,
        origen: origenAccion,
        telefono,
      });
    } catch (error) {
      logger.error('Error actualizando sesión', error, {
        telefono,
        estadoCodigo,
        operation: 'updateSession',
      });

      // Invalidar cache para forzar lectura fresca desde BD
      this.invalidateCache(telefono);

      // IMPORTANTE: Re-lanzar el error para que el llamador pueda manejarlo
      throw error;
    }
  }

  /**
   * Guarda un mensaje en el historial de chat
   * @param {string} telefono - Número de teléfono
   * @param {string} tipo - 'U' para usuario, 'B' para bot
   * @param {string} contenido - Contenido del mensaje
   * @param {string} tipoContenido - 'TEXTO', 'IMAGEN', 'BOTON', 'UBICACION'
   * @param {string} intencionDetectada - Intención detectada por IA (opcional)
   * @param {number} confianzaIA - Score de confianza (opcional)
   */
  async saveMessage(
    telefono,
    tipo,
    contenido,
    tipoContenido = 'TEXTO',
    intencionDetectada = null,
    confianzaIA = null
  ) {
    try {
      // OPTIMIZACIÓN: Un solo roundtrip SQL (SELECT SesionId + INSERT + UPDATE contador)
      await this.executeQuery(async () => {
        const pool = await this.getPool();
        const esUsuario = tipo === TIPO_MENSAJE.USUARIO;

        await pool
          .request()
          .input('telefono', sql.NVarChar, telefono)
          .input('tipo', sql.Char, tipo)
          .input('contenido', sql.NVarChar, contenido?.substring(0, 2000))
          .input('tipoContenido', sql.NVarChar, tipoContenido)
          .input('intencionDetectada', sql.NVarChar, intencionDetectada)
          .input('confianzaIA', sql.Decimal(5, 4), confianzaIA)
          .input('esUsuario', sql.Bit, esUsuario ? 1 : 0).query(`
            DECLARE @sesionId INT;
            SELECT @sesionId = SesionId FROM SesionesChat WHERE Telefono = @telefono;

            IF @sesionId IS NOT NULL
            BEGIN
              INSERT INTO MensajesChat
                (SesionId, Telefono, Tipo, Contenido, TipoContenido, IntencionDetectada, ConfianzaIA)
              VALUES
                (@sesionId, @telefono, @tipo, @contenido, @tipoContenido, @intencionDetectada, @confianzaIA);

              IF @esUsuario = 1
                UPDATE SesionesChat
                SET ContadorMensajes = ContadorMensajes + 1,
                    UltimaActividad = GETDATE()
                WHERE Telefono = @telefono;
            END
          `);
      });
    } catch (error) {
      logger.error('Error guardando mensaje', error, { telefono, tipo });
    }
  }

  /**
   * Actualiza el contenido de un mensaje placeholder de imagen con la URL real
   * @param {string} telefono - Número de teléfono del usuario
   * @param {string} imageId - ID de la imagen de WhatsApp (para encontrar el placeholder)
   * @param {string} imagenUrl - URL real de la imagen subida a blob storage
   * @returns {Promise<boolean>} - true si se actualizó, false si no se encontró el placeholder
   */
  async updateImagePlaceholder(telefono, imageId, imagenUrl) {
    try {
      return await this.executeQuery(async () => {
        const pool = await this.getPool();

        // Buscar y actualizar el placeholder con el imageId específico
        const placeholderPattern = `[IMG_PLACEHOLDER:${imageId}]`;

        const result = await pool
          .request()
          .input('telefono', sql.NVarChar, telefono)
          .input('placeholder', sql.NVarChar, placeholderPattern)
          .input('imagenUrl', sql.NVarChar, imagenUrl?.substring(0, 2000)).query(`
                        UPDATE MensajesChat
                        SET Contenido = @imagenUrl
                        WHERE Telefono = @telefono
                          AND Contenido = @placeholder
                          AND TipoContenido = 'IMAGEN'
                    `);

        const updated = result.rowsAffected[0] > 0;
        if (updated) {
          logger.info(`Placeholder de imagen actualizado para ${telefono}: ${imageId}`);
        } else {
          logger.warn(`No se encontró placeholder para actualizar: ${placeholderPattern}`);
        }

        return updated;
      });
    } catch (error) {
      logger.error('Error actualizando placeholder de imagen', error, { telefono, imageId });
      return false;
    }
  }

  /**
   * Verifica si un usuario es spam
   * OPTIMIZADO: Una sola query con CASE para ambos conteos (hora y minuto)
   * @param {string} telefono - Número de teléfono
   * @returns {Promise<{esSpam: boolean, totalMensajes: number, razon: string}>}
   */
  async checkSpam(telefono) {
    try {
      return await this.executeQuery(async () => {
        const pool = await this.getPool();

        // Query única: cuenta mensajes en hora y minuto con CASE
        const result = await pool.request().input('telefono', sql.NVarChar, telefono).query(`
                        SELECT
                            COUNT(*) AS MensajesHora,
                            SUM(CASE WHEN FechaCreacion > DATEADD(MINUTE, -1, GETDATE()) THEN 1 ELSE 0 END) AS MensajesMinuto
                        FROM MensajesChat
                        WHERE Telefono = @telefono
                          AND Tipo = 'U'
                          AND FechaCreacion > DATEADD(HOUR, -1, GETDATE())
                    `);

        const { MensajesHora: mensajesHora, MensajesMinuto: mensajesMinuto } = result.recordset[0];

        // Verificar flood por minuto primero (más restrictivo)
        if (mensajesMinuto >= SPAM_CONFIG.UMBRAL_MENSAJES_POR_MINUTO) {
          return {
            esSpam: true,
            totalMensajes: mensajesMinuto,
            razon: 'FLOOD_MINUTO',
          };
        }

        // Verificar flood por hora
        if (mensajesHora >= SPAM_CONFIG.UMBRAL_MENSAJES_POR_HORA) {
          return {
            esSpam: true,
            totalMensajes: mensajesHora,
            razon: 'FLOOD_HORA',
          };
        }

        return {
          esSpam: false,
          totalMensajes: mensajesHora,
          razon: null,
        };
      });
    } catch (error) {
      logger.error('Error verificando spam', error, { telefono });
      return { esSpam: false, totalMensajes: 0, razon: null };
    }
  }

  /**
   * Registra actividad del usuario
   * @param {string} telefono - Número de teléfono
   */
  async updateLastActivity(telefono) {
    try {
      await this.executeQuery(async () => {
        const pool = await this.getPool();
        await pool.request().input('telefono', sql.NVarChar, telefono).query(`
                        UPDATE SesionesChat
                        SET UltimaActividad = GETDATE()
                        WHERE Telefono = @telefono
                    `);
        logger.debug(`Actividad registrada para: ${telefono}`);
      });

      // Actualizar timestamp en caché
      const cached = this.cache.get(telefono);
      if (cached) {
        cached.timestamp = Date.now();
      }
    } catch (error) {
      logger.warn('Error actualizando última actividad', { telefono, error: error.message });
    }
  }

  /**
   * Obtiene sesiones inactivas que necesitan advertencia
   * @param {number} warningMinutes - Minutos de inactividad para advertencia
   * @returns {Promise<Array>}
   */
  async getSessionsNeedingWarning(warningMinutes) {
    try {
      return await this.executeQuery(async () => {
        const pool = await this.getPool();
        const result = await pool.request().input('warningMinutes', sql.Int, warningMinutes).query(`
                        SELECT
                            s.Telefono,
                            es.Codigo AS Estado,
                            tr.Codigo AS TipoReporte,
                            s.DatosTemp,
                            s.EquipoIdTemp,
                            s.UltimaActividad
                        FROM SesionesChat s
                        INNER JOIN CatEstadoSesion es ON s.EstadoId = es.EstadoId
                        LEFT JOIN CatTipoReporte tr ON s.TipoReporteId = tr.TipoReporteId
                        WHERE es.EsTerminal = 0
                          AND DATEDIFF(MINUTE, s.UltimaActividad, GETDATE()) >= @warningMinutes
                          AND DATEDIFF(MINUTE, s.UltimaActividad, GETDATE()) < (@warningMinutes + 5)
                    `);
        return result.recordset;
      });
    } catch (error) {
      logger.error('Error obteniendo sesiones para advertencia', error);
      return [];
    }
  }

  /**
   * Obtiene sesiones que deben ser cerradas por timeout
   * @param {number} timeoutMinutes - Minutos de inactividad para cerrar
   * @returns {Promise<Array>}
   */
  async getSessionsToClose(timeoutMinutes) {
    try {
      return await this.executeQuery(async () => {
        const pool = await this.getPool();
        const result = await pool.request().input('timeoutMinutes', sql.Int, timeoutMinutes).query(`
                        SELECT
                            s.Telefono,
                            es.Codigo AS Estado,
                            tr.Codigo AS TipoReporte,
                            s.DatosTemp,
                            s.EquipoIdTemp,
                            s.UltimaActividad,
                            ISNULL(s.Version, 0) AS Version
                        FROM SesionesChat s
                        INNER JOIN CatEstadoSesion es ON s.EstadoId = es.EstadoId
                        LEFT JOIN CatTipoReporte tr ON s.TipoReporteId = tr.TipoReporteId
                        WHERE es.EsTerminal = 0
                          AND DATEDIFF(MINUTE, s.UltimaActividad, GETDATE()) >= @timeoutMinutes
                    `);
        return result.recordset;
      });
    } catch (error) {
      logger.error('Error obteniendo sesiones para cerrar', error);
      return [];
    }
  }

  /**
   * Cierra una sesión por timeout.
   * Usa UPDATE atómico con Version para evitar lectura previa redundante.
   * Si otro proceso modificó la sesión (ConcurrencyError), se reintentará en el próximo ciclo.
   * @param {string} telefono - Número de teléfono
   * @param {number} expectedVersion - Versión esperada (del query de sesiones expiradas)
   */
  async closeSession(telefono, expectedVersion) {
    try {
      await this.updateSession(
        telefono,
        ESTADO.TIMEOUT,
        null,
        null,
        ORIGEN_ACCION.TIMER,
        'Sesión cerrada por inactividad',
        null,
        expectedVersion
      );
    } catch (error) {
      if (error instanceof ConcurrencyError) {
        // Usuario envió mensaje justo cuando el timer intentaba cerrar - ignorar,
        // se reintentará en el próximo ciclo si sigue inactiva
        logger.info(
          `Concurrencia en closeSession para ${telefono}, se reintentará en próximo ciclo`
        );
        return;
      }
      throw error;
    }
    this.invalidateCache(telefono);
  }

  /**
   * Obtiene el historial de un teléfono
   * @param {string} telefono - Número de teléfono
   * @param {number} limite - Cantidad de registros (default 50)
   * @returns {Promise<Array>}
   */
  async getHistorial(telefono, limite = 50) {
    try {
      return await this.executeQuery(async () => {
        const pool = await this.getPool();
        const result = await pool
          .request()
          .input('telefono', sql.NVarChar, telefono)
          .input('limite', sql.Int, limite).query(`
                        SELECT TOP (@limite)
                            h.HistorialId,
                            h.FechaAccion,
                            tr.Codigo AS TipoReporte,
                            ea.Codigo AS EstadoAnterior,
                            en.Codigo AS EstadoNuevo,
                            h.OrigenAccion,
                            h.Descripcion,
                            h.ReporteId
                        FROM HistorialSesiones h
                        LEFT JOIN CatTipoReporte tr ON h.TipoReporteId = tr.TipoReporteId
                        LEFT JOIN CatEstadoSesion ea ON h.EstadoAnteriorId = ea.EstadoId
                        INNER JOIN CatEstadoSesion en ON h.EstadoNuevoId = en.EstadoId
                        WHERE h.Telefono = @telefono
                        ORDER BY h.FechaAccion DESC
                    `);
        return result.recordset;
      });
    } catch (error) {
      logger.error('Error obteniendo historial', error, { telefono });
      return [];
    }
  }

  /**
   * Obtiene los mensajes de una sesión
   * @param {string} telefono - Número de teléfono
   * @param {number} limite - Cantidad de mensajes (default 100)
   * @returns {Promise<Array>}
   */
  async getMensajes(telefono, limite = 100) {
    try {
      return await this.executeQuery(async () => {
        const pool = await this.getPool();
        const result = await pool
          .request()
          .input('telefono', sql.NVarChar, telefono)
          .input('limite', sql.Int, limite).query(`
                        SELECT TOP (@limite)
                            MensajeId,
                            Tipo,
                            Contenido,
                            TipoContenido,
                            IntencionDetectada,
                            ConfianzaIA,
                            FechaCreacion
                        FROM MensajesChat
                        WHERE Telefono = @telefono
                        ORDER BY FechaCreacion DESC
                    `);
        return result.recordset;
      });
    } catch (error) {
      logger.error('Error obteniendo mensajes', error, { telefono });
      return [];
    }
  }

  /**
   * Resetea el contador de mensajes de una sesión
   * @param {string} telefono - Número de teléfono
   */
  async resetMessageCounter(telefono) {
    try {
      await this.executeQuery(async () => {
        const pool = await this.getPool();
        await pool.request().input('telefono', sql.NVarChar, telefono).query(`
                        UPDATE SesionesChat
                        SET ContadorMensajes = 0,
                            UltimoResetContador = GETDATE()
                        WHERE Telefono = @telefono
                    `);
      });
    } catch (error) {
      logger.error('Error reseteando contador de mensajes', error, { telefono });
    }
  }

  /**
   * Registra un mensaje de WhatsApp de forma atómica (IDEMPOTENTE)
   * Usa MERGE de SQL Server para:
   * - Si es nuevo: insertar con Reintentos=0
   * - Si ya existe: incrementar Reintentos y actualizar UltimoReintento
   *
   * IMPORTANTE: Esta operación es ATÓMICA y previene race conditions.
   * Siempre devuelve 200 OK incluso si es duplicado (idempotencia).
   *
   * @param {string} messageId - ID único del mensaje de WhatsApp
   * @param {string} telefono - Número de teléfono del remitente
   * @returns {Promise<{isDuplicate: boolean, retryCount: number, firstSeen: Date}>}
   */
  async registerMessageAtomic(messageId, telefono) {
    if (!messageId) {
      return { isDuplicate: false, retryCount: 0, firstSeen: new Date() };
    }

    try {
      return await this.executeQuery(async () => {
        const pool = await this.getPool();

        // MERGE: Operación atómica que inserta o actualiza
        const result = await pool
          .request()
          .input('messageId', sql.NVarChar, messageId)
          .input('telefono', sql.NVarChar, telefono).query(`
                        DECLARE @Output TABLE (
                            Action NVARCHAR(10),
                            WhatsAppMessageId NVARCHAR(100),
                            FechaCreacion DATETIME,
                            Reintentos INT
                        );

                        MERGE INTO MensajesProcessados AS target
                        USING (SELECT @messageId AS WhatsAppMessageId, @telefono AS Telefono) AS source
                        ON target.WhatsAppMessageId = source.WhatsAppMessageId
                        WHEN MATCHED THEN
                            UPDATE SET
                                Reintentos = Reintentos + 1,
                                UltimoReintento = GETDATE()
                        WHEN NOT MATCHED THEN
                            INSERT (WhatsAppMessageId, Telefono, Reintentos, FechaCreacion)
                            VALUES (source.WhatsAppMessageId, source.Telefono, 0, GETDATE())
                        OUTPUT
                            $action AS Action,
                            INSERTED.WhatsAppMessageId,
                            INSERTED.FechaCreacion,
                            INSERTED.Reintentos
                        INTO @Output;

                        SELECT * FROM @Output;
                    `);

        const row = result.recordset[0];

        if (!row) {
          // Fallback por si la query no devuelve resultado
          logger.warn('MERGE no devolvió resultado', { messageId, telefono });
          return { isDuplicate: false, retryCount: 0, firstSeen: new Date() };
        }

        const isDuplicate = row.Action === 'UPDATE';
        const retryCount = row.Reintentos || 0;
        const firstSeen = row.FechaCreacion;

        if (isDuplicate) {
          logger.info(
            `Mensaje duplicado detectado (MERGE): ${messageId}, reintento #${retryCount}`,
            {
              messageId,
              telefono,
              retryCount,
            }
          );
        } else {
          logger.debug(`Mensaje nuevo registrado (MERGE): ${messageId}`, {
            messageId,
            telefono,
          });
        }

        return {
          isDuplicate,
          retryCount,
          firstSeen,
        };
      });
    } catch (error) {
      logger.error('Error registrando mensaje atómico', error, { messageId, telefono });

      // En caso de error, permitir procesar (mejor duplicar que perder mensaje)
      // Pero registrar el error para monitoreo
      return { isDuplicate: false, retryCount: 0, firstSeen: new Date(), error: error.message };
    }
  }

  /**
   * Verifica si un mensaje de WhatsApp ya fue procesado (deduplicación en BD)
   * Usa operación ATÓMICA: intenta INSERT y captura violación de UNIQUE constraint
   * Esto previene race conditions entre múltiples instancias
   *
   * @deprecated Usar registerMessageAtomic() en su lugar (más completo)
   * @param {string} messageId - ID único del mensaje de WhatsApp
   * @returns {Promise<boolean>} - true si ya fue procesado (es duplicado)
   */
  async isMessageProcessed(messageId) {
    if (!messageId) {
      return false;
    }

    try {
      return await this.executeQuery(async () => {
        const pool = await this.getPool();

        try {
          // OPERACIÓN ATÓMICA: Intentar insertar directamente
          // Si el messageId ya existe, SQL Server lanzará error de UNIQUE constraint
          // Esto es atómico y previene race conditions
          await pool.request().input('messageId', sql.NVarChar, messageId).query(`
                            INSERT INTO MensajesProcessados (WhatsAppMessageId)
                            VALUES (@messageId)
                        `);

          // Si llegamos aquí, el INSERT fue exitoso = mensaje nuevo
          return false;
        } catch (insertError) {
          // Error 2627: Violation of UNIQUE KEY constraint
          // Error 2601: Cannot insert duplicate key row
          if (insertError.number === 2627 || insertError.number === 2601) {
            logger.debug(`Mensaje duplicado detectado (constraint): ${messageId}`);
            return true; // Es duplicado
          }

          // Si la tabla no existe, fallback a permitir
          if (
            insertError.message.includes('Invalid object name') ||
            insertError.message.includes('MensajesProcessados')
          ) {
            logger.debug('Tabla MensajesProcessados no existe, usando fallback');
            return false;
          }

          // Otro error, propagar
          throw insertError;
        }
      });
    } catch (error) {
      logger.error('Error verificando mensaje duplicado', error, { messageId });
      return false; // En caso de error, permitir procesar (mejor duplicar que perder)
    }
  }

  /**
   * Limpia mensajes procesados antiguos (más de 1 hora)
   * Llamado periódicamente por el timer
   */
  async cleanOldProcessedMessages() {
    try {
      await this.executeQuery(async () => {
        const pool = await this.getPool();
        await pool.request().query(`
                    DELETE FROM MensajesProcessados
                    WHERE FechaCreacion < DATEADD(HOUR, -1, GETDATE())
                `);
      });
    } catch (error) {
      // Ignorar si la tabla no existe
      if (!error.message.includes('Invalid object name')) {
        logger.error('Error limpiando mensajes procesados', error);
      }
    }
  }

  /**
   * Limpia registros de historial de sesiones con más de 3 meses de antigüedad.
   * Usa borrado en lotes (TOP 5000) para evitar lock escalation con tablas grandes.
   * Llamado periódicamente por el timer de cleanup.
   */
  async cleanOldHistorialSesiones() {
    const BATCH_SIZE = 5000;
    try {
      let totalDeleted = 0;

      // Borrar en lotes para evitar lock escalation

      while (true) {
        const result = await this.executeQuery(async () => {
          const pool = await this.getPool();
          return pool.request().input('batchSize', sql.Int, BATCH_SIZE).query(`
                      DELETE TOP (@batchSize) FROM HistorialSesiones
                      WHERE FechaAccion < DATEADD(MONTH, -3, GETDATE())
                  `);
        });
        const deleted = result?.rowsAffected?.[0] || 0;
        totalDeleted += deleted;

        if (deleted < BATCH_SIZE) {
          break;
        }
      }

      if (totalDeleted > 0) {
        logger.info(`Limpieza de historial: ${totalDeleted} registros eliminados (>3 meses)`);
      }
    } catch (error) {
      if (!error.message.includes('Invalid object name')) {
        logger.error('Error limpiando historial de sesiones', error);
      }
    }
  }

  /**
   * Actualiza el nombre de usuario de WhatsApp en la sesión
   * Se extrae del payload del webhook: contacts[0].profile.name
   * @param {string} telefono - Número de teléfono
   * @param {string} nombreUsuario - Nombre de perfil de WhatsApp
   */
  async updateUserName(telefono, nombreUsuario) {
    if (!telefono || !nombreUsuario) {
      return;
    }

    try {
      await this.executeQuery(async () => {
        const pool = await this.getPool();
        await pool
          .request()
          .input('telefono', sql.NVarChar, telefono)
          .input('nombreUsuario', sql.NVarChar, nombreUsuario.substring(0, 200)).query(`
                        UPDATE SesionesChat
                        SET NombreUsuario = @nombreUsuario
                        WHERE Telefono = @telefono
                          AND (NombreUsuario IS NULL OR NombreUsuario != @nombreUsuario)
                    `);
      });
      logger.debug(`Nombre de usuario actualizado: ${telefono} -> ${nombreUsuario}`);
    } catch (error) {
      // No es crítico, solo loguear
      logger.warn('Error actualizando nombre de usuario', { telefono, error: error.message });
    }
  }
}

// Singleton
const instance = new SesionRepository();

module.exports = instance;
