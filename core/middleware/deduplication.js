/**
 * Sign Bot - Middleware de Deduplicacion
 * Previene el procesamiento de mensajes duplicados
 */

const rateLimiter = require('../services/infrastructure/rateLimiter');

/**
 * Verifica si un mensaje ya fue procesado (en memoria)
 * @param {string} messageId - ID unico del mensaje
 * @returns {boolean} - true si es duplicado
 */
function isDuplicateInMemory(messageId) {
  if (!messageId) {
    return false;
  }
  return rateLimiter.isDuplicateMessage(messageId);
}

/**
 * Verifica si un mensaje ya fue procesado (en base de datos)
 * @param {Object} db - Servicio de base de datos
 * @param {string} messageId - ID unico del mensaje
 * @returns {Promise<boolean>} - true si es duplicado
 */
async function isDuplicateInDatabase(db, messageId) {
  if (!messageId) {
    return false;
  }
  try {
    return await db.isMessageProcessed(messageId);
  } catch (_error) {
    // En caso de error, retornar false para no bloquear mensajes legitimos
    return false;
  }
}

/**
 * Middleware completo de deduplicacion
 * Verifica en memoria y BD
 * @param {Object} db - Servicio de base de datos
 * @param {string} messageId - ID unico del mensaje
 * @param {Object} options - Opciones adicionales
 * @returns {Promise<{isDuplicate: boolean, source: string|null}>}
 */
async function checkDuplicate(db, messageId, options = {}) {
  const { skipDatabaseCheck = false } = options;

  // 1. Verificar en memoria (rapido)
  if (isDuplicateInMemory(messageId)) {
    return { isDuplicate: true, source: 'memory' };
  }

  // 2. Verificar en BD (robusto, compartido entre instancias)
  if (!skipDatabaseCheck) {
    const isDuplicateDB = await isDuplicateInDatabase(db, messageId);
    if (isDuplicateDB) {
      return { isDuplicate: true, source: 'database' };
    }
  }

  return { isDuplicate: false, source: null };
}

module.exports = {
  isDuplicateInMemory,
  isDuplicateInDatabase,
  checkDuplicate,
};
