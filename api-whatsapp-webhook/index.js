/**
 * AC FIXBOT - Webhook Principal
 * Recibe mensajes de WhatsApp y los procesa
 * Incluye correlation ID para tracing distribuido
 */

// IMPORTANTE: Application Insights debe inicializarse ANTES de cualquier otro require
const appInsights = require('../core/services/infrastructure/appInsightsService');
appInsights.initialize();

const messageHandler = require('../bot/controllers/messageHandler');
const imageHandler = require('../bot/controllers/imageHandler');
const audioHandler = require('../bot/controllers/audioHandler');
const rateLimiter = require('../core/services/infrastructure/rateLimiter');
const db = require('../core/services/storage/databaseService');
const security = require('../core/services/infrastructure/securityService');
const correlation = require('../core/services/infrastructure/correlationService');
const deadLetter = require('../core/services/infrastructure/deadLetterService');

// ==============================================================
// HELPER FUNCTIONS
// ==============================================================

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

/**
 * Maneja verificación del webhook (GET request de Meta)
 */
function handleWebhookVerification(context, req, log) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  log('Verificacion webhook - Mode:', mode, 'Token:', token);

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    log('Webhook verificado exitosamente');
    return { status: 200, body: parseInt(challenge) };
  }

  log('Verificacion fallida - Token no coincide');
  return { status: 403, body: 'Forbidden' };
}

/**
 * Extrae el mensaje del payload de WhatsApp
 */
function extractMessage(body) {
  const entry = body.entry && body.entry[0];
  const changes = entry && entry.changes && entry.changes[0];
  const value = changes && changes.value;
  const messages = value && value.messages;
  return messages && messages[0];
}

/**
 * Extrae el nombre de perfil del usuario de WhatsApp
 * @param {Object} body - Payload del webhook
 * @returns {string|null} - Nombre del perfil o null
 */
function extractProfileName(body) {
  try {
    const entry = body.entry && body.entry[0];
    const changes = entry && entry.changes && entry.changes[0];
    const value = changes && changes.value;
    const contacts = value && value.contacts;
    const contact = contacts && contacts[0];
    return contact && contact.profile && contact.profile.name;
  } catch (_e) {
    return null;
  }
}

/**
 * Verifica si el mensaje es un botón de encuesta
 */
function isEncuestaButton(message) {
  return (
    message.type === 'interactive' &&
    message.interactive?.button_reply?.id?.startsWith('btn_rating_')
  );
}

/**
 * Registra mensaje y verifica si es duplicado (IDEMPOTENTE)
 * Usa MERGE atómico en BD para tracking de reintentos
 *
 * IMPORTANTE: Esta función SIEMPRE devuelve 200 OK (idempotencia)
 * - Si es nuevo: registra y permite procesamiento
 * - Si es duplicado: incrementa contador de reintentos, NO procesa lógica de negocio
 *
 * @param {Object} message - Mensaje de WhatsApp
 * @param {string} from - Número de teléfono del remitente
 * @param {Function} log - Función de logging
 * @param {Function} logWarn - Función de logging de warnings
 * @returns {Promise<{isDuplicate: boolean, retryCount: number}>}
 */
async function checkAndRegisterMessage(message, from, log, logWarn) {
  const messageId = message.id;

  // 1. Verificar en memoria (rápido)
  if (rateLimiter.isDuplicateMessage(messageId)) {
    log(`[Dedup] Mensaje duplicado ignorado (memoria): ${messageId}`);
    return { isDuplicate: true, retryCount: 0 };
  }

  // 2. Registrar en base de datos de forma atómica (MERGE)
  try {
    const result = await db.registerMessageAtomic(messageId, from);

    if (result.isDuplicate) {
      log(
        `[Dedup] Mensaje duplicado detectado (BD): ${messageId}, reintento #${result.retryCount}`
      );
      return { isDuplicate: true, retryCount: result.retryCount };
    }

    log(`[Dedup] Mensaje nuevo registrado: ${messageId}`);
    return { isDuplicate: false, retryCount: 0 };
  } catch (dbError) {
    // Para botones de encuesta: si falla BD, NO procesar (evitar race conditions)
    if (isEncuestaButton(message)) {
      logWarn(`[Dedup] Error BD en boton encuesta, ignorando: ${dbError.message}`);
      return { isDuplicate: true, retryCount: 0 };
    }

    // Para otros mensajes: si falla BD, permitir procesamiento (mejor duplicar que perder)
    logWarn(`[Dedup] Error registrando en BD, continuando: ${dbError.message}`);
    return { isDuplicate: false, retryCount: 0 };
  }
}

