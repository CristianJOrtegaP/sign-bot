/**
 * AC FIXBOT - Dead Letter Service
 * Guarda mensajes que fallaron durante el procesamiento para reintento posterior
 *
 * FASE 3: Soporta Azure Service Bus con fallback automático a tabla SQL
 *
 * Uso:
 * - Cuando un mensaje falla, se guarda en Service Bus (si habilitado) o tabla SQL
 * - Un proceso posterior puede reintentar los mensajes fallidos
 * - Permite analisis de errores y patrones de fallo
 */

const sql = require('mssql');
const { getPool, executeWithRetry } = require('../storage/connectionPool');
const { logger } = require('./errorHandler');
const correlation = require('./correlationService');
const config = require('../../config');

// Service Bus service (lazy load para evitar dependencia circular)
let serviceBusService = null;

/**
 * Obtiene el servicio de Service Bus de forma lazy
 * @returns {Object|null}
 */
function getServiceBusService() {
  if (serviceBusService === null && config.serviceBus.enabled) {
    try {
      serviceBusService = require('../messaging/serviceBusService');
    } catch (_error) {
      logger.debug('[DeadLetter] Service Bus service no disponible');
      serviceBusService = false; // Marcar como no disponible
    }
  }
  return serviceBusService || null;
}

/**
 * Guarda un mensaje fallido en la dead letter queue
 * FASE 3: Intenta Service Bus primero, fallback a SQL
 *
 * @param {Object} messageData - Datos del mensaje
 * @param {string} messageData.messageId - ID del mensaje de WhatsApp
 * @param {string} messageData.from - Numero de telefono
 * @param {string} messageData.type - Tipo de mensaje (text, image, interactive, location)
 * @param {string|Object} messageData.content - Contenido del mensaje
 * @param {Error} error - Error que causo el fallo
 * @returns {Promise<boolean>} - true si se guardo correctamente
 */
async function saveFailedMessage(messageData, error) {
  const { messageId, from, type: _type, content: _content } = messageData;

  if (!messageId || !from) {
    logger.warn('[DeadLetter] No se puede guardar mensaje sin ID o telefono', { messageId, from });
    return false;
  }

  // FASE 3: Intentar Service Bus primero si está habilitado
  const sbService = getServiceBusService();
  if (sbService && !sbService.isUsingFallback()) {
    try {
      const result = await sbService.sendToDeadLetter(messageData, error);
      if (result) {
        logger.debug('[DeadLetter] Mensaje guardado en Service Bus');
        return true;
      }
    } catch (sbError) {
      logger.warn('[DeadLetter] Error con Service Bus, usando SQL', { error: sbError.message });
    }
  }

  // Fallback: Guardar en tabla SQL
  return saveFailedMessageToSQL(messageData, error);
}

/**
 * Guarda un mensaje fallido en la tabla SQL (fallback o modo principal)
 * @private
 */
