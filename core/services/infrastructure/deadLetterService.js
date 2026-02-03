/**
 * AC FIXBOT - Dead Letter Service
 * Guarda mensajes que fallaron durante el procesamiento para reintento posterior
 *
 * Uso:
 * - Cuando un mensaje falla, se guarda en la tabla DeadLetterMessages
 * - Un proceso posterior puede reintentar los mensajes fallidos
 * - Permite analisis de errores y patrones de fallo
 */

const sql = require('mssql');
const { getPool, executeWithRetry } = require('../storage/connectionPool');
const { logger } = require('./errorHandler');
const correlation = require('./correlationService');

/**
 * Guarda un mensaje fallido en la dead letter queue
 * @param {Object} messageData - Datos del mensaje
 * @param {string} messageData.messageId - ID del mensaje de WhatsApp
 * @param {string} messageData.from - Numero de telefono
 * @param {string} messageData.type - Tipo de mensaje (text, image, interactive, location)
 * @param {string|Object} messageData.content - Contenido del mensaje
 * @param {Error} error - Error que causo el fallo
 * @returns {Promise<boolean>} - true si se guardo correctamente
 */
async function saveFailedMessage(messageData, error) {
    const { messageId, from, type, content } = messageData;

    if (!messageId || !from) {
        logger.warn('[DeadLetter] No se puede guardar mensaje sin ID o telefono', { messageId, from });
        return false;
    }

    try {
        await executeWithRetry(async () => {
            const pool = await getPool();

            // Serializar contenido si es objeto
            const contentStr = typeof content === 'object'
                ? JSON.stringify(content)
                : (content || '').substring(0, 4000); // Limitar tamanio

            // Calcular siguiente reintento (exponential backoff: 1min, 5min, 15min)
            const retryDelays = [1, 5, 15]; // minutos
            const nextRetryMinutes = retryDelays[0];

            await pool.request()
                .input('messageId', sql.NVarChar, messageId)
                .input('telefono', sql.NVarChar, from)
                .input('tipoMensaje', sql.NVarChar, type || 'unknown')
                .input('contenido', sql.NVarChar, contentStr)
                .input('correlationId', sql.NVarChar, correlation.getCorrelationId())
                .input('errorMessage', sql.NVarChar, (error?.message || 'Unknown error').substring(0, 1000))
                .input('errorStack', sql.NVarChar, error?.stack?.substring(0, 4000))
                .input('errorCode', sql.NVarChar, error?.code || error?.name)
                .input('nextRetryMinutes', sql.Int, nextRetryMinutes)
                .query(`
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
                nextRetryMinutes
            });
        });

        return true;
    } catch (saveError) {
        // Si falla guardar en dead letter, solo loguear (no perder el error original)
        // Puede ser que la tabla no exista aun
        if (saveError.message?.includes('Invalid object name') ||
            saveError.message?.includes('DeadLetterMessages')) {
            logger.debug('[DeadLetter] Tabla no existe, ignorando');
        } else {
            logger.error('[DeadLetter] Error guardando mensaje fallido', saveError, {
                originalMessageId: messageId,
                originalError: error?.message
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
            await pool.request()
                .input('id', sql.Int, deadLetterId)
                .query(`
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
            await pool.request()
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

        logger.warn('[DeadLetter] Reintento fallido registrado', { deadLetterId, error: error?.message });
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
        return await executeWithRetry(async () => {
            const pool = await getPool();
            const result = await pool.request()
                .input('maxMessages', sql.Int, maxMessages)
                .execute('sp_GetDeadLettersForRetry');

            return result.recordset || [];
        });
    } catch (error) {
        // Si el SP o tabla no existe, retornar array vacio
        if (error.message?.includes('Invalid object name') ||
            error.message?.includes('Could not find stored procedure')) {
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
        return await executeWithRetry(async () => {
            const pool = await getPool();
            const result = await pool.request()
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
                    avgRetries: row.AvgRetries
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

module.exports = {
    saveFailedMessage,
    markAsProcessed,
    recordRetryFailure,
    getMessagesForRetry,
    cleanOldMessages,
    getStats
};
