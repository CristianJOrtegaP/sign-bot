/**
 * SIGN BOT - Message Router
 * Enruta mensajes de WhatsApp al handler correspondiente segun su tipo.
 * Modulo compartido entre el webhook HTTP y el queue processor.
 *
 * Sign Bot solo maneja: text, interactive (buttons).
 * Tipos no soportados (image, audio, location) reciben un mensaje informativo.
 *
 * @module services/processing/messageRouter
 */

const messageHandler = require('../../../bot/controllers/messageHandler');
const { TimeoutBudget } = require('../../utils/requestTimeout');

/**
 * Procesa un mensaje segun su tipo (text, interactive)
 * @param {Object} message - Mensaje completo de WhatsApp
 * @param {string} from - Numero de telefono del remitente
 * @param {string} messageId - ID unico del mensaje
 * @param {Object} context - Azure Functions context (para logging)
 * @param {Function} log - Funcion de logging con correlation ID
 * @param {TimeoutBudget|null} budget - Presupuesto de timeout (opcional)
 */
async function processMessageByType(message, from, messageId, context, log, budget = null) {
  // Crear budget si no viene uno (backward compat)
  if (!budget) {
    budget = new TimeoutBudget(240000, context.correlationId || 'unknown');
  }
  const messageType = message.type;

  switch (messageType) {
    case 'text': {
      const textBody = message.text.body;
      log(`Texto: "${textBody.substring(0, 50)}${textBody.length > 50 ? '...' : ''}"`);
      await messageHandler.handleText(from, textBody, messageId, context, null, budget);
      break;
    }

    case 'interactive': {
      const buttonReply = message.interactive && message.interactive.button_reply;
      if (buttonReply) {
        log(`Boton presionado: ${buttonReply.id}`);
        await messageHandler.handleButton(from, buttonReply.id, messageId, context);
      }
      break;
    }

    // Sign Bot no procesa imagenes, audio ni ubicacion
    // Estos tipos reciben una respuesta informativa
    case 'image':
    case 'audio':
    case 'video':
    case 'document':
    case 'location':
    case 'sticker':
      log(`Tipo de mensaje no soportado por Sign Bot: ${messageType}`);
      await messageHandler.handleUnsupportedType(from, messageType, messageId, context);
      break;

    default:
      log(`Tipo de mensaje desconocido: ${messageType}`);
  }
}

module.exports = { processMessageByType };