async function saveFailedMessageToSQL(messageData, error) {
  const { messageId, from, type, content } = messageData;

  try {
    await executeWithRetry(async () => {
      const pool = await getPool();

      // Serializar contenido si es objeto
      const contentStr =
        typeof content === 'object' ? JSON.stringify(content) : (content || '').substring(0, 4000); // Limitar tamanio

      // Calcular siguiente reintento (exponential backoff: 1min, 5min, 15min)
      const retryDelays = [1, 5, 15]; // minutos
      const nextRetryMinutes = retryDelays[0];

      await pool
        .request()
        .input('messageId', sql.NVarChar, messageId)
        .input('telefono', sql.NVarChar, from)
        .input('tipoMensaje', sql.NVarChar, type || 'unknown')
        .input('contenido', sql.NVarChar, contentStr)
        .input('correlationId', sql.NVarChar, correlation.getCorrelationId())
        .input('errorMessage', sql.NVarChar, (error?.message || 'Unknown error').substring(0, 1000))
        .input('errorStack', sql.NVarChar, error?.stack?.substring(0, 4000))
        .input('errorCode', sql.NVarChar, error?.code || error?.name)
        .input('nextRetryMinutes', sql.Int, nextRetryMinutes).query(`
                    INSERT INTO DeadLetterMessages
                        (WhatsAppMessageId, Telefono, TipoMensaje, Contenido, CorrelationId,
                         ErrorMessage, ErrorStack, ErrorCode, NextRetryAt)
                    VALUES
                        (@messageId, @telefono, @tipoMensaje, @contenido, @correlationId,
                         @errorMessage, @errorStack, @errorCode, DATEADD(MINUTE, @nextRetryMinutes, GETDATE()))
                `);

      logger.info('[DeadLetter] Mensaje guardado para reintento', {
        messageId,
        from,
        type,
        errorCode: error?.code,
        nextRetryMinutes,
      });
    });

    return true;
  } catch (saveError) {
    // Si falla guardar en dead letter, solo loguear (no perder el error original)
    // Puede ser que la tabla no exista aun
    if (
      saveError.message?.includes('Invalid object name') ||
      saveError.message?.includes('DeadLetterMessages')
    ) {
      logger.debug('[DeadLetter] Tabla no existe, ignorando');
    } else {
      logger.error('[DeadLetter] Error guardando mensaje fallido', saveError, {
        originalMessageId: messageId,
        originalError: error?.message,
      });
    }
    return false;
  }
}

/**
 * Marca un mensaje como procesado exitosamente (despues de reintento)
 * @param {number} deadLetterId - ID del registro en dead letter
 * @returns {Promise<boolean>}
 */
async function markAsProcessed(deadLetterId) {
  try {
    await executeWithRetry(async () => {
      const pool = await getPool();
      await pool.request().input('id', sql.Int, deadLetterId).query(`
                    UPDATE DeadLetterMessages
                    SET Estado = 'PROCESSED',
                        ProcessedAt = GETDATE(),
                        FechaActualizacion = GETDATE()
                    WHERE DeadLetterId = @id
                `);
    });
    logger.info('[DeadLetter] Mensaje marcado como procesado', { deadLetterId });
    return true;
  } catch (error) {
    logger.error('[DeadLetter] Error marcando mensaje como procesado', error, { deadLetterId });
    return false;
  }
}

/**
 * Marca un mensaje como omitido (no se puede reprocesar)
 * @param {number} deadLetterId - ID del registro en dead letter
 * @param {string} reason - Razón por la que se omitió
 * @returns {Promise<boolean>}
 */
async function markAsSkipped(deadLetterId, reason) {
  try {
    await executeWithRetry(async () => {
      const pool = await getPool();
      await pool
        .request()
        .input('id', sql.Int, deadLetterId)
        .input('reason', sql.NVarChar, (reason || 'Skipped').substring(0, 1000)).query(`
          UPDATE DeadLetterMessages
          SET Estado = 'SKIPPED',
              ErrorMessage = @reason,
              FechaActualizacion = GETDATE()
          WHERE DeadLetterId = @id
        `);
    });
    logger.info('[DeadLetter] Mensaje marcado como omitido', { deadLetterId, reason });
    return true;
  } catch (error) {
    logger.error('[DeadLetter] Error marcando mensaje como omitido', error, { deadLetterId });
    return false;
  }
}

/**
 * Incrementa el contador de reintentos y actualiza estado
 * @param {number} deadLetterId - ID del registro
 * @param {Error} error - Error del reintento fallido
 * @returns {Promise<boolean>}
 */
async function recordRetryFailure(deadLetterId, error) {
  try {
    await executeWithRetry(async () => {
      const pool = await getPool();

      // Calcular siguiente reintento con backoff exponencial
      await pool
        .request()
        .input('id', sql.Int, deadLetterId)
        .input('errorMessage', sql.NVarChar, (error?.message || 'Retry failed').substring(0, 1000))
        .query(`
                    UPDATE DeadLetterMessages
                    SET RetryCount = RetryCount + 1,
                        LastRetryAt = GETDATE(),
                        ErrorMessage = @errorMessage,
                        NextRetryAt = CASE
                            WHEN RetryCount + 1 >= MaxRetries THEN NULL
                            ELSE DATEADD(MINUTE, POWER(5, RetryCount + 1), GETDATE())
                        END,
                        Estado = CASE
                            WHEN RetryCount + 1 >= MaxRetries THEN 'FAILED'
                            ELSE 'RETRYING'
                        END,
                        FechaActualizacion = GETDATE()
                    WHERE DeadLetterId = @id
                `);
    });

    logger.warn('[DeadLetter] Reintento fallido registrado', {
      deadLetterId,
      error: error?.message,
    });
    return true;
  } catch (saveError) {
    logger.error('[DeadLetter] Error registrando fallo de reintento', saveError, { deadLetterId });
    return false;
  }
}

