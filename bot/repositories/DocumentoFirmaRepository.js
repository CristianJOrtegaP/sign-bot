/**
 * SIGN BOT - DocumentoFirmaRepository
 * Repositorio para operaciones de documentos de firma digital
 * Gestiona la tabla DocumentosFirma y sus estados
 *
 * @module repositories/DocumentoFirmaRepository
 */

const sql = require('mssql');
const BaseRepository = require('./BaseRepository');
const config = require('../../core/config');
const { logger } = require('../../core/services/infrastructure/errorHandler');
const metrics = require('../../core/services/infrastructure/metricsService');
const { ConcurrencyError } = require('../../core/errors');
const appInsights = require('../../core/services/infrastructure/appInsightsService');
const { ESTADO_DOCUMENTO_ID } = require('../constants/documentStates');

/**
 * Repositorio de documentos de firma digital
 */
class DocumentoFirmaRepository extends BaseRepository {
  constructor() {
    super('DocumentoFirma', config.database.documentCache.ttlMs);
    this.startCacheCleanup(config.database.documentCache.cleanupIntervalMs);
  }

  /**
   * Crea un nuevo registro de documento de firma
   * @param {Object} documentoData - Datos del documento
   * @param {string} documentoData.SapDocumentId - ID del documento en SAP
   * @param {string} [documentoData.SapCallbackUrl] - URL de callback para SAP
   * @param {string} documentoData.ClienteTelefono - Telefono del cliente
   * @param {string} documentoData.ClienteNombre - Nombre del cliente
   * @param {string} [documentoData.ClienteEmail] - Email del cliente
   * @param {number} documentoData.TipoDocumentoId - ID del tipo de documento
   * @param {string} documentoData.DocumentoNombre - Nombre del documento
   * @param {string} documentoData.DocumentoOriginalUrl - URL del PDF original en blob storage
   * @param {string} [documentoData.DatosExtra] - Datos adicionales (JSON string)
   * @returns {Promise<Object>} - Documento creado con Id
   */
  async crear(documentoData) {
    const timer = metrics.startTimer('db_crearDocumento');

    try {
      const result = await this.executeQuery(async () => {
        const pool = await this.getPool();

        const res = await pool
          .request()
          .input('SapDocumentId', sql.NVarChar, documentoData.SapDocumentId)
          .input('SapCallbackUrl', sql.NVarChar, documentoData.SapCallbackUrl || null)
          .input('ClienteTelefono', sql.NVarChar, documentoData.ClienteTelefono)
          .input('ClienteNombre', sql.NVarChar, documentoData.ClienteNombre)
          .input('ClienteEmail', sql.NVarChar, documentoData.ClienteEmail || null)
          .input('TipoDocumentoId', sql.Int, documentoData.TipoDocumentoId)
          .input('DocumentoNombre', sql.NVarChar, documentoData.DocumentoNombre)
          .input('DocumentoOriginalUrl', sql.NVarChar, documentoData.DocumentoOriginalUrl)
          .input('DatosExtra', sql.NVarChar, documentoData.DatosExtra || null)
          .execute('sp_CrearDocumentoFirma');

        return res.recordset[0];
      });

      this.logOperation('crear', true, {
        documentoId: result?.DocumentoFirmaId,
        sapDocumentId: documentoData.SapDocumentId,
        telefono: documentoData.ClienteTelefono,
      });

      timer.end({ success: true });
      return result;
    } catch (error) {
      logger.error('Error creando documento de firma', error, {
        sapDocumentId: documentoData.SapDocumentId,
        telefono: documentoData.ClienteTelefono,
        operation: 'crear',
      });
      metrics.recordError('db_crearDocumento_error', error.message);
      timer.end({ error: true });
      throw error;
    }
  }

