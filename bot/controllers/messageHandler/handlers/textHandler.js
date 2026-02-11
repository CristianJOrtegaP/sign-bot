/**
 * SIGN BOT - Handler de Mensajes de Texto
 * Procesa mensajes de texto entrantes de WhatsApp
 */

const whatsapp = require('../../../../core/services/external/whatsappService');
const db = require('../../../../core/services/storage/databaseService');
const rateLimiter = require('../../../../core/services/infrastructure/rateLimiter');
const metrics = require('../../../../core/services/infrastructure/metricsService');
const MSG = require('../../../constants/messages');
const { sanitizeMessage, validatePhoneE164 } = require('../../../../core/utils/helpers');
const FlowManager = require('../../flows/FlowManager');
const teamsService = require('../../../../core/services/external/teamsService');
const {
  ESTADO,
  TIPO_MENSAJE,
  TIPO_CONTENIDO,
  ORIGEN_ACCION,
  esEstadoTerminal,
  esEstadoAgente,
} = require('../../../constants/sessionStates');

const { enforceRateLimit, reactivateSessionIfTerminal } = require('../utils/handlerMiddleware');
const { ConcurrencyError } = require('../../../../core/errors');

// Patrones de texto para deteccion de intenciones simples
const CONSULTA_DOCS_PATTERN =
  /^(mis\s*documentos?|documentos?|ver\s*documentos?|consultar\s*documentos?|pendientes?)$/i;
const AYUDA_PATTERN = /^(ayuda|help|info|informacion)$/i;
const SALUDO_PATTERN = /^(hola|hi|buenos?\s*d[ií]as?|buenas?\s*tardes?|buenas?\s*noches?)$/i;
const DESPEDIDA_PATTERN = /^(adi[oó]s|bye|chao|hasta\s*luego|nos\s*vemos|gracias)$/i;
const CANCELAR_PATTERN = /^(cancelar|salir|terminar|exit)$/i;

/**
 * Procesa un mensaje de texto entrante de WhatsApp
 * @param {string} from - Numero de telefono del remitente (formato E.164)
 * @param {string} text - Contenido del mensaje de texto
 * @param {string} messageId - ID unico del mensaje de WhatsApp
 * @param {Object} context - Contexto de Azure Functions con logging
 * @param {Function} handleButton - Referencia a handleButton para llamadas internas
 * @returns {Promise<void>}
 */
async function handleText(from, text, messageId, context, _handleButton) {
  const timer = metrics.startTimer('message_handling', context);
  context.log(`Procesando texto de ${from}: ${text}`);

  // --- Validacion y seguridad ---
  const securityResult = await validateAndEnforce(from, text, timer, context);
  if (!securityResult.allowed) {
    return;
  }
  text = securityResult.sanitizedText;

  // Mostrar "Escribiendo..." (fire-and-forget, no bloquea el flujo)
  whatsapp.sendTypingIndicator(from, messageId).catch(() => {});

  // PERFORMANCE: Paralelizar saveMessage + getSession (~80ms ahorro)
  const results = await Promise.allSettled([
    db.saveMessage(from, TIPO_MENSAJE.USUARIO, text, TIPO_CONTENIDO.TEXTO),
    db.getSession(from),
  ]);

  // Verificar resultado de saveMessage (no critico, solo logging)
  if (results[0].status === 'rejected') {
    context.log.warn(`Error guardando mensaje: ${results[0].reason?.message}`);
  }

  // Verificar resultado de getSession (critico, debe existir)
  if (results[1].status === 'rejected') {
    context.log.error(`Error obteniendo sesion: ${results[1].reason?.message}`);
    throw results[1].reason;
  }

  const session = results[1].value;
  context.log(`Estado actual de sesion: ${session.Estado}`);

  // HANDOFF: Si la sesion esta siendo atendida por un agente humano,
  // NO procesar con el bot. Solo guardar el mensaje (ya se guardo arriba)
  if (esEstadoAgente(session.Estado)) {
    context.log(`Sesion en modo AGENTE_ACTIVO - mensaje guardado, no se procesa con bot`);
    teamsService
      .notifyMessage(from, 'U', text, {
        estado: session.Estado,
        tipoReporte: 'Atencion por Agente',
      })
      .catch(() => {});
    timer.end({ handledByAgent: true });
    return;
  }

  // Si la sesion esta en un estado terminal, reactivarla a INICIO
  await reactivateSessionIfTerminal(from, session, 'texto', context);

  // Fire-and-forget: actualizar ultima actividad
  db.updateLastActivity(from).catch(() => {});

  try {
    // Intentar procesar segun el estado actual de la sesion (flujos activos)
    const handled = await FlowManager.processSessionState(from, text, session, context);
    if (handled) {
      timer.end({ state: session.Estado });
      return;
    }

    // Si no hay flujo activo, procesar por intencion de texto
    await processTextIntent(from, text, session, context);
    timer.end({ intent: 'text_match' });
  } catch (error) {
    if (error instanceof ConcurrencyError) {
      context.log(`Conflicto de concurrencia en flujo de ${from}`);
      timer.end({ concurrencyConflict: true });
      return;
    }
    throw error;
  }
}