/**
 * Obtiene mensajes pendientes de reintento
 * @param {number} maxMessages - Maximo de mensajes a obtener
 * @returns {Promise<Array>}
 */
async function getMessagesForRetry(maxMessages = 10) {
  try {
    return executeWithRetry(async () => {
      const pool = await getPool();
      const result = await pool
        .request()
        .input('maxMessages', sql.Int, maxMessages)
        .execute('sp_GetDeadLettersForRetry');

      return result.recordset || [];
    });
  } catch (error) {
    // Si el SP o tabla no existe, retornar array vacio
    if (
      error.message?.includes('Invalid object name') ||
      error.message?.includes('Could not find stored procedure')
    ) {
      return [];
    }
    logger.error('[DeadLetter] Error obteniendo mensajes para reintento', error);
    return [];
  }
}

/**
 * Limpia mensajes antiguos ya procesados o fallidos permanentemente
 * @param {number} daysToKeep - Dias a mantener
 * @returns {Promise<number>} - Numero de mensajes eliminados
 */
async function cleanOldMessages(daysToKeep = 7) {
  try {
    return executeWithRetry(async () => {
      const pool = await getPool();
      const result = await pool
        .request()
        .input('daysToKeep', sql.Int, daysToKeep)
        .execute('sp_CleanOldDeadLetters');

      const deleted = result.recordset?.[0]?.DeletedCount || 0;
      if (deleted > 0) {
        logger.info('[DeadLetter] Mensajes antiguos limpiados', { deleted, daysToKeep });
      }
      return deleted;
    });
  } catch (error) {
    // Si el SP no existe, ignorar
    if (!error.message?.includes('Could not find stored procedure')) {
      logger.error('[DeadLetter] Error limpiando mensajes antiguos', error);
    }
    return 0;
  }
}

/**
 * Obtiene estadisticas de la dead letter queue
 * @returns {Promise<Object>}
 */
async function getStats() {
  try {
    return await executeWithRetry(async () => {
      const pool = await getPool();
      const result = await pool.request().query(`
                SELECT
                    Estado,
                    COUNT(*) as Count,
                    AVG(RetryCount) as AvgRetries
                FROM DeadLetterMessages
                WHERE FechaCreacion > DATEADD(DAY, -7, GETDATE())
                GROUP BY Estado
            `);

      const stats = { total: 0, byStatus: {} };
      for (const row of result.recordset || []) {
        stats.byStatus[row.Estado] = {
          count: row.Count,
          avgRetries: row.AvgRetries,
        };
        stats.total += row.Count;
      }
      return stats;
    });
  } catch (_error) {
    // Si la tabla no existe, retornar stats vacias
    return { total: 0, byStatus: {}, error: 'Table not available' };
  }
}

/**
 * Obtiene información sobre el modo de operación del DLQ
 * @returns {Object}
 */
function getMode() {
  const sbService = getServiceBusService();
  if (sbService && !sbService.isUsingFallback()) {
    return {
      mode: 'servicebus',
      serviceBusEnabled: true,
      ...sbService.getStats(),
    };
  }
  return {
    mode: 'sql',
    serviceBusEnabled: config.serviceBus.enabled,
    reason: config.serviceBus.enabled ? 'Service Bus using fallback' : 'Service Bus disabled',
  };
}

module.exports = {
  saveFailedMessage,
  markAsProcessed,
  markAsSkipped,
  recordRetryFailure,
  getMessagesForRetry,
  cleanOldMessages,
  getStats,
  getMode,
};