  /**
   * Actualiza el estado de un documento con optimistic locking
   * @param {number} documentoId - ID del documento
   * @param {number} nuevoEstadoId - ID del nuevo estado
   * @param {number} version - Version esperada (para optimistic locking)
   * @param {Object} datosExtra - Datos adicionales a actualizar
   * @param {string} [datosExtra.EnvelopeId] - ID del envelope en DocuSign
   * @param {string} [datosExtra.SigningUrl] - URL de firma para el cliente
   * @param {string} [datosExtra.DocumentoFirmadoUrl] - URL del documento firmado
   * @param {string} [datosExtra.MotivoRechazo] - Motivo del rechazo
   * @param {string} [datosExtra.WhatsAppMessageId] - ID del mensaje de WhatsApp
   * @returns {Promise<Object>} - Documento actualizado
   * @throws {ConcurrencyError} Si la version no coincide
   */
  async actualizarEstado(documentoId, nuevoEstadoId, version, datosExtra = {}) {
    const timer = metrics.startTimer('db_actualizarEstadoDocumento');

    try {
      const result = await this.executeQuery(async () => {
        const pool = await this.getPool();

        const res = await pool
          .request()
          .input('DocumentoFirmaId', sql.Int, documentoId)
          .input('NuevoEstadoId', sql.Int, nuevoEstadoId)
          .input('Version', sql.Int, version)
          .input('EnvelopeId', sql.NVarChar, datosExtra.EnvelopeId || null)
          .input('SigningUrl', sql.NVarChar, datosExtra.SigningUrl || null)
          .input('DocumentoFirmadoUrl', sql.NVarChar, datosExtra.DocumentoFirmadoUrl || null)
          .input('MotivoRechazo', sql.NVarChar, datosExtra.MotivoRechazo || null)
          .input('WhatsAppMessageId', sql.NVarChar, datosExtra.WhatsAppMessageId || null)
          .input('MensajeError', sql.NVarChar, datosExtra.MensajeError || null)
          .execute('sp_ActualizarEstadoDocumento');

        const record = res.recordset[0];

        // Si el SP no devuelve registros, la version no coincidia
        if (!record) {
          throw new ConcurrencyError(String(documentoId), version, 'actualizarEstado');
        }

        return record;
      });

      // Invalidar cache tras actualizacion exitosa
      await this.invalidateCacheAsync(`doc:${documentoId}`);

      // Si hay EnvelopeId, invalidar tambien esa cache
      if (datosExtra.EnvelopeId) {
        await this.invalidateCacheAsync(`env:${datosExtra.EnvelopeId}`);
      }

      this.logOperation('actualizarEstado', true, {
        documentoId,
        nuevoEstadoId,
        version,
      });

      // Telemetria de transicion de estado
      appInsights.trackEvent('document_state_change', {
        documentoId,
        nuevoEstadoId,
        version,
        envelopeId: datosExtra.EnvelopeId,
      });

      timer.end({ success: true });
      return result;
    } catch (error) {
      // Invalidar cache en caso de error para forzar lectura fresca
      await this.invalidateCacheAsync(`doc:${documentoId}`);

      if (error instanceof ConcurrencyError) {
        logger.warn('Conflicto de concurrencia al actualizar documento', {
          documentoId,
          nuevoEstadoId,
          version,
          operation: 'actualizarEstado',
        });
        timer.end({ error: true, reason: 'concurrency' });
        throw error;
      }

      logger.error('Error actualizando estado de documento', error, {
        documentoId,
        nuevoEstadoId,
        version,
        operation: 'actualizarEstado',
      });
      metrics.recordError('db_actualizarEstadoDocumento_error', error.message);
      timer.end({ error: true });
      throw error;
    }
  }

