/**
 * AC FIXBOT - Message Router
 * Enruta mensajes de WhatsApp al handler correspondiente según su tipo.
 * Módulo compartido entre el webhook HTTP y el queue processor.
 *
 * @module services/processing/messageRouter
 */

const messageHandler = require('../../../bot/controllers/messageHandler');
const imageHandler = require('../../../bot/controllers/imageHandler');
const audioHandler = require('../../../bot/controllers/audioHandler');
const { TimeoutBudget } = require('../../utils/requestTimeout');

/**
 * Procesa un mensaje según su tipo (text, image, audio, interactive, location)
 * @param {Object} message - Mensaje completo de WhatsApp
 * @param {string} from - Número de teléfono del remitente
 * @param {string} messageId - ID único del mensaje
 * @param {Object} context - Azure Functions context (para logging)
 * @param {Function} log - Función de logging con correlation ID
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

module.exports = { processMessageByType };