/**
 * Verifica duplicados en memoria y base de datos
 * @deprecated Usar checkAndRegisterMessage() en su lugar (más completo e idempotente)
 */
async function _checkDuplicates(message, log, logWarn) {
  const messageId = message.id;

  // 1. Verificar en memoria (rápido)
  if (rateLimiter.isDuplicateMessage(messageId)) {
    log(`[Dedup] Mensaje duplicado ignorado (memoria): ${messageId}`);
    return { isDuplicate: true };
  }

  // 2. Verificar en base de datos
  try {
    const isProcessedInDB = await db.isMessageProcessed(messageId);
    if (isProcessedInDB) {
      log(`[Dedup] Mensaje duplicado ignorado (BD): ${messageId}`);
      return { isDuplicate: true };
    }
  } catch (dbError) {
    // Para botones de encuesta: si falla BD, NO procesar
    if (isEncuestaButton(message)) {
      logWarn(`[Dedup] Error BD en boton encuesta, ignorando: ${dbError.message}`);
      return { isDuplicate: true };
    }
    logWarn(`[Dedup] Error verificando en BD, continuando: ${dbError.message}`);
  }

  return { isDuplicate: false };
}

/**
 * Procesa mensaje según su tipo
 */
async function processMessageByType(message, from, messageId, context, log) {
  const messageType = message.type;

  switch (messageType) {
    case 'text': {
      const textBody = message.text.body;
      log(`Texto: "${textBody.substring(0, 50)}${textBody.length > 50 ? '...' : ''}"`);
      await messageHandler.handleText(from, textBody, messageId, context);
      break;
    }

    case 'image':
      log('Imagen recibida');
      await imageHandler.handleImage(from, message.image, messageId, context);
      break;

    case 'audio':
      log('Audio recibido');
      await audioHandler.handleAudio(from, message.audio, messageId, context);
      break;

    case 'interactive': {
      const buttonReply = message.interactive && message.interactive.button_reply;
      if (buttonReply) {
        log(`Boton presionado: ${buttonReply.id}`);
        await messageHandler.handleButton(from, buttonReply.id, messageId, context);
      }
      break;
    }

    case 'location': {
      const location = message.location;
      log(`Ubicacion recibida: lat=${location?.latitude}, lng=${location?.longitude}`);
      await messageHandler.handleLocation(from, location, messageId, context);
      break;
    }

    default:
      log(`Tipo de mensaje no manejado: ${messageType}`);
  }
}

/**
 * Guarda mensaje fallido en Dead Letter Queue
 * CRÍTICO: Siempre loguear errores de DLQ para no perder trazabilidad
 */
function saveToDeadLetter(message, error, logError) {
  let messageContent;
  try {
    messageContent =
      message.text?.body ||
      message.interactive?.button_reply?.id ||
      (message.location ? JSON.stringify(message.location) : null) ||
      (message.image ? `image:${message.image.id}` : null) ||
      (message.audio ? `audio:${message.audio.id}` : null);
  } catch (_e) {
    messageContent = 'error-extracting-content';
  }

  deadLetter
    .saveFailedMessage(
      {
        messageId: message.id,
        from: message.from,
        type: message.type,
        content: messageContent,
      },
      error
    )
    .catch((dlqError) => {
      // CRÍTICO: Nunca silenciar errores de DLQ - loguear siempre
      if (logError) {
        logError('Error guardando en Dead Letter Queue - MENSAJE PERDIDO', {
          originalError: error?.message,
          dlqError: dlqError?.message,
          messageId: message.id,
          from: message.from,
          type: message.type,
        });
      }
    });
}