  /**
   * Obtiene un documento por su ID
   * @param {number} documentoId - ID del documento
   * @returns {Promise<Object|null>} - Documento o null si no existe
   */
  async obtenerPorId(documentoId) {
    const timer = metrics.startTimer('db_obtenerDocumentoPorId');

    try {
      // Verificar cache
      const cacheKey = `doc:${documentoId}`;
      const cached = await this.getFromCacheAsync(cacheKey);
      if (cached) {
        logger.debug(`Documento encontrado en cache: ${documentoId}`);
        timer.end({ source: 'cache', documentoId });
        return cached;
      }

      const result = await this.executeQuery(async () => {
        const pool = await this.getPool();

        const res = await pool
          .request()
          .input('DocumentoFirmaId', sql.Int, documentoId)
          .execute('sp_ObtenerDocumentoPorId');

        return res.recordset[0] || null;
      });

      // Guardar en cache si se encontro
      if (result) {
        await this.setInCacheAsync(cacheKey, result);
      }

      timer.end({ source: 'database', documentoId });
      return result;
    } catch (error) {
      logger.error('Error obteniendo documento por ID', error, {
        documentoId,
        operation: 'obtenerPorId',
      });
      metrics.recordError('db_obtenerDocumentoPorId_error', error.message);
      timer.end({ error: true });
      return null;
    }
  }

  /**
   * Obtiene un documento activo por SapDocumentId
   * Usado para verificar si ya existe un envelope antes de crear uno nuevo
   * @param {string} sapDocumentId - ID del documento en SAP
   * @returns {Promise<Object|null>} - Documento activo o null
   */
  async obtenerActivoPorSapDocumentId(sapDocumentId) {
    const timer = metrics.startTimer('db_obtenerActivoPorSapDocumentId');

    try {
      const result = await this.executeQuery(async () => {
        const pool = await this.getPool();

        const res = await pool
          .request()
          .input('SapDocumentId', sql.NVarChar, sapDocumentId)
          .input('EstadoFirmado', sql.Int, ESTADO_DOCUMENTO_ID.FIRMADO)
          .input('EstadoAnulado', sql.Int, ESTADO_DOCUMENTO_ID.ANULADO).query(`
            SELECT TOP 1
              df.DocumentoFirmaId, df.SapDocumentId, df.EnvelopeId,
              df.ClienteTelefono, df.ClienteNombre,
              df.EstadoDocumentoId, df.SigningUrl,
              ISNULL(df.Version, 0) AS Version
            FROM DocumentosFirma df
            WHERE df.SapDocumentId = @SapDocumentId
              AND df.EstadoDocumentoId NOT IN (@EstadoFirmado, @EstadoAnulado)
            ORDER BY df.FechaCreacion DESC
          `);

        return res.recordset[0] || null;
      });

      timer.end({ source: 'database', sapDocumentId, found: Boolean(result) });
      return result;
    } catch (error) {
      logger.error('Error obteniendo documento activo por SapDocumentId', error, {
        sapDocumentId,
        operation: 'obtenerActivoPorSapDocumentId',
      });
      metrics.recordError('db_obtenerActivoPorSapDocumentId_error', error.message);
      timer.end({ error: true });
      return null;
    }
  }

  /**
   * Obtiene un documento por EnvelopeId de DocuSign (para webhook)
   * @param {string} envelopeId - ID del envelope en DocuSign
   * @returns {Promise<Object|null>} - Documento o null si no existe
   */
  async obtenerPorEnvelopeId(envelopeId) {
    const timer = metrics.startTimer('db_obtenerDocumentoPorEnvelope');

    try {
      // Verificar cache
      const cacheKey = `env:${envelopeId}`;
      const cached = await this.getFromCacheAsync(cacheKey);
      if (cached) {
        logger.debug(`Documento encontrado en cache por envelope: ${envelopeId}`);
        timer.end({ source: 'cache', envelopeId });
        return cached;
      }

      const result = await this.executeQuery(async () => {
        const pool = await this.getPool();

        const res = await pool
          .request()
          .input('EnvelopeId', sql.NVarChar, envelopeId)
          .execute('sp_ObtenerDocumentoPorEnvelope');

        return res.recordset[0] || null;
      });

      // Guardar en cache si se encontro
      if (result) {
        await this.setInCacheAsync(cacheKey, result);
      }

      timer.end({ source: 'database', envelopeId });
      return result;
    } catch (error) {
      logger.error('Error obteniendo documento por EnvelopeId', error, {
        envelopeId,
        operation: 'obtenerPorEnvelopeId',
      });
      metrics.recordError('db_obtenerDocumentoPorEnvelope_error', error.message);
      timer.end({ error: true });
      return null;
    }
  }

