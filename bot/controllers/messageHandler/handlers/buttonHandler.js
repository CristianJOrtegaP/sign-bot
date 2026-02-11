/**
 * SIGN BOT - Handler de Botones Interactivos
 * Procesa botones interactivos de WhatsApp
 */

const whatsapp = require('../../../../core/services/external/whatsappService');
const db = require('../../../../core/services/storage/databaseService');
const MSG = require('../../../constants/messages');
const FlowManager = require('../../flows/FlowManager');
const {
  ESTADO,
  TIPO_MENSAJE,
  TIPO_CONTENIDO,
  esEstadoTerminal,
  esEstadoConfirmacion,
} = require('../../../constants/sessionStates');

const { FIRMA_BUTTONS } = require('../constants');
const { reactivateSessionIfTerminal } = require('../utils/handlerMiddleware');
const { ConcurrencyError } = require('../../../../core/errors');

/**
 * Procesa la presion de un boton interactivo de WhatsApp
 * @param {string} from - Numero de telefono del remitente (formato E.164)
 * @param {string} buttonId - ID del boton presionado (ej: 'btn_ver_documentos')
 * @param {string} messageId - ID unico del mensaje de WhatsApp
 * @param {Object} context - Contexto de Azure Functions con logging
 * @returns {Promise<void>}
 */
async function handleButton(from, buttonId, messageId, context) {
  context.log(`Boton presionado por ${from}: ${buttonId}`);

  // Typing indicator fire-and-forget (no critico)
  if (messageId) {
    whatsapp.sendTypingIndicator(from, messageId).catch(() => {});
  }

  // PERFORMANCE: Paralelizar saveMessage + getSession (~80ms ahorro)
  const [saveResult, sessionResult] = await Promise.allSettled([
    db.saveMessage(from, TIPO_MENSAJE.USUARIO, buttonId, TIPO_CONTENIDO.BOTON),
    db.getSession(from),
  ]);

  if (saveResult.status === 'rejected') {
    context.log.warn(`Error guardando mensaje de boton: ${saveResult.reason?.message}`);
  }
  if (sessionResult.status === 'rejected') {
    context.log.error(`Error obteniendo sesion: ${sessionResult.reason?.message}`);
    throw sessionResult.reason;
  }

  const session = sessionResult.value;

  // Si la sesion esta en estado terminal, manejar segun tipo de boton
  if (session.Estado !== ESTADO.INICIO && esEstadoTerminal(session.Estado)) {
    if (FIRMA_BUTTONS.has(buttonId) && esEstadoConfirmacion(session.Estado)) {
      // Boton de firma en estado de confirmacion - dejar que FlowManager maneje
      context.log(`Procesando boton de firma ${buttonId} en estado ${session.Estado}`);
    } else {
      // Boton normal o estado terminal - reactivar sesion a INICIO
      await reactivateSessionIfTerminal(from, session, 'boton', context);
    }
  }

  // Fire-and-forget: no bloquea el flujo principal
  db.updateLastActivity(from).catch(() => {});

  try {
    const handled = await FlowManager.processButton(from, buttonId, session, context);

    if (!handled) {
      context.log(`Boton no reconocido: ${buttonId}`);
      // Enviar menu de opciones como fallback
      await whatsapp.sendAndSaveText(from, MSG.MENU.OPCIONES);
    }
  } catch (error) {
    if (error instanceof ConcurrencyError) {
      context.log(`Conflicto de concurrencia procesando boton ${buttonId} de ${from}`);
      return;
    }
    throw error;
  }
}

module.exports = {
  handleButton,
};
