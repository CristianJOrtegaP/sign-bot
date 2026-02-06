/**
 * AC FIXBOT - Handler de Mensajes de Texto
 * Procesa mensajes de texto entrantes de WhatsApp
 */

const whatsapp = require('../../../../core/services/external/whatsappService');
const intent = require('../../../../core/services/ai/intentService');
const db = require('../../../../core/services/storage/databaseService');
const rateLimiter = require('../../../../core/services/infrastructure/rateLimiter');
const metrics = require('../../../../core/services/infrastructure/metricsService');
const MSG = require('../../../constants/messages');
const { sanitizeMessage, validatePhoneE164 } = require('../../../../core/utils/helpers');
const FlowManager = require('../../flows/FlowManager');
const flexibleFlowManager = require('../../flows/flexibleFlowManager');
const consultaEstadoFlow = require('../../flows/consultaEstadoFlow');
const teamsService = require('../../../../core/services/external/teamsService');
const {
  ESTADO,
  TIPO_MENSAJE,
  TIPO_CONTENIDO,
  ORIGEN_ACCION,
  esEstadoTerminal,
  esEstadoFlexible,
  esEstadoAgente,
} = require('../../../constants/sessionStates');

const { enrichIntentWithStructuredData } = require('../utils/intentEnrichment');
const {
  enrichSessionWithExtractedData,
  formatModificacionConfirmacion,
} = require('../utils/sessionEnrichment');
const {
  sendWelcome,
  handleReportarFalla,
  handleTipoEquipo,
  handleDefaultIntent,
} = require('../utils/reportHandlers');

/**
 * Procesa un mensaje de texto entrante de WhatsApp
 * @param {string} from - Número de teléfono del remitente (formato E.164)
 * @param {string} text - Contenido del mensaje de texto
 * @param {string} messageId - ID único del mensaje de WhatsApp
 * @param {Object} context - Contexto de Azure Functions con logging
 * @param {Function} handleButton - Referencia a handleButton para llamadas internas
 * @returns {Promise<void>}
 */