  /**
   * Obtiene documentos por numero de telefono del cliente
   * @param {string} telefono - Numero de telefono del cliente
   * @returns {Promise<Array>} - Array de documentos
   */
  async obtenerPorTelefono(telefono) {
    const timer = metrics.startTimer('db_obtenerDocumentosPorTelefono');

    try {
      const result = await this.executeQuery(async () => {
        const pool = await this.getPool();

        const res = await pool
          .request()
          .input('ClienteTelefono', sql.NVarChar, telefono)
          .execute('sp_ObtenerDocumentosPorTelefono');

        return res.recordset;
      });

      timer.end({ source: 'database', telefono, count: result.length });
      return result;
    } catch (error) {
      logger.error('Error obteniendo documentos por telefono', error, {
        telefono,
        operation: 'obtenerPorTelefono',
      });
      metrics.recordError('db_obtenerDocumentosPorTelefono_error', error.message);
      timer.end({ error: true });
      return [];
    }
  }

  /**
   * Obtiene documentos pendientes de recordatorio
   * @param {number} horasDesdeUltimoRecordatorio - Horas minimas desde ultimo recordatorio
   * @param {number} maxRecordatorios - Maximo de recordatorios enviados
   * @returns {Promise<Array>} - Array de documentos pendientes
   */
  async obtenerPendientesRecordatorio(horasDesdeUltimoRecordatorio, maxRecordatorios) {
    const timer = metrics.startTimer('db_obtenerPendientesRecordatorio');

    try {
      const result = await this.executeQuery(async () => {
        const pool = await this.getPool();

        const res = await pool
          .request()
          .input('HorasDesdeUltimoRecordatorio', sql.Int, horasDesdeUltimoRecordatorio)
          .input('MaxRecordatorios', sql.Int, maxRecordatorios)
          .execute('sp_ObtenerDocumentosPendientesRecordatorio');

        return res.recordset;
      });

      timer.end({ count: result.length });
      return result;
    } catch (error) {
      logger.error('Error obteniendo documentos pendientes de recordatorio', error, {
        horasDesdeUltimoRecordatorio,
        maxRecordatorios,
        operation: 'obtenerPendientesRecordatorio',
      });
      metrics.recordError('db_obtenerPendientesRecordatorio_error', error.message);
      timer.end({ error: true });
      return [];
    }
  }

  /**
   * Incrementa el contador de recordatorios de un documento
   * @param {number} documentoId - ID del documento
   * @param {number} version - Version esperada (para optimistic locking)
   * @returns {Promise<Object|null>} - Documento actualizado o null
   */
  async incrementarRecordatorio(documentoId, version) {
    const timer = metrics.startTimer('db_incrementarRecordatorio');

    try {
      const result = await this.executeQuery(async () => {
        const pool = await this.getPool();

        const res = await pool
          .request()
          .input('DocumentoId', sql.Int, documentoId)
          .input('ExpectedVersion', sql.Int, version).query(`
            UPDATE DocumentosFirma
            SET IntentosRecordatorio = IntentosRecordatorio + 1,
                UltimoRecordatorio = GETUTCDATE(),
                Version = ISNULL(Version, 0) + 1,
                UpdatedAt = GETUTCDATE()
            WHERE DocumentoFirmaId = @DocumentoId
              AND ISNULL(Version, 0) = @ExpectedVersion;

            SELECT @@ROWCOUNT AS RowsAffected;
          `);

        const rowsAffected = res.recordset[0]?.RowsAffected || 0;
        if (rowsAffected === 0) {
          throw new ConcurrencyError(String(documentoId), version, 'incrementarRecordatorio');
        }

        return { documentoId, updated: true };
      });

      // Invalidar cache
      await this.invalidateCacheAsync(`doc:${documentoId}`);

      this.logOperation('incrementarRecordatorio', true, { documentoId, version });
      timer.end({ success: true });
      return result;
    } catch (error) {
      await this.invalidateCacheAsync(`doc:${documentoId}`);

      if (error instanceof ConcurrencyError) {
        logger.warn('Conflicto de concurrencia al incrementar recordatorio', {
          documentoId,
          version,
        });
        timer.end({ error: true, reason: 'concurrency' });
        throw error;
      }

      logger.error('Error incrementando recordatorio', error, {
        documentoId,
        version,
        operation: 'incrementarRecordatorio',
      });
      metrics.recordError('db_incrementarRecordatorio_error', error.message);
      timer.end({ error: true });
      throw error;
    }
  }

