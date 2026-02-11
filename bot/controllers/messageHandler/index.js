/**
 * SIGN BOT - Handler de Mensajes
 * Procesa mensajes de texto y botones interactivos de WhatsApp
 *
 * Este modulo re-exporta las funciones principales de los handlers modulares.
 */

const { handleButton } = require('./handlers/buttonHandler');
const { handleText: handleTextInternal } = require('./handlers/textHandler');
const whatsappService = require('../../../core/services/external/whatsappService');
const { ERRORES } = require('../../constants/messages');

/**
 * Wrapper para handleText que inyecta handleButton como dependencia
 * Esto evita dependencias circulares entre textHandler y buttonHandler
 */
async function handleText(from, text, messageId, context) {
  return handleTextInternal(from, text, messageId, context, handleButton);
}

/**
 * Handler para tipos de mensaje no soportados (image, audio, location, etc.)
 * Sign Bot solo procesa texto y botones interactivos
 */
async function handleUnsupportedType(from, _messageType, _messageId, _context) {
  await whatsappService.sendMessage(from, ERRORES.NO_ENTIENDO);
}

module.exports = {
  handleText,
  handleButton,
  handleUnsupportedType,
};
