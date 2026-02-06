/**
 * AC FIXBOT - Manejo de Cancelación del Flujo
 * @module flows/modules/cancellation
 */

const whatsapp = require('../../../../core/services/external/whatsappService');
const db = require('../../../../core/services/storage/databaseService');
const MSG = require('../../../constants/messages');
const {
  ESTADO,
  ORIGEN_ACCION,
  TIPO_MENSAJE,
  TIPO_CONTENIDO,
} = require('../../../constants/sessionStates');

/**
 * Verifica si el mensaje es una cancelación
 * @param {string} texto - Mensaje del usuario
 * @returns {boolean}
 */
function esCancelacion(texto) {
  return /^(cancelar|salir|exit|quit|no\s*quiero|terminar)$/i.test(texto.trim());
}

/**
 * Cancela el flujo actual
 * @param {string} from - Teléfono del usuario
 * @param {Object} session - Sesión actual (no usado pero mantenido por compatibilidad)
 * @param {Object} context - Contexto de Azure Function
 */
async function cancelarFlujo(from, session, context = null) {
  await db.updateSession(
    from,
    ESTADO.CANCELADO,
    null,
    null,
    ORIGEN_ACCION.USUARIO,
    'Flujo cancelado por usuario'
  );

  await whatsapp.sendText(from, MSG.GENERAL.CANCELLED);
  await db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.GENERAL.CANCELLED, TIPO_CONTENIDO.TEXTO);

  if (context?.log) {
    context.log(`[FlexibleFlow] Flujo cancelado: ${from}`);
  }
}

module.exports = {
  esCancelacion,
  cancelarFlujo,
};