  /**
   * Obtiene documentos pendientes de reporte a SAP
   * @param {number} diasDesdeUltimoReporte - Dias minimos desde ultimo reporte a SAP
   * @returns {Promise<Array>} - Array de documentos pendientes de reporte
   */
  async obtenerPendientesReporteSap(diasDesdeUltimoReporte) {
    const timer = metrics.startTimer('db_obtenerPendientesReporteSap');

    try {
      const result = await this.executeQuery(async () => {
        const pool = await this.getPool();

        const res = await pool
          .request()
          .input('DiasDesdeUltimoReporte', sql.Int, diasDesdeUltimoReporte)
          .input('EstadoFirmado', sql.Int, ESTADO_DOCUMENTO_ID.FIRMADO)
          .input('EstadoRechazado', sql.Int, ESTADO_DOCUMENTO_ID.RECHAZADO)
          .input('EstadoAnulado', sql.Int, ESTADO_DOCUMENTO_ID.ANULADO).query(`
            SELECT
              df.DocumentoFirmaId, df.SapDocumentId, df.SapCallbackUrl,
              df.ClienteTelefono, df.ClienteNombre,
              df.EnvelopeId, df.EstadoDocumentoId,
              ed.Codigo AS Estado,
              df.DocumentoFirmadoUrl, df.DatosExtra,
              df.FechaCreacion, df.UpdatedAt,
              ISNULL(df.Version, 0) AS Version
            FROM DocumentosFirma df
            INNER JOIN CatEstadoDocumento ed ON df.EstadoDocumentoId = ed.EstadoDocumentoId
            WHERE df.SapCallbackUrl IS NOT NULL
              AND df.EstadoDocumentoId IN (@EstadoFirmado, @EstadoRechazado, @EstadoAnulado)
              AND (df.UltimoReporteTeams IS NULL
                   OR DATEDIFF(DAY, df.UltimoReporteTeams, GETDATE()) >= @DiasDesdeUltimoReporte)
          `);

        return res.recordset;
      });

      timer.end({ count: result.length });
      return result;
    } catch (error) {
      logger.error('Error obteniendo documentos pendientes de reporte SAP', error, {
        diasDesdeUltimoReporte,
        operation: 'obtenerPendientesReporteSap',
      });
      metrics.recordError('db_obtenerPendientesReporteSap_error', error.message);
      timer.end({ error: true });
      return [];
    }
  }

