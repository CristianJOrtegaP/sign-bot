/**
 * AC FIXBOT - Handler de Mensajes V2
 * Procesa mensajes de texto, botones interactivos y ubicaciones
 *
 * Este módulo re-exporta las funciones principales de los handlers modulares.
 */

const { handleButton } = require('./handlers/buttonHandler');
const { handleLocation } = require('./handlers/locationHandler');
const { handleText: handleTextInternal } = require('./handlers/textHandler');

/**
 * Wrapper para handleText que inyecta handleButton como dependencia
 * Esto evita dependencias circulares entre textHandler y buttonHandler
 */
async function handleText(from, text, messageId, context) {
  return handleTextInternal(from, text, messageId, context, handleButton);
}

module.exports = {
  handleText,
  handleButton,
  handleLocation,
};