/**
 * Crea respuesta OK con correlation ID
 */
function createOkResponse(correlationId) {
  return {
    status: 200,
    headers: { 'x-correlation-id': correlationId },
    body: 'OK',
  };
}

// ==============================================================
// MAIN HANDLER
// ==============================================================

module.exports = async function (context, req) {
  // Generar correlation ID para tracing distribuido
  const correlationId = correlation.generateCorrelationId();
  context.correlationId = correlationId;

  const { log, logWarn, logError } = createLoggers(context, correlationId);
  log('Webhook recibido:', req.method);

  // ==========================================
  // VERIFICACION DEL WEBHOOK (GET)
  // ==========================================
  if (req.method === 'GET') {
    context.res = handleWebhookVerification(context, req, log);
    return;
  }

  // ==========================================
  // PROCESAR MENSAJES ENTRANTES (POST)
  // ==========================================
  if (req.method === 'POST') {
    // Verificar firma del webhook
    // SKIP_SIGNATURE_VALIDATION solo funciona en desarrollo (NUNCA en producción)
    const isProduction =
      process.env.NODE_ENV === 'production' ||
      process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Production';
    const skipValidation = process.env.SKIP_SIGNATURE_VALIDATION === 'true';

    if (skipValidation && isProduction) {
      logError('CRÍTICO: SKIP_SIGNATURE_VALIDATION no permitido en producción - ignorando flag');
    }

    const shouldValidate = isProduction || !skipValidation;

    if (shouldValidate) {
      const signature = req.headers['x-hub-signature-256'];
      const rawBody = req.rawBody || JSON.stringify(req.body);

      if (!security.verifyWebhookSignature(rawBody, signature)) {
        logWarn('Firma del webhook invalida - request rechazado');
        context.res = { status: 401, body: 'Invalid signature' };
        return;
      }
    } else {
      logWarn('⚠️  SKIP_SIGNATURE_VALIDATION activado - omitiendo validación (solo desarrollo)');
    }

    try {
      const body = req.body;

      // Verificar que es un evento de WhatsApp
      if (body.object !== 'whatsapp_business_account') {
        log('No es un evento de WhatsApp');
        context.res = { status: 200, body: 'OK' };
        return;
      }

      // Extraer mensaje
      const message = extractMessage(body);
      if (!message) {
        log('Notificacion de estado recibida (no es mensaje)');
        context.res = { status: 200, body: 'OK' };
        return;
      }

      const from = message.from;
      const messageType = message.type;
      const messageId = message.id;

      // Extraer nombre de perfil de WhatsApp
      const profileName = extractProfileName(body);
      if (profileName) {
        log(`Perfil WhatsApp: "${profileName}"`);
        // Actualizar nombre de usuario en la sesión (async, no bloquea)
        db.updateUserName(from, profileName).catch((err) => {
          logWarn(`Error actualizando nombre de usuario: ${err.message}`);
        });
      }

      log(`Mensaje recibido de ${from} | Tipo: ${messageType} | MsgID: ${messageId}`);

      // Registrar mensaje y verificar si es duplicado (IDEMPOTENTE)
      const { isDuplicate, retryCount } = await checkAndRegisterMessage(
        message,
        from,
        log,
        logWarn
      );
      if (isDuplicate) {
        log(
          `[Idempotencia] Mensaje ya procesado, devolviendo 200 OK sin reprocesar (reintento #${retryCount})`
        );
        context.res = { status: 200, body: 'OK' };
        return;
      }

      // Procesar mensaje
      await processMessageByType(message, from, messageId, context, log);

      // Responder 200 OK
      context.res = createOkResponse(correlationId);
    } catch (error) {
      logError('Error procesando mensaje:', error);

      // Guardar en Dead Letter Queue
      const message = extractMessage(req.body);
      if (message) {
        saveToDeadLetter(message, error, logError);
      }

      // Siempre responder 200 para evitar reintentos de Meta
      context.res = createOkResponse(correlationId);
    }
  }
};