  /**
   * Obtiene documentos para housekeeping (anular envelopes inactivos)
   * @param {number} diasInactividad - Dias de inactividad para considerar housekeeping
   * @returns {Promise<Array>} - Array de documentos inactivos con envelopes activos
   */
  async obtenerParaHousekeeping(diasInactividad) {
    const timer = metrics.startTimer('db_obtenerParaHousekeeping');

    try {
      const result = await this.executeQuery(async () => {
        const pool = await this.getPool();

        const res = await pool
          .request()
          .input('DiasInactividad', sql.Int, diasInactividad)
          .input('EstadoFirmado', sql.Int, ESTADO_DOCUMENTO_ID.FIRMADO)
          .input('EstadoAnulado', sql.Int, ESTADO_DOCUMENTO_ID.ANULADO).query(`
            SELECT
              df.DocumentoFirmaId, df.SapDocumentId, df.EnvelopeId,
              df.ClienteTelefono, df.ClienteNombre,
              df.EstadoDocumentoId,
              ed.Codigo AS Estado,
              df.FechaCreacion, df.UpdatedAt,
              ISNULL(df.Version, 0) AS Version
            FROM DocumentosFirma df
            INNER JOIN CatEstadoDocumento ed ON df.EstadoDocumentoId = ed.EstadoDocumentoId
            WHERE df.EnvelopeId IS NOT NULL
              AND df.EstadoDocumentoId NOT IN (@EstadoFirmado, @EstadoAnulado)
              AND DATEDIFF(DAY, df.UpdatedAt, GETDATE()) >= @DiasInactividad
          `);

        return res.recordset;
      });

      timer.end({ count: result.length });
      return result;
    } catch (error) {
      logger.error('Error obteniendo documentos para housekeeping', error, {
        diasInactividad,
        operation: 'obtenerParaHousekeeping',
      });
      metrics.recordError('db_obtenerParaHousekeeping_error', error.message);
      timer.end({ error: true });
      return [];
    }
  }