async function handleText(from, text, messageId, context, handleButton) {
  const timer = metrics.startTimer('message_handling', context);
  context.log(`Procesando texto de ${from}: ${text}`);

  // Validar formato de teléfono E.164
  const phoneValidation = validatePhoneE164(from);
  if (!phoneValidation.valid) {
    context.log.warn(`⚠️ Teléfono con formato inválido: ${from} - ${phoneValidation.error}`);
    // Continuamos pero registramos la anomalía
  }

  // Sanitizar mensaje de entrada
  const sanitizedText = sanitizeMessage(text);
  if (sanitizedText !== text.trim()) {
    context.log(`🔒 Mensaje sanitizado: "${text}" -> "${sanitizedText}"`);
  }
  text = sanitizedText;

  // Verificar rate limit
  const rateLimitCheck = rateLimiter.checkRateLimit(from, 'message');
  if (!rateLimitCheck.allowed) {
    context.log(`⚠️ Rate limit excedido para ${from}`);
    await whatsapp.sendAndSaveText(from, `⏱️ ${rateLimitCheck.reason}`);
    timer.end({ rateLimited: true });
    return;
  }

  // Detectar spam (memoria local)
  if (rateLimiter.isSpamming(from)) {
    context.log(`🚨 Spam detectado de ${from} (rate limiter local)`);
    await whatsapp.sendAndSaveText(from, MSG.RATE_LIMIT.SPAM_WARNING);
    timer.end({ spam: true, source: 'local' });
    return;
  }

  // Detectar spam (base de datos - más preciso)
  const spamCheck = await db.checkSpam(from);
  if (spamCheck.esSpam) {
    context.log(
      `🚨 Spam detectado de ${from} (BD): ${spamCheck.razon}, ${spamCheck.totalMensajes} mensajes`
    );
    await whatsapp.sendAndSaveText(from, MSG.RATE_LIMIT.SPAM_WARNING);
    timer.end({ spam: true, source: 'database', reason: spamCheck.razon });
    return;
  }

  // Registrar solicitud
  rateLimiter.recordRequest(from, 'message');

  // Mostrar "Escribiendo..." (fire-and-forget, no bloquea el flujo)
  whatsapp.sendTypingIndicator(from, messageId).catch(() => {});

  // PERFORMANCE: Paralelizar saveMessage + getSession (~80ms ahorro)
  // Usar allSettled para que fallo en saveMessage no afecte getSession
  const results = await Promise.allSettled([
    db.saveMessage(from, TIPO_MENSAJE.USUARIO, text, TIPO_CONTENIDO.TEXTO),
    db.getSession(from),
  ]);

  // Verificar resultado de saveMessage (no crítico, solo logging)
  if (results[0].status === 'rejected') {
    context.log.warn(`⚠️ Error guardando mensaje: ${results[0].reason?.message}`);
  }

  // Verificar resultado de getSession (crítico, debe existir)
  if (results[1].status === 'rejected') {
    context.log.error(`❌ Error obteniendo sesión: ${results[1].reason?.message}`);
    throw results[1].reason; // Re-lanzar error crítico
  }

  const session = results[1].value;
  context.log(`Estado actual de sesión: ${session.Estado}`);

  // HANDOFF: Si la sesión está siendo atendida por un agente humano,
  // NO procesar con el bot. Solo guardar el mensaje (ya se guardó arriba)
  // y notificar al dashboard que hay un nuevo mensaje.
  if (esEstadoAgente(session.Estado)) {
    context.log(`👤 Sesión en modo AGENTE_ACTIVO - mensaje guardado, no se procesa con bot`);
    // Notificar a Teams que hay un nuevo mensaje (opcional, fire-and-forget)
    teamsService
      .notifyMessage(from, 'U', text, {
        estado: session.Estado,
        tipoReporte: 'Atención por Agente',
      })
      .catch(() => {});
    timer.end({ handledByAgent: true });
    return; // No procesar con el bot
  }

  // Si la sesión está en un estado terminal (CANCELADO, FINALIZADO, TIMEOUT),
  // reactivarla a INICIO y mostrar bienvenida
  if (session.Estado !== ESTADO.INICIO && esEstadoTerminal(session.Estado)) {
    context.log(`🔄 Reactivando sesión de ${from} desde estado ${session.Estado}`);
    await db.updateSession(
      from,
      ESTADO.INICIO,
      null,
      null,
      ORIGEN_ACCION.USUARIO,
      `Sesión reactivada desde ${session.Estado}`
    );
    session.Estado = ESTADO.INICIO;
  }

  // PERFORMANCE: Paralelizar updateLastActivity + detectIntent (~50ms ahorro)
  // Ambos son independientes: uno actualiza timestamp, otro detecta intencion
  // Usar allSettled para que fallo en updateLastActivity no afecte detectIntent
  const activityResults = await Promise.allSettled([
    db.updateLastActivity(from),
    intent.detectIntent(text),
  ]);

  // Verificar resultado de updateLastActivity (no crítico, solo logging)
  if (activityResults[0].status === 'rejected') {
    context.log.warn(
      `⚠️ Error actualizando última actividad: ${activityResults[0].reason?.message}`
    );
  }

  // Verificar resultado de detectIntent (crítico, debe existir)
  if (activityResults[1].status === 'rejected') {
    context.log.error(`❌ Error detectando intención: ${activityResults[1].reason?.message}`);
    throw activityResults[1].reason; // Re-lanzar error crítico
  }

  let detectedIntent = activityResults[1].value;
  context.log(
    `Intención detectada: ${detectedIntent.intencion} (${detectedIntent.confianza}) - Método: ${detectedIntent.metodo}`
  );

  // DETECCIÓN DE CONSULTA DE TICKETS: Si el usuario escribe un número de ticket o comando de consulta
  // Detectar patrones como "TKT-BC671636", "BC671636", "mis tickets", "consultar ticket"
  // Formato real: TKT-XXXXXXXX (8 caracteres alfanuméricos)
  const ticketPatternFull = /TKT-[A-Z0-9]{8}/i;
  // Ticket corto: 8 caracteres que incluyan al menos un número (evita palabras como "Cancelar")
  const ticketPatternShort = /^(?=.*[0-9])[A-Z0-9]{8}$/i;

  const consultaKeywords =
    /^(mis\s*tickets?|ver\s*tickets?|ver\s*mis\s*tickets?|consultar\s*tickets?|estado\s*tickets?|ver\s*reportes?|ver\s*mis\s*reportes?|consultar\s*reportes?)$/i;

  // Detectar número de ticket en el mensaje
  const ticketMatch = text.match(ticketPatternFull);
  const isShortTicket = ticketPatternShort.test(text.trim());
  const isConsultaKeyword = consultaKeywords.test(text.trim());

  // No tratar como ticket si ya detectamos una intención conocida (CANCELAR, SALUDO, etc.)
  const intentKnown = ['CANCELAR', 'SALUDO', 'DESPEDIDA', 'CONFIRMAR'].includes(
    detectedIntent.intencion
  );

  if (
    session.Estado === ESTADO.INICIO &&
    !intentKnown &&
    (ticketMatch || isShortTicket || isConsultaKeyword)
  ) {
    context.log(`🎫 Consulta de ticket detectada: ${text}`);

    if (ticketMatch || isShortTicket) {
      // Consulta directa de un ticket específico
      const numeroTicket = ticketMatch
        ? ticketMatch[0].toUpperCase()
        : `TKT-${text.trim().toUpperCase()}`;
      await consultaEstadoFlow.consultarTicketDirecto(from, numeroTicket, context);
    } else {
      // Comando para ver lista de tickets
      await consultaEstadoFlow.iniciarFlujo(from, context);
    }

    timer.end({ intent: 'CONSULTAR_TICKET', method: 'pattern_detection' });
    return;
  }

  // EXTRACCIÓN COMPLETA: Si detectamos REPORTAR_FALLA en mensaje, extraer TODOS los datos posibles
  // Aplica para cualquier método de detección (regex o ai_extract) porque ai_extract no extrae SAP
  // Umbral bajo (15 chars) para capturar mensajes como "Mi carro no enciende" (24 chars)
  if (
    detectedIntent.intencion === 'REPORTAR_FALLA' &&
    text.trim().length > 15 &&
    !detectedIntent.codigo_sap
  ) {
    // Solo si no tenemos SAP aún

    context.log(
      `🔍 Mensaje detectado (${text.trim().length} chars), extrayendo TODOS los datos con extractAllData...`
    );
    detectedIntent = await enrichIntentWithStructuredData(
      text,
      detectedIntent,
      context,
      session.Estado
    );
  }

  // Si detectamos DESPEDIDA, reiniciar sesión
  if (detectedIntent.intencion === 'DESPEDIDA') {
    await whatsapp.sendText(from, MSG.GENERAL.GOODBYE);
    await db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.GENERAL.GOODBYE, TIPO_CONTENIDO.TEXTO);
    await db.updateSession(
      from,
      ESTADO.INICIO,
      null,
      null,
      ORIGEN_ACCION.USUARIO,
      'Usuario se despidió'
    );
    timer.end({ intent: 'DESPEDIDA', sessionReset: true });
    return;
  }

  // Si detectamos CANCELAR y hay un flujo activo (no en estado terminal), cancelar
  if (detectedIntent.intencion === 'CANCELAR' && !esEstadoTerminal(session.Estado)) {
    await FlowManager.cancelarFlujo(from, context);
    timer.end({ intent: 'CANCELAR', sessionReset: true });
    return;
  }

  // SMART EXTRACTION: Si el usuario está en un flujo y envía mensaje,
  // extraer datos adicionales y actualizar la sesión
  // También detecta si quiere MODIFICAR datos existentes
  if (!esEstadoTerminal(session.Estado) && text.trim().length > 15) {
    const resultado = await enrichSessionWithExtractedData(from, text, session, context);

    // Si hubo modificaciones, enviar confirmación y continuar el flujo
    if (resultado && resultado.modificaciones && resultado.modificaciones.length > 0) {
      const confirmacionMsg = formatModificacionConfirmacion(resultado.modificaciones);
      await whatsapp.sendText(from, confirmacionMsg);
      await db.saveMessage(from, TIPO_MENSAJE.BOT, confirmacionMsg, TIPO_CONTENIDO.TEXTO);
      context.log(`📝 Confirmación de modificación enviada`);
      // NO retornar aquí - dejar que el flujo continúe para pedir siguiente dato
    }
  }

  // FASE 2b: Si estamos en un estado flexible, usar flexibleFlowManager
  // IMPORTANTE: Leer sesión FRESCA para evitar problemas de caché con campoSolicitado
  if (esEstadoFlexible(session.Estado)) {
    context.log(`[FASE 2b] Estado flexible detectado: ${session.Estado} - leyendo sesión fresca`);
    const freshSession = await db.getSessionFresh(from);
    context.log(
      `[FASE 2b] Sesión fresca obtenida, DatosTemp presente: ${freshSession.DatosTemp ? 'sí' : 'no'}`
    );
    const handledFlexible = await flexibleFlowManager.procesarMensaje(
      from,
      text,
      freshSession,
      context
    );
    if (handledFlexible) {
      timer.end({ intent: detectedIntent.intencion, state: freshSession.Estado, flexible: true });
      return;
    }
  }

  // Procesar según el estado de la sesión (usando FlowManager - flujos legacy)
  const handled = await FlowManager.processSessionState(from, text, session, context);
  if (handled) {
    timer.end({ intent: detectedIntent.intencion, state: session.Estado });
    return;
  }

  // Procesar según la intención detectada
  await processIntent(from, text, session, detectedIntent, context, handleButton);
  timer.end({ intent: detectedIntent.intencion });
}

/**
 * Procesa el mensaje según la intención detectada
 */
async function processIntent(from, text, session, detectedIntent, context, handleButton) {
  switch (detectedIntent.intencion) {
    case 'SALUDO':
      await sendWelcome(from);
      break;

    case 'CANCELAR':
      // Si llegamos aquí, el usuario está en estado terminal (no hay flujo activo)
      // Mostramos mensaje de cancelado de todas formas para dar feedback
      await whatsapp.sendText(from, MSG.GENERAL.CANCELLED);
      await db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.GENERAL.CANCELLED, TIPO_CONTENIDO.TEXTO);
      break;

    case 'REPORTAR_FALLA':
      await handleReportarFalla(from, session, detectedIntent, context);
      break;

    case 'TIPO_REFRIGERADOR':
      await handleTipoEquipo(from, text, detectedIntent, 'REFRIGERADOR', context, handleButton);
      break;

    case 'TIPO_VEHICULO':
      await handleTipoEquipo(from, text, detectedIntent, 'VEHICULO', context, handleButton);
      break;

    default:
      await handleDefaultIntent(from, detectedIntent);
  }
}

module.exports = {
  handleText,
  processIntent,
  sendWelcome,
};
