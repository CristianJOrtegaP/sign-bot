/**
 * SIGN BOT - EventoDocuSignRepository
 * Repositorio para deduplicacion de eventos de DocuSign Connect webhook
 * Gestiona la tabla EventosDocuSignProcessados
 *
 * @module repositories/EventoDocuSignRepository
 */

const sql = require('mssql');
const BaseRepository = require('./BaseRepository');
const { logger } = require('../../core/services/infrastructure/errorHandler');
const metrics = require('../../core/services/infrastructure/metricsService');

/**
 * Repositorio de eventos DocuSign procesados
 * Usado para deduplicacion de webhooks de DocuSign Connect
 */
class EventoDocuSignRepository extends BaseRepository {
  constructor() {
    super('EventoDocuSign', 5 * 60 * 1000); // 5 min cache TTL
  }

  /**
   * Registra un evento de DocuSign de forma atomica (idempotente)
   * Usa INSERT con TRY-CATCH para manejar violacion de UNIQUE constraint
   * @param {string} eventId - ID unico del evento de DocuSign
   * @param {string} envelopeId - ID del envelope asociado
   * @param {string} eventoTipo - Tipo de evento (e.g., 'envelope-completed')
   * @returns {Promise<boolean>} - true si es nuevo (insertado), false si es duplicado
   */
  async registrar(eventId, envelopeId, eventoTipo) {
    const timer = metrics.startTimer('db_registrarEventoDocuSign');

    try {
      const isNew = await this.executeQuery(async () => {
        const pool = await this.getPool();

        try {
          // Intentar INSERT atomico
          await pool
            .request()
            .input('EventId', sql.NVarChar, eventId)
            .input('EnvelopeId', sql.NVarChar, envelopeId)
            .input('EventType', sql.NVarChar, eventoTipo).query(`
              INSERT INTO EventosDocuSignProcessados (EventId, EnvelopeId, EventType, FechaCreacion)
              VALUES (@EventId, @EnvelopeId, @EventType, GETDATE())
            `);

          // Si llegamos aqui, INSERT fue exitoso = evento nuevo
          logger.debug(`Evento DocuSign nuevo registrado: ${eventId}`, {
            eventId,
            envelopeId,
            eventoTipo,
          });
          return true;
        } catch (insertError) {
          // Error 2627: Violation of UNIQUE KEY constraint
          // Error 2601: Cannot insert duplicate key row
          if (insertError.number === 2627 || insertError.number === 2601) {
            logger.debug(`Evento DocuSign duplicado detectado: ${eventId}`, {
              eventId,
              envelopeId,
              eventoTipo,
            });
            return false;
          }

          // Si la tabla no existe, fallback a permitir
          if (
            insertError.message.includes('Invalid object name') ||
            insertError.message.includes('EventosDocuSignProcessados')
          ) {
            logger.warn('Tabla EventosDocuSignProcessados no existe, permitiendo evento');
            return true;
          }

          // Otro error, propagar
          throw insertError;
        }
      });

      this.logOperation('registrar', true, { eventId, envelopeId, isNew });
      timer.end({ success: true, isNew });
      return isNew;
    } catch (error) {
      logger.error('Error registrando evento DocuSign', error, {
        eventId,
        envelopeId,
        eventoTipo,
        operation: 'registrar',
      });
      metrics.recordError('db_registrarEventoDocuSign_error', error.message);
      timer.end({ error: true });

      // En caso de error, permitir procesar (mejor duplicar que perder evento)
      return true;
    }
  }

  /**
   * Verifica si un evento de DocuSign ya fue procesado
   * @param {string} eventId - ID unico del evento de DocuSign
   * @returns {Promise<boolean>} - true si ya fue procesado (existe)
   */
  async existeEvento(eventId) {
    try {
      return await this.executeQuery(async () => {
        const pool = await this.getPool();

        const result = await pool.request().input('EventId', sql.NVarChar, eventId).query(`
            SELECT 1 AS Existe
            FROM EventosDocuSignProcessados
            WHERE EventId = @EventId
          `);

        return result.recordset.length > 0;
      });
    } catch (error) {
      logger.error('Error verificando evento DocuSign', error, {
        eventId,
        operation: 'existeEvento',
      });

      // En caso de error, asumir que no existe (permitir procesamiento)
      return false;
    }
  }

  /**
   * Limpia eventos procesados antiguos (mas de 7 dias)
   * Llamado periodicamente por el timer de cleanup
   */
  async cleanOldEvents() {
    try {
      await this.executeQuery(async () => {
        const pool = await this.getPool();
        const result = await pool.request().query(`
          DELETE FROM EventosDocuSignProcessados
          WHERE FechaCreacion < DATEADD(DAY, -7, GETDATE())
        `);

        const deleted = result.rowsAffected[0] || 0;
        if (deleted > 0) {
          logger.info(`Limpieza de eventos DocuSign: ${deleted} registros eliminados (>7 dias)`);
        }
      });
    } catch (error) {
      // Ignorar si la tabla no existe
      if (!error.message.includes('Invalid object name')) {
        logger.error('Error limpiando eventos DocuSign antiguos', error);
      }
    }
  }
}

// Singleton
const instance = new EventoDocuSignRepository();

module.exports = instance;
