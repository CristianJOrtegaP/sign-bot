/**
 * SIGN BOT - Webhook Principal
 * Recibe mensajes de WhatsApp y los procesa
 * Incluye correlation ID para tracing distribuido
 */

// IMPORTANTE: Application Insights debe inicializarse ANTES de cualquier otro require
const appInsights = require('../core/services/infrastructure/appInsightsService');
appInsights.initialize();

const { processMessageByType } = require('../core/services/processing/messageRouter');
const serviceBus = require('../core/services/messaging/serviceBusService');
const config = require('../core/config');
const { TimeoutBudget } = require('../core/utils/requestTimeout');
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
 * Maneja verificacion del webhook (GET request de Meta)
 */
function handleWebhookVerification(context, req, log) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  log('Verificacion webhook - Mode:', mode, 'Token:', token);

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    log('Webhook verificado exitosamente');
    return { status: 200, body: Number(challenge) || challenge };
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
 * Registra mensaje y verifica si es duplicado (IDEMPOTENTE)
 * Usa MERGE atomico en BD para tracking de reintentos
 *
 * IMPORTANTE: Esta funcion SIEMPRE devuelve 200 OK (idempotencia)
 * - Si es nuevo: registra y permite procesamiento
 * - Si es duplicado: incrementa contador de reintentos, NO procesa logica de negocio
 *
 * @param {Object} message - Mensaje de WhatsApp
 * @param {string} from - Numero de telefono del remitente
 * @param {Function} log - Funcion de logging
 * @param {Function} logWarn - Funcion de logging de warnings
 * @returns {Promise<{isDuplicate: boolean, retryCount: number}>}
 */
async function checkAndRegisterMessage(message, from, log, logWarn) {
  const messageId = message.id;

  // 1. Verificar en memoria (rapido)
  if (rateLimiter.isDuplicateMessage(messageId)) {
    log(`[Dedup] Mensaje duplicado ignorado (memoria): ${messageId}`);
    return { isDuplicate: true, retryCount: 0 };
  }

  // 2. Registrar en base de datos de forma atomica (MERGE)
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
    // Para botones interactivos: si falla BD, NO procesar (evitar race conditions)
    if (message.type === 'interactive') {
      logWarn(`[Dedup] Error BD en boton interactivo, ignorando: ${dbError.message}`);
      return { isDuplicate: true, retryCount: 0 };
    }

    // Para otros mensajes: si falla BD, permitir procesamiento (mejor duplicar que perder)
    logWarn(`[Dedup] Error registrando en BD, continuando: ${dbError.message}`);
    return { isDuplicate: false, retryCount: 0 };
  }
}

/**
 * Guarda mensaje fallido en Dead Letter Queue
 * CRITICO: Siempre loguear errores de DLQ para no perder trazabilidad
 */
function saveToDeadLetter(message, error, logError) {
  let messageContent;
  try {
    messageContent = message.text?.body || message.interactive?.button_reply?.id || null;
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
      // CRITICO: Nunca silenciar errores de DLQ - loguear siempre
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
    // ============================================================
    // VALIDACION DE FIRMA - SEGURIDAD CRITICA
    // ============================================================
    // La firma X-Hub-Signature-256 es OBLIGATORIA en produccion.
    // SKIP_SIGNATURE_VALIDATION SOLO funciona en desarrollo local.
    // Cualquier ambiente Azure SIEMPRE valida la firma.
    // ============================================================

    // Detectar ambiente de produccion (multiples signals para Azure)
    const isAzureEnvironment =
      process.env.AZURE_FUNCTIONS_ENVIRONMENT ||
      process.env.WEBSITE_SITE_NAME ||
      process.env.FUNCTIONS_WORKER_RUNTIME;

    const isProductionEnv = process.env.NODE_ENV === 'production';
    const isAzureProduction = process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Production';

    // Produccion = cualquier ambiente Azure O NODE_ENV=production
    const isProduction = isAzureEnvironment || isProductionEnv || isAzureProduction;

    // El bypass SOLO funciona en desarrollo local (fuera de Azure)
    const skipValidationRequested = process.env.SKIP_SIGNATURE_VALIDATION === 'true';

    // SEGURIDAD: En cualquier ambiente Azure, SIEMPRE validar
    if (skipValidationRequested && isProduction) {
      logError('SEGURIDAD: SKIP_SIGNATURE_VALIDATION ignorado en ambiente Azure/produccion', {
        isAzureEnvironment: Boolean(isAzureEnvironment),
        nodeEnv: process.env.NODE_ENV,
        azureFunctionsEnv: process.env.AZURE_FUNCTIONS_ENVIRONMENT,
      });
    }

    // SIEMPRE validar en produccion, independiente del flag
    const mustValidateSignature = isProduction || !skipValidationRequested;

    if (mustValidateSignature) {
      const signature = req.headers['x-hub-signature-256'];
      const rawBody = req.rawBody || JSON.stringify(req.body);

      if (!security.verifyWebhookSignature(rawBody, signature)) {
        logWarn('Firma del webhook invalida - request rechazado', {
          hasSignature: Boolean(signature),
          correlationId,
        });
        context.res = { status: 401, body: 'Invalid signature' };
        return;
      }
    } else {
      // Solo en desarrollo local, nunca en Azure
      logWarn('DEV: Validacion de firma omitida (SKIP_SIGNATURE_VALIDATION=true)');
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
        // Actualizar nombre de usuario en la sesion (async, no bloquea)
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

      // Enqueue-or-fallback: si Service Bus esta habilitado, encolar para procesamiento async
      let enqueued = false;
      if (config.isServiceBusEnabled) {
        enqueued = await serviceBus.sendToQueue({
          message,
          from,
          messageId,
          profileName,
          correlationId,
          enqueuedAt: new Date().toISOString(),
        });
        if (enqueued) {
          log(`Mensaje encolado en Service Bus para procesamiento async`);
        }
      }

      // Fallback: procesar sincronicamente si SB deshabilitado o enqueue fallo
      if (!enqueued) {
        const budget = new TimeoutBudget(240000, correlationId);
        await processMessageByType(message, from, messageId, context, log, budget);
      }

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