/**
 * Valida input y aplica controles de seguridad (rate limit + spam).
 * @returns {{allowed: boolean, sanitizedText?: string}}
 */
async function validateAndEnforce(from, text, timer, context) {
  // Validar formato de telefono E.164
  const phoneValidation = validatePhoneE164(from);
  if (!phoneValidation.valid) {
    context.log.warn(`Telefono con formato invalido: ${from} - ${phoneValidation.error}`);
  }

  // Sanitizar mensaje de entrada
  const sanitizedText = sanitizeMessage(text);
  if (sanitizedText !== text.trim()) {
    context.log(`Mensaje sanitizado: "${text}" -> "${sanitizedText}"`);
  }

  // Rate limit (middleware compartido)
  const rateLimitResult = await enforceRateLimit(from, 'message');
  if (!rateLimitResult.allowed) {
    context.log(`Rate limit excedido para ${from}`);
    timer.end({ rateLimited: true });
    return { allowed: false };
  }

  // Detectar spam (memoria local)
  if (rateLimiter.isSpamming(from)) {
    context.log(`Spam detectado de ${from} (rate limiter local)`);
    await whatsapp.sendAndSaveText(from, MSG.RATE_LIMIT.SPAM_WARNING);
    timer.end({ spam: true, source: 'local' });
    return { allowed: false };
  }

  // Detectar spam (base de datos)
  const spamCheck = await db.checkSpam(from);
  if (spamCheck.esSpam) {
    context.log(`Spam detectado de ${from} (BD): ${spamCheck.razon}`);
    await whatsapp.sendAndSaveText(from, MSG.RATE_LIMIT.SPAM_WARNING);
    timer.end({ spam: true, source: 'database', reason: spamCheck.razon });
    return { allowed: false };
  }

  return { allowed: true, sanitizedText };
}

/**
 * Procesa el mensaje segun la intencion detectada por patron de texto
 * @param {string} from - Numero de telefono
 * @param {string} text - Texto del mensaje
 * @param {Object} session - Sesion actual
 * @param {Object} context - Contexto de Azure Functions
 */
async function processTextIntent(from, text, session, context) {
  const trimmedText = text.trim();

  // Consulta de documentos: "mis documentos", "documentos", "pendientes"
  if (CONSULTA_DOCS_PATTERN.test(trimmedText)) {
    context.log(`Intencion detectada: CONSULTA_DOCUMENTOS`);
    // Usar FlowEngine directamente via registry
    const { registry } = require('../../../flows');
    const flujoConsulta = registry.obtener('CONSULTA_DOCUMENTOS');
    if (flujoConsulta) {
      const {
        createStaticFlowContext,
      } = require('../../../../core/flowEngine/contexts/StaticFlowContext');
      const ctx = createStaticFlowContext(from, session, context, {
        flowName: 'CONSULTA_DOCUMENTOS',
      });
      await flujoConsulta.handleConsultaIniciada(ctx, trimmedText, session);
    }
    return;
  }

  // Ayuda: "ayuda", "help"
  if (AYUDA_PATTERN.test(trimmedText)) {
    context.log(`Intencion detectada: AYUDA`);
    await whatsapp.sendAndSaveText(from, MSG.AYUDA.MENSAJE);
    return;
  }

  // Saludo: "hola", "buenos dias"
  if (SALUDO_PATTERN.test(trimmedText)) {
    context.log(`Intencion detectada: SALUDO`);
    await whatsapp.sendAndSaveText(from, MSG.GENERAL.WELCOME);
    return;
  }

  // Despedida: "adios", "bye"
  if (DESPEDIDA_PATTERN.test(trimmedText)) {
    context.log(`Intencion detectada: DESPEDIDA`);
    await whatsapp.sendAndSaveText(from, MSG.GENERAL.GOODBYE);
    try {
      await db.updateSession(
        from,
        ESTADO.INICIO,
        null,
        null,
        ORIGEN_ACCION.USUARIO,
        'Usuario se despidio',
        null,
        session.Version
      );
    } catch (error) {
      if (!(error instanceof ConcurrencyError)) {
        throw error;
      }
      context.log(`Conflicto de concurrencia en DESPEDIDA`);
    }
    return;
  }

  // Cancelar: "cancelar", "salir"
  if (CANCELAR_PATTERN.test(trimmedText)) {
    if (!esEstadoTerminal(session.Estado)) {
      context.log(`Intencion detectada: CANCELAR`);
      await FlowManager.cancelarFlujo(from, context);
      return;
    }
    // En estado terminal, simplemente confirmar
    await whatsapp.sendAndSaveText(from, MSG.GENERAL.GOODBYE);
    return;
  }

  // Default: mensaje no reconocido - mostrar menu de opciones
  context.log(`Mensaje no reconocido, mostrando menu de opciones`);
  await whatsapp.sendAndSaveText(from, MSG.ERRORES.NO_ENTIENDO);
}

module.exports = {
  handleText,
  processTextIntent,
};
