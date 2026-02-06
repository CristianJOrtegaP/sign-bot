/**
 * AC FIXBOT - Queue Message Processor
 * Service Bus trigger que procesa mensajes de WhatsApp de forma asíncrona.
 * Desacopla la recepción del webhook del procesamiento de mensajes.
 *
 * Flujo:
 * 1. Webhook recibe mensaje → valida firma → dedup → encola en Service Bus
 * 2. Este trigger lee de la cola → restaura correlationId → procesa el mensaje
 * 3. Si falla → Azure Functions abandona el mensaje (vuelve a la cola)
 * 4. Si excede maxDeliveryCount → Azure lo mueve a DLQ nativo
 */

const appInsights = require('../core/services/infrastructure/appInsightsService');
appInsights.initialize();

const { processMessageByType } = require('../core/services/processing/messageRouter');
const deadLetter = require('../core/services/infrastructure/deadLetterService');
const { logger: _logger } = require('../core/services/infrastructure/errorHandler');
const { TimeoutBudget } = require('../core/utils/requestTimeout');

// Timeout de procesamiento: 4 min (function timeout es 5 min)
const PROCESSING_TIMEOUT_MS = 4 * 60 * 1000;

/**
 * Crea funciones de logging con correlation ID
 */
function createLoggers(context, correlationId) {
  return {
    log: (msg, ...args) => context.log(`[${correlationId}] ${msg}`, ...args),
    logWarn: (msg, ...args) => context.log.warn(`[${correlationId}] ${msg}`, ...args),
    logError: (msg, ...args) => context.log.error(`[${correlationId}] ${msg}`, ...args),
  };
}

module.exports = async function (context, queueMessage) {
  const payload = queueMessage;
  const correlationId = payload.correlationId || 'queue-no-correlation';

  // Restaurar correlation ID en contexto
  context.correlationId = correlationId;

  const { log, logError } = createLoggers(context, correlationId);

  log(
    `Queue processor: mensaje recibido | From: ${payload.from} | Type: ${payload.message?.type} | MsgID: ${payload.messageId}`
  );

  // Timeout wrapper para evitar que un mensaje cuelgue la función
  const timeoutPromise = new Promise((_resolve, reject) => {
    setTimeout(
      () => reject(new Error('Processing timeout exceeded (4 min)')),
      PROCESSING_TIMEOUT_MS
    );
  });

  // TimeoutBudget coordinado: las operaciones internas ajustan sus timeouts al presupuesto restante
  const budget = new TimeoutBudget(PROCESSING_TIMEOUT_MS, correlationId);

  try {
    await Promise.race([
      processMessageByType(payload.message, payload.from, payload.messageId, context, log, budget),
      timeoutPromise,
    ]);

    log('Queue processor: mensaje procesado exitosamente');
    // autoCompleteMessages=true en host.json → Azure Functions completa el mensaje
  } catch (error) {
    logError('Queue processor: error procesando mensaje', error);

    // Guardar en DLQ para trazabilidad
    try {
      await deadLetter.saveFailedMessage(
        {
          messageId: payload.messageId,
          from: payload.from,
          type: payload.message?.type,
          content:
            payload.message?.text?.body ||
            payload.message?.interactive?.button_reply?.id ||
            'queue-message',
        },
        error
      );
    } catch (dlqError) {
      logError('Queue processor: error guardando en DLQ', dlqError);
    }

    // Re-throw para que Azure Functions abandone el mensaje (reintento automático)
    throw error;
  }
};
