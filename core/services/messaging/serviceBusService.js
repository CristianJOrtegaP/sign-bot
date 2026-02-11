/**
 * Sign Bot - Azure Service Bus Service
 * Servicio de mensajería para Dead Letter Queue
 * Incluye fallback automático a tabla SQL si Service Bus no está disponible
 *
 * @module services/messaging/serviceBusService
 */

const config = require('../../config');
const { logger } = require('../infrastructure/errorHandler');
const correlation = require('../infrastructure/correlationService');

// Estado de conexión
let serviceBusClient = null;
let sender = null;
let receiver = null;
let isConnected = false;
let usingFallback = false;

// Referencia al deadLetterService SQL para fallback
let sqlDeadLetterService = null;

/**
 * Carga el servicio SQL de DLQ de forma lazy para fallback
 * @returns {Object|null}
 */
function getSqlDeadLetterService() {
  if (!sqlDeadLetterService) {
    try {
      sqlDeadLetterService = require('../infrastructure/deadLetterService');
    } catch (_error) {
      logger.warn('[ServiceBus] No se pudo cargar deadLetterService SQL');
    }
  }
  return sqlDeadLetterService;
}

/**
 * Inicializa la conexión con Azure Service Bus
 * @returns {Promise<boolean>} - true si la conexión fue exitosa
 */
async function connect() {
  // Si Service Bus no está habilitado, usar fallback SQL
  if (!config.serviceBus.enabled) {
    logger.info('[ServiceBus] Service Bus deshabilitado, usando tabla SQL para DLQ');
    usingFallback = true;
    return false;
  }

  // Validar configuración
  if (!config.serviceBus.connectionString) {
    logger.warn('[ServiceBus] Connection string no configurada, usando fallback SQL');
    usingFallback = true;
    return false;
  }

  try {
    // Importar SDK dinámicamente (puede no estar instalado)
    const { ServiceBusClient } = require('@azure/service-bus');

    // Crear cliente
    serviceBusClient = new ServiceBusClient(config.serviceBus.connectionString);

    // Crear sender para la cola principal
    sender = serviceBusClient.createSender(config.serviceBus.queueName);

    // Crear receiver para procesar mensajes
    receiver = serviceBusClient.createReceiver(config.serviceBus.queueName, {
      receiveMode:
        config.serviceBus.receiveMode === 'receiveAndDelete' ? 'receiveAndDelete' : 'peekLock',
    });

    isConnected = true;
    usingFallback = false;
    logger.info('[ServiceBus] Conexión a Azure Service Bus establecida', {
      queue: config.serviceBus.queueName,
    });

    return true;
  } catch (error) {
    // Si el módulo no está instalado
    if (error.code === 'MODULE_NOT_FOUND') {
      logger.warn('[ServiceBus] Módulo @azure/service-bus no instalado, usando fallback SQL');
    } else {
      logger.error('[ServiceBus] Error conectando a Service Bus, usando fallback SQL', error);
    }

    usingFallback = true;
    return false;
  }
}

/**
 * Envía un mensaje fallido a la cola DLQ
 * @param {Object} messageData - Datos del mensaje
 * @param {string} messageData.messageId - ID del mensaje de WhatsApp
 * @param {string} messageData.from - Número de teléfono
 * @param {string} messageData.type - Tipo de mensaje
 * @param {string} messageData.content - Contenido del mensaje
 * @param {Error} error - Error que causó el fallo
 * @returns {Promise<boolean>} - true si se guardó correctamente
 */