  /**
   * Lista documentos con filtros (para dashboard API)
   * Usa la vista vw_DocumentosFirma para datos enriquecidos
   * @param {Object} filtros - Filtros de busqueda
   * @param {string} [filtros.estado] - Codigo de estado
   * @param {string} [filtros.tipo] - Codigo de tipo de documento
   * @param {string} [filtros.telefono] - Telefono del cliente
   * @param {string} [filtros.fechaDesde] - Fecha inicio (ISO string)
   * @param {string} [filtros.fechaHasta] - Fecha fin (ISO string)
   * @param {number} [filtros.page=1] - Pagina
   * @param {number} [filtros.pageSize=20] - Tamano de pagina
   * @returns {Promise<{data: Array, total: number, page: number, pageSize: number}>}
   */
  async listar(filtros = {}) {
    const timer = metrics.startTimer('db_listarDocumentos');
    const page = Math.max(1, filtros.page || 1);
    const pageSize = Math.min(100, Math.max(1, filtros.pageSize || 20));
    const offset = (page - 1) * pageSize;

    try {
      const result = await this.executeQuery(async () => {
        const pool = await this.getPool();

        const request = pool
          .request()
          .input('Offset', sql.Int, offset)
          .input('PageSize', sql.Int, pageSize);

        // Construir filtros WHERE dinamicamente
        const conditions = [];

        if (filtros.estado) {
          request.input('Estado', sql.NVarChar, filtros.estado);
          conditions.push('Estado = @Estado');
        }

        if (filtros.tipo) {
          request.input('TipoDocumento', sql.NVarChar, filtros.tipo);
          conditions.push('TipoDocumento = @TipoDocumento');
        }

        if (filtros.telefono) {
          request.input('ClienteTelefono', sql.NVarChar, filtros.telefono);
          conditions.push('ClienteTelefono = @ClienteTelefono');
        }

        if (filtros.fechaDesde) {
          request.input('FechaDesde', sql.DateTime, new Date(filtros.fechaDesde));
          conditions.push('FechaCreacion >= @FechaDesde');
        }

        if (filtros.fechaHasta) {
          request.input('FechaHasta', sql.DateTime, new Date(filtros.fechaHasta));
          conditions.push('FechaCreacion <= @FechaHasta');
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const res = await request.query(`
          SELECT COUNT(*) AS Total FROM vw_DocumentosFirma ${whereClause};

          SELECT *
          FROM vw_DocumentosFirma
          ${whereClause}
          ORDER BY FechaCreacion DESC
          OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
        `);

        const total = res.recordsets[0][0]?.Total || 0;
        const data = res.recordsets[1] || [];

        return { data, total, page, pageSize };
      });

      timer.end({ count: result.data.length, total: result.total });
      return result;
    } catch (error) {
      logger.error('Error listando documentos', error, {
        filtros,
        operation: 'listar',
      });
      metrics.recordError('db_listarDocumentos_error', error.message);
      timer.end({ error: true });
      return { data: [], total: 0, page, pageSize };
    }
  }

  /**
   * Obtiene estadisticas de documentos (para dashboard)
   * @returns {Promise<Object>} - Estadisticas agregadas
   */
  async obtenerEstadisticas() {
    const timer = metrics.startTimer('db_obtenerEstadisticasDocumentos');

    try {
      const result = await this.executeQuery(async () => {
        const pool = await this.getPool();

        const res = await pool
          .request()
          .input('EstadoFirmado', sql.Int, ESTADO_DOCUMENTO_ID.FIRMADO)
          .input('EstadoRechazado', sql.Int, ESTADO_DOCUMENTO_ID.RECHAZADO)
          .input('EstadoPendienteEnvio', sql.Int, ESTADO_DOCUMENTO_ID.PENDIENTE_ENVIO)
          .input('EstadoEnviado', sql.Int, ESTADO_DOCUMENTO_ID.ENVIADO)
          .input('EstadoEntregado', sql.Int, ESTADO_DOCUMENTO_ID.ENTREGADO)
          .input('EstadoVisto', sql.Int, ESTADO_DOCUMENTO_ID.VISTO).query(`
          -- Conteos por estado
          SELECT
            ed.Codigo AS Estado,
            COUNT(*) AS Total
          FROM DocumentosFirma df
          INNER JOIN CatEstadoDocumento ed ON df.EstadoDocumentoId = ed.EstadoDocumentoId
          GROUP BY ed.Codigo;

          -- Conteos por tipo
          SELECT
            td.Codigo AS TipoDocumento,
            COUNT(*) AS Total
          FROM DocumentosFirma df
          INNER JOIN CatTipoDocumento td ON df.TipoDocumentoId = td.TipoDocumentoId
          GROUP BY td.Codigo;

          -- Totales generales
          SELECT
            COUNT(*) AS TotalDocumentos,
            SUM(CASE WHEN df.EstadoDocumentoId = @EstadoFirmado THEN 1 ELSE 0 END) AS TotalFirmados,
            SUM(CASE WHEN df.EstadoDocumentoId = @EstadoRechazado THEN 1 ELSE 0 END) AS TotalRechazados,
            SUM(CASE WHEN df.EstadoDocumentoId IN (@EstadoPendienteEnvio, @EstadoEnviado, @EstadoEntregado, @EstadoVisto) THEN 1 ELSE 0 END) AS TotalPendientes
          FROM DocumentosFirma df;
        `);

        const porEstado = {};
        for (const row of res.recordsets[0]) {
          porEstado[row.Estado] = row.Total;
        }

        const porTipo = {};
        for (const row of res.recordsets[1]) {
          porTipo[row.TipoDocumento] = row.Total;
        }

        const totales = res.recordsets[2][0] || {};

        return {
          porEstado,
          porTipo,
          totalDocumentos: totales.TotalDocumentos || 0,
          totalFirmados: totales.TotalFirmados || 0,
          totalRechazados: totales.TotalRechazados || 0,
          totalPendientes: totales.TotalPendientes || 0,
        };
      });

      timer.end({ success: true });
      return result;
    } catch (error) {
      logger.error('Error obteniendo estadisticas de documentos', error, {
        operation: 'obtenerEstadisticas',
      });
      metrics.recordError('db_obtenerEstadisticasDocumentos_error', error.message);
      timer.end({ error: true });
      return {
        porEstado: {},
        porTipo: {},
        totalDocumentos: 0,
        totalFirmados: 0,
        totalRechazados: 0,
        totalPendientes: 0,
      };
    }
  }
}

// Singleton
const instance = new DocumentoFirmaRepository();

module.exports = instance;
