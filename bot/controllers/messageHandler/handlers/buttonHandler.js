/**
 * AC FIXBOT - Handler de Botones Interactivos
 * Procesa botones interactivos de WhatsApp
 */

const whatsapp = require('../../../../core/services/external/whatsappService');
const db = require('../../../../core/services/storage/databaseService');
const MSG = require('../../../constants/messages');
const FlowManager = require('../../flows/FlowManager');
const flexibleFlowManager = require('../../../flows/reporteFlow');
const EncuestaRepository = require('../../../repositories/EncuestaRepository');
const {
  ESTADO,
  TIPO_MENSAJE,
  TIPO_CONTENIDO,
  ORIGEN_ACCION: _ORIGEN_ACCION,
  esEstadoTerminal,
  esEstadoFlexible,
} = require('../../../constants/sessionStates');

const { ENCUESTA_BUTTONS, FLEXIBLE_BUTTONS } = require('../constants');
const { sendWelcome } = require('../utils/reportHandlers');
const { reactivateSessionIfTerminal } = require('../utils/handlerMiddleware');
const { ConcurrencyError } = require('../../../../core/errors');

/**
 * Procesa la presión de un botón interactivo de WhatsApp
 * @param {string} from - Número de teléfono del remitente (formato E.164)
 * @param {string} buttonId - ID del botón presionado (ej: 'btn_tipo_vehiculo')
 * @param {string} messageId - ID único del mensaje de WhatsApp
 * @param {Object} context - Contexto de Azure Functions con logging
 * @returns {Promise<void>}
 */
async function handleButton(from, buttonId, messageId, context) {
  context.log(`Botón presionado por ${from}: ${buttonId}`);

  // Typing indicator fire-and-forget (no crítico)
  if (messageId) {
    whatsapp.sendTypingIndicator(from, messageId).catch(() => {});
  }

  // PERFORMANCE: Paralelizar saveMessage + getSession (~80ms ahorro)
  const isFlexibleBtn = FLEXIBLE_BUTTONS.has(buttonId);
  const sessionPromise = isFlexibleBtn
    ? (context.log(`🔄 Botón flexible ${buttonId} - leyendo sesión fresca`),
      db.getSessionFresh(from))
    : db.getSession(from);

  const [saveResult, sessionResult] = await Promise.allSettled([
    db.saveMessage(from, TIPO_MENSAJE.USUARIO, buttonId, TIPO_CONTENIDO.BOTON),
    sessionPromise,
  ]);

  if (saveResult.status === 'rejected') {
    context.log.warn(`⚠️ Error guardando mensaje de botón: ${saveResult.reason?.message}`);
  }
  if (sessionResult.status === 'rejected') {
    context.log.error(`❌ Error obteniendo sesión: ${sessionResult.reason?.message}`);
    throw sessionResult.reason;
  }

  const session = sessionResult.value;
  if (isFlexibleBtn) {
    context.log(
      `📋 Estado fresco: ${session.Estado}, DatosTemp: ${session.DatosTemp ? 'presente' : 'vacío'}`
    );
  }

  // Si la sesión está en estado terminal, manejar según tipo de botón
  if (session.Estado !== ESTADO.INICIO && esEstadoTerminal(session.Estado)) {
    // Si es botón de encuesta, verificar si hay encuesta activa
    if (ENCUESTA_BUTTONS.has(buttonId)) {
      const encuestaActiva = await EncuestaRepository.getActivaByTelefono(from);

      if (!encuestaActiva) {
        // No hay encuesta activa - informar al usuario
        context.log(`⚠️ Botón de encuesta ${buttonId} presionado sin encuesta activa para ${from}`);
        await whatsapp.sendText(
          from,
          MSG.ENCUESTA?.EXPIRADA || 'Esta encuesta ya no está activa. Gracias por tu interés.'
        );
        await db.saveMessage(
          from,
          TIPO_MENSAJE.BOT,
          MSG.ENCUESTA?.EXPIRADA || 'Esta encuesta ya no está activa.',
          TIPO_CONTENIDO.TEXTO
        );
        return;
      }

      // Hay encuesta activa - NO reactivar a INICIO, dejar que FlowManager maneje
      context.log(
        `📋 Procesando botón de encuesta ${buttonId} con encuesta activa ${encuestaActiva.EncuestaId}`
      );
    } else if (FLEXIBLE_BUTTONS.has(buttonId)) {
      // Botón de flujo flexible en estado terminal - ya tenemos sesión fresca
      context.log(`📋 Botón flexible en estado terminal, continuando con sesión fresca`);
    } else {
      // Botón normal - reactivar sesión a INICIO (middleware unificado)
      await reactivateSessionIfTerminal(from, session, 'botón', context);
    }
  }

  // Fire-and-forget: no bloquea el flujo principal
  db.updateLastActivity(from).catch(() => {});

  try {
    // FASE 2b: Si estamos en estado flexible, procesar botón con flexibleFlowManager
    if (esEstadoFlexible(session.Estado)) {
      context.log(`[FASE 2b] Procesando botón en estado flexible: ${session.Estado}`);
      const handledFlexible = await flexibleFlowManager.procesarBoton(
        from,
        buttonId,
        session,
        context
      );
      if (handledFlexible) {
        return;
      }
    }

    const handled = await FlowManager.processButton(from, buttonId, session, context);

    if (!handled) {
      context.log(`Botón no reconocido: ${buttonId}`);
      await sendWelcome(from);
    }
  } catch (error) {
    if (error instanceof ConcurrencyError) {
      context.log(`⚡ Conflicto de concurrencia procesando botón ${buttonId} de ${from}`);
      return;
    }
    throw error;
  }
}

module.exports = {
  handleButton,
};
