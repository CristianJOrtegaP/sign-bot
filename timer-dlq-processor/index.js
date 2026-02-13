/**
 * SIGN BOT - Dead Letter Queue Processor
 * Timer trigger que procesa automaticamente mensajes fallidos
 *
 * Schedule: Cada 10 minutos (cron: 0 *\/10 * * * *)
 *
 * Flujo:
 * 1. Obtiene mensajes pendientes de retry desde DeadLetterMessages
 * 2. Intenta reprocesar cada mensaje
 * 3. Marca como PROCESSED si tiene exito
 * 4. Incrementa RetryCount y marca como FAILED si excede MaxRetries
 * 5. Envia alertas si hay mensajes fallidos criticos
 */

const deadLetterService = require('../core/services/infrastructure/deadLetterService');
const alertingService = require('../core/services/infrastructure/alertingService');
const { processMessageByType } = require('../core/services/processing/messageRouter');

// ==============================================================
// CONFIGURACION
// ==============================================================

const MAX_MESSAGES_PER_RUN = 10; // Procesar maximo 10 mensajes por ejecucion
const PROCESSING_TIMEOUT_MS = 30000; // 30s timeout por mensaje

// ==============================================================
// MENSAJE REPROCESSING
// ==============================================================

/**
 * Intenta reprocesar un mensaje del DLQ
 */
async function reprocessMessage(dlMessage, context) {
  context.log.info(`[DLQ] Reprocesando mensaje`, {
    deadLetterId: dlMessage.DeadLetterId,
    messageId: dlMessage.WhatsAppMessageId,
    telefono: dlMessage.Telefono,
    retryCount: dlMessage.RetryCount,
  });

  try {
    // Imagenes >24h: media ID de WhatsApp ya expiro, no tiene sentido reintentar
    if (dlMessage.TipoMensaje === 'image') {
      const messageAge = Date.now() - new Date(dlMessage.FechaCreacion).getTime();
      const hoursOld = messageAge / (1000 * 60 * 60);
      if (hoursOld > 24) {
        const reason = `Media ID expirado (${hoursOld.toFixed(1)}h > 24h)`;
        context.log.warn(`[DLQ] ${reason}`, {
          deadLetterId: dlMessage.DeadLetterId,
          messageId: dlMessage.WhatsAppMessageId,
        });
        await deadLetterService.markAsSkipped(dlMessage.DeadLetterId, reason);
        return { success: false, skipped: true };
      }
    }

    // Reconstruir el mensaje para pasarlo por messageRouter
    const { WhatsAppMessageId: msgId, Telefono: from, TipoMensaje: tipo, Contenido } = dlMessage;
    let message;

    switch (tipo) {
      case 'text':
        message = { type: 'text', text: { body: Contenido } };
        break;
      case 'image': {
        let imageData;
        try {
          imageData = JSON.parse(Contenido);
        } catch (_parseErr) {
          throw new Error(`JSON malformado en contenido de imagen: ${Contenido?.substring(0, 50)}`);
        }
        message = { type: 'image', image: imageData };
        break;
      }
      case 'interactive': {
        let payload;
        try {
          payload = JSON.parse(Contenido);
        } catch (_parseErr) {
          throw new Error(
            `JSON malformado en contenido interactivo: ${Contenido?.substring(0, 50)}`
          );
        }
        message = { type: 'interactive', interactive: { button_reply: payload } };
        break;
      }
      default:
        throw new Error(`Tipo de mensaje no soportado para reprocessing: ${tipo}`);
    }

    const log = (msg, ...args) => context.log(`[DLQ:${msgId}] ${msg}`, ...args);

    const processingPromise = processMessageByType(message, from, msgId, context, log);

    const timeoutPromise = new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error('Processing timeout')), PROCESSING_TIMEOUT_MS);
    });

    await Promise.race([processingPromise, timeoutPromise]);

    // Exito - marcar como procesado
    await deadLetterService.markAsProcessed(dlMessage.DeadLetterId);

    context.log.info(`[DLQ] Mensaje reprocesado exitosamente`, {
      deadLetterId: dlMessage.DeadLetterId,
      messageId: dlMessage.WhatsAppMessageId,
    });

    return { success: true };
  } catch (error) {
    // Fallo - registrar reintento fallido
    context.log.error(`[DLQ] Error reprocesando mensaje`, {
      deadLetterId: dlMessage.DeadLetterId,
      messageId: dlMessage.WhatsAppMessageId,
      error: error.message,
      retryCount: dlMessage.RetryCount,
    });

    await deadLetterService.recordRetryFailure(dlMessage.DeadLetterId, error);

    return {
      success: false,
      error: error.message,
      reachedMaxRetries: dlMessage.RetryCount + 1 >= dlMessage.MaxRetries,
    };
  }
}