async function sendToDeadLetter(messageData, error) {
  const correlationId = correlation.getCorrelationId() || 'no-correlation';

  // Si está usando fallback, usar SQL directo (NO saveFailedMessage para evitar recursión)
  if (usingFallback || !isConnected) {
    const sqlService = getSqlDeadLetterService();
    if (sqlService) {
      return sqlService.saveFailedMessageToSQL(messageData, error);
    }
    logger.error('[ServiceBus] No hay fallback disponible para DLQ');
    return false;
  }

  try {
    const message = {
      body: JSON.stringify({
        ...messageData,
        originalError: {
          message: error?.message,
          code: error?.code,
          name: error?.name,
        },
        timestamp: new Date().toISOString(),
      }),
      messageId: messageData.messageId,
      correlationId: correlationId,
      subject: messageData.type,
      applicationProperties: {
        source: 'signbot-webhook',
        phoneNumber: messageData.from,
        messageType: messageData.type,
        errorCode: error?.code || error?.name || 'UNKNOWN',
      },
      timeToLive: config.serviceBus.messageTimeToLiveMs,
    };

    await sender.sendMessages(message);

    logger.info('[ServiceBus] Mensaje enviado a DLQ', {
      messageId: messageData.messageId,
      type: messageData.type,
    });

    return true;
  } catch (sendError) {
    logger.error('[ServiceBus] Error enviando a Service Bus, usando fallback SQL', sendError);

    // Fallback a SQL directo (NO saveFailedMessage para evitar recursión)
    const sqlService = getSqlDeadLetterService();
    if (sqlService) {
      return sqlService.saveFailedMessageToSQL(messageData, error);
    }

    return false;
  }
}

/**
 * Envía un mensaje a la cola principal para procesamiento asíncrono
 * Usado por el webhook para desacoplar recepción de procesamiento.
 * @param {Object} payload - Datos del mensaje a encolar
 * @param {Object} payload.message - Mensaje de WhatsApp completo
 * @param {string} payload.from - Número de teléfono
 * @param {string} payload.messageId - ID del mensaje de WhatsApp
 * @param {string} payload.correlationId - Correlation ID para tracing
 * @returns {Promise<boolean>} - true si se encoló exitosamente, false si hay que procesar sync
 */
async function sendToQueue(payload) {
  // Si no hay sender disponible, indicar que se debe procesar sync
  if (usingFallback || !isConnected || !sender) {
    return false;
  }

  try {
    const message = {
      body: payload,
      messageId: payload.messageId,
      correlationId: payload.correlationId,
      subject: payload.message?.type || 'unknown',
      applicationProperties: {
        source: 'signbot-webhook',
        phoneNumber: payload.from,
        messageType: payload.message?.type || 'unknown',
        enqueuedAt: new Date().toISOString(),
      },
      timeToLive: config.serviceBus.messageTimeToLiveMs,
    };

    await sender.sendMessages(message);

    logger.info('[ServiceBus] Mensaje encolado para procesamiento async', {
      messageId: payload.messageId,
      type: payload.message?.type,
      from: payload.from,
    });

    return true;
  } catch (error) {
    logger.error('[ServiceBus] Error encolando mensaje, fallback a sync', error, {
      messageId: payload.messageId,
    });
    return false;
  }
}

/**
 * Recibe mensajes de la cola para reprocesamiento
 * @param {number} maxMessages - Máximo de mensajes a recibir
 * @param {number} maxWaitTimeMs - Tiempo máximo de espera
 * @returns {Promise<Array>} - Array de mensajes
 */
async function receiveMessages(maxMessages = 10, maxWaitTimeMs = 5000) {
  // Si está usando fallback, obtener de SQL
  if (usingFallback || !isConnected) {
    const sqlService = getSqlDeadLetterService();
    if (sqlService) {
      return sqlService.getMessagesForRetry(maxMessages);
    }
    return [];
  }

  try {
    const messages = await receiver.receiveMessages(maxMessages, {
      maxWaitTimeInMs: maxWaitTimeMs,
    });

    return messages.map((msg) => {
      let parsedBody;
      try {
        parsedBody = typeof msg.body === 'string' ? JSON.parse(msg.body) : msg.body;
      } catch (parseError) {
        logger.warn('[ServiceBus] Error parseando body de mensaje', {
          messageId: msg.messageId,
          error: parseError.message,
        });
        parsedBody = { raw: msg.body, parseError: true };
      }

      return {
        id: msg.messageId,
        body: parsedBody,
        correlationId: msg.correlationId,
        properties: msg.applicationProperties,
        // Guardar referencia al mensaje original para complete/abandon
        _serviceBusMessage: msg,
      };
    });
  } catch (error) {
    logger.error('[ServiceBus] Error recibiendo mensajes', error);
    return [];
  }
}

