/**
 * SIGN BOT - Utilidades de enriquecimiento de sesion
 * Utilidades de sesion para el flujo de firma de documentos
 */

const { logger } = require('../../../../core/services/infrastructure/errorHandler');
const { safeParseJSON } = require('../../../../core/utils/helpers');

/**
 * Obtiene los datos temporales de una sesion de forma segura
 * @param {Object} session - Sesion del usuario
 * @returns {Object} - Datos parseados o objeto vacio
 */
function getDatosSesion(session) {
  if (!session || !session.DatosTemp) {
    return {};
  }
  try {
    return safeParseJSON(session.DatosTemp) || {};
  } catch (error) {
    logger.warn('[sessionEnrichment] Error parseando DatosTemp', { error: error.message });
    return {};
  }
}

module.exports = {
  getDatosSesion,
};