/**
 * Procesa batch de mensajes del DLQ
 */
async function processBatch(messages, context) {
  const results = {
    processed: 0,
    failed: 0,
    skipped: 0,
    permanentlyFailed: 0,
    errors: [],
  };

  for (const message of messages) {
    const result = await reprocessMessage(message, context);

    if (result.success) {
      results.processed++;
    } else if (result.skipped) {
      results.skipped++;
    } else {
      results.failed++;
      if (result.reachedMaxRetries) {
        results.permanentlyFailed++;
        results.errors.push({
          messageId: message.WhatsAppMessageId,
          telefono: message.Telefono,
          error: result.error,
        });
      }
    }
  }

  return results;
}

// ==============================================================
// ALERTING
// ==============================================================

/**
 * Envia alertas sobre mensajes fallidos permanentemente
 */
async function sendAlertForPermanentFailures(results, context) {
  if (results.permanentlyFailed === 0) {
    return;
  }

  try {
    const severity = results.permanentlyFailed >= 5 ? 'CRITICAL' : 'WARNING';
    const message = `${results.permanentlyFailed} mensaje(s) fallaron permanentemente en DLQ`;

    await alertingService.sendManualAlert(severity, 'dlq_permanent_failure', message, {
      permanentlyFailed: results.permanentlyFailed,
      processed: results.processed,
      failed: results.failed,
      errors: results.errors.slice(0, 3), // Solo primeros 3 errores
    });

    context.log.warn(`[DLQ] Alerta enviada por fallos permanentes`, {
      permanentlyFailed: results.permanentlyFailed,
    });
  } catch (error) {
    context.log.error('[DLQ] Error enviando alerta', { error: error.message });
  }
}

// ==============================================================
// CLEANUP
// ==============================================================

/**
 * Limpia mensajes antiguos (ya procesados o fallidos)
 */
async function cleanupOldMessages(context) {
  try {
    const daysToKeep = parseInt(process.env.DLQ_CLEANUP_DAYS || '7');
    const deleted = await deadLetterService.cleanOldMessages(daysToKeep);

    if (deleted > 0) {
      context.log.info(`[DLQ] Mensajes antiguos limpiados`, {
        deleted,
        daysToKeep,
      });
    }
  } catch (error) {
    context.log.error('[DLQ] Error en cleanup', { error: error.message });
  }
}

// ==============================================================
// MAIN HANDLER
// ==============================================================

module.exports = async function (context, _myTimer) {
  const startTime = Date.now();
  context.log.info('[DLQ Processor] Iniciando procesamiento de dead letter queue');

  try {
    // 1. Obtener estadisticas actuales
    const stats = await deadLetterService.getStats();
    context.log.info('[DLQ] Estadisticas actuales', {
      total: stats.total,
      byStatus: stats.byStatus,
    });

    // 2. Obtener mensajes pendientes de retry
    const messages = await deadLetterService.getMessagesForRetry(MAX_MESSAGES_PER_RUN);

    if (messages.length === 0) {
      context.log.info('[DLQ] No hay mensajes pendientes de procesamiento');

      // Cleanup periodico aunque no haya mensajes
      await cleanupOldMessages(context);
      return;
    }

    context.log.info(`[DLQ] Procesando ${messages.length} mensaje(s) del DLQ`);

    // 3. Procesar batch de mensajes
    const results = await processBatch(messages, context);

    // 4. Log resultados
    const duration = Date.now() - startTime;
    context.log.info('[DLQ Processor] Procesamiento completado', {
      duration_ms: duration,
      processed: results.processed,
      failed: results.failed,
      skipped: results.skipped,
      permanentlyFailed: results.permanentlyFailed,
      total: messages.length,
    });

    // 5. Enviar alertas si hay fallos permanentes
    await sendAlertForPermanentFailures(results, context);

    // 6. Cleanup periodico
    await cleanupOldMessages(context);
  } catch (error) {
    context.log.error('[DLQ Processor] Error en procesamiento', {
      error: error.message,
      stack: error.stack,
    });

    // Enviar alerta por error critico en el processor
    try {
      await alertingService.sendManualAlert(
        'CRITICAL',
        'dlq_processor_failure',
        'Error critico en DLQ Processor',
        { error: error.message }
      );
    } catch (alertError) {
      context.log.error('[DLQ] Error enviando alerta', { error: alertError.message });
    }
  }
};