/**
 * Marca un mensaje como procesado exitosamente
 * @param {Object} message - Mensaje recibido de receiveMessages()
 * @returns {Promise<boolean>}
 */
async function completeMessage(message) {
  // Si está usando fallback
  if (usingFallback || !isConnected) {
    const sqlService = getSqlDeadLetterService();
    if (sqlService && message.id) {
      return sqlService.markAsProcessed(message.id);
    }
    return false;
  }

  try {
    if (message._serviceBusMessage) {
      await receiver.completeMessage(message._serviceBusMessage);
      logger.debug('[ServiceBus] Mensaje completado', { messageId: message.id });
      return true;
    }
    return false;
  } catch (error) {
    logger.error('[ServiceBus] Error completando mensaje', error);
    return false;
  }
}

/**
 * Marca un mensaje como fallido (volver a la cola o mover a DLQ nativo)
 * @param {Object} message - Mensaje recibido de receiveMessages()
 * @param {Error} error - Error que causó el fallo
 * @returns {Promise<boolean>}
 */
async function abandonMessage(message, error) {
  // Si está usando fallback
  if (usingFallback || !isConnected) {
    const sqlService = getSqlDeadLetterService();
    if (sqlService && message.id) {
      return sqlService.recordRetryFailure(message.id, error);
    }
    return false;
  }

  try {
    if (message._serviceBusMessage) {
      // Abandonar el mensaje (volverá a la cola)
      await receiver.abandonMessage(message._serviceBusMessage, {
        propertiesToModify: {
          lastError: error?.message,
          lastAttempt: new Date().toISOString(),
        },
      });
      logger.debug('[ServiceBus] Mensaje abandonado', { messageId: message.id });
      return true;
    }
    return false;
  } catch (abandonError) {
    logger.error('[ServiceBus] Error abandonando mensaje', abandonError);
    return false;
  }
}

/**
 * Mueve un mensaje directamente a la Dead Letter Queue nativa de Service Bus
 * @param {Object} message - Mensaje recibido de receiveMessages()
 * @param {string} reason - Razón del fallo
 * @returns {Promise<boolean>}
 */
async function deadLetterMessage(message, reason) {
  if (usingFallback || !isConnected || !message._serviceBusMessage) {
    return false;
  }

  try {
    await receiver.deadLetterMessage(message._serviceBusMessage, {
      deadLetterReason: reason,
      deadLetterErrorDescription: `Moved to DLQ: ${reason}`,
    });
    logger.info('[ServiceBus] Mensaje movido a DLQ nativo', { messageId: message.id, reason });
    return true;
  } catch (error) {
    logger.error('[ServiceBus] Error moviendo a DLQ', error);
    return false;
  }
}

/**
 * Obtiene estadísticas del servicio
 * @returns {Object}
 */
function getStats() {
  return {
    mode: usingFallback ? 'sql' : 'servicebus',
    isConnected,
    usingFallback,
    serviceBusEnabled: config.serviceBus.enabled,
    queueName: config.serviceBus.queueName,
  };
}

/**
 * Cierra la conexión con Service Bus
 * @returns {Promise<void>}
 */
async function disconnect() {
  if (serviceBusClient) {
    try {
      await serviceBusClient.close();
      logger.info('[ServiceBus] Desconectado de Azure Service Bus');
    } catch (error) {
      logger.warn('[ServiceBus] Error desconectando', { error: error.message });
    }
    serviceBusClient = null;
    sender = null;
    receiver = null;
    isConnected = false;
  }
}

/**
 * Verifica si está usando fallback SQL
 * @returns {boolean}
 */
function isUsingFallback() {
  return usingFallback;
}

module.exports = {
  connect,
  sendToQueue,
  sendToDeadLetter,
  receiveMessages,
  completeMessage,
  abandonMessage,
  deadLetterMessage,
  getStats,
  disconnect,
  isUsingFallback,
};
