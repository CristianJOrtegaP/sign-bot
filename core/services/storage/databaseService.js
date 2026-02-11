/**
 * SIGN BOT - Servicio de Base de Datos (Facade)
 * Este archivo actua como facade sobre los repositorios
 * Mantiene compatibilidad con codigo existente mientras usa la nueva arquitectura
 */

const SesionRepository = require('../../../bot/repositories/SesionRepository');
const DocumentoFirmaRepository = require('../../../bot/repositories/DocumentoFirmaRepository');
const EventoDocuSignRepository = require('../../../bot/repositories/EventoDocuSignRepository');
const { logger } = require('../infrastructure/errorHandler');

// ============================================================================
// FUNCIONES DE SESION (delegadas a SesionRepository)
// ============================================================================

/**
 * Obtiene o crea una sesion de chat para un usuario
 * @param {string} telefono - Numero de telefono
 * @returns {Promise<Object>}
 */
async function getSession(telefono) {
  return SesionRepository.getSession(telefono);
}

/**
 * Obtiene sesion bypaseando el cache (lectura fresca desde BD)
 * Util para evitar race conditions en operaciones criticas
 * @param {string} telefono - Numero de telefono
 * @returns {Promise<Object>}
 */
async function getSessionFresh(telefono) {
  return SesionRepository.getSession(telefono, true);
}

/**
 * Obtiene sesion con version para optimistic locking
 * SIEMPRE lee desde BD (no cache) para garantizar version actualizada
 * @param {string} telefono - Numero de telefono
 * @returns {Promise<Object>} Sesion con campo Version
 */
async function getSessionWithVersion(telefono) {
  return SesionRepository.getSessionWithVersion(telefono);
}

/**
 * Actualiza el estado de una sesion
 * @param {string} telefono - Numero de telefono
 * @param {string} estado - Nuevo estado
 * @param {Object} datosTemp - Datos temporales (opcional)
 * @param {string} origenAccion - Origen de la accion (opcional)
 * @param {string} descripcion - Descripcion de la accion (opcional)
 * @param {number} expectedVersion - Version esperada para optimistic locking (opcional)
 */
async function updateSession(
  telefono,
  estado,
  datosTemp = null,
  origenAccion = 'BOT',
  descripcion = null,
  expectedVersion = null
) {
  return SesionRepository.updateSession(
    telefono,
    estado,
    datosTemp,
    origenAccion,
    descripcion,
    expectedVersion
  );
}

/**
 * Guarda un mensaje en el historial de chat
 * @param {string} telefono - Numero de telefono
 * @param {string} tipo - 'U' para usuario, 'B' para bot
 * @param {string} contenido - Contenido del mensaje
 * @param {string} tipoContenido - 'TEXTO', 'BOTON', 'TEMPLATE'
 * @param {string} intencionDetectada - Intencion detectada por IA (opcional)
 * @param {number} confianzaIA - Score de confianza (opcional)
 */
async function saveMessage(
  telefono,
  tipo,
  contenido,
  tipoContenido = 'TEXTO',
  intencionDetectada = null,
  confianzaIA = null
) {
  return SesionRepository.saveMessage(
    telefono,
    tipo,
    contenido,
    tipoContenido,
    intencionDetectada,
    confianzaIA
  );
}

/**
 * Verifica si un usuario esta haciendo spam
 * @param {string} telefono - Numero de telefono
 * @returns {Promise<{esSpam: boolean, totalMensajes: number, razon: string}>}
 */
async function checkSpam(telefono) {
  return SesionRepository.checkSpam(telefono);
}

/**
 * Registra actividad del usuario (resetea advertencia de timeout)
 * @param {string} telefono - Numero de telefono
 */
async function updateLastActivity(telefono) {
  return SesionRepository.updateLastActivity(telefono);
}

// ============================================================================
// FUNCIONES DE ADMINISTRACION DE CACHE (para compatibilidad)
// ============================================================================

/**
 * Limpia el cache de sesiones
 * @param {string} telefono - Telefono especifico (opcional)
 * @returns {boolean|number}
 */
function clearSessionCache(telefono = null) {
  if (telefono) {
    SesionRepository.invalidateCache(telefono);
    return true;
  }
  return SesionRepository.clearCache();
}

/**
 * Limpia el cache de documentos
 * @param {number} documentoId - ID de documento especifico (opcional)
 * @returns {boolean|number}
 */
function clearDocumentoCache(documentoId = null) {
  if (documentoId) {
    DocumentoFirmaRepository.invalidateCache(`doc:${documentoId}`);
    return true;
  }
  return DocumentoFirmaRepository.clearCache();
}

/**
 * Obtiene estadisticas de los caches
 * @returns {Object}
 */
function getCacheStats() {
  return {
    sesiones: SesionRepository.getCacheStats(),
    documentos: DocumentoFirmaRepository.getCacheStats(),
    eventosDocuSign: EventoDocuSignRepository.getCacheStats(),
  };
}

/**
 * Inicia la limpieza automatica de caches
 * (Ya se inicia automaticamente en los repositorios)
 */
function startCacheCleanup() {
  // Los repositorios ya manejan esto internamente
  logger.debug('Los repositorios manejan la limpieza de cache internamente');
}

/**
 * Detiene la limpieza automatica de caches
 */
function stopCacheCleanup() {
  SesionRepository.stopCacheCleanup();
  DocumentoFirmaRepository.stopCacheCleanup();
  EventoDocuSignRepository.stopCacheCleanup();
}

// ============================================================================
// FUNCIONES DE SESION AVANZADAS
// ============================================================================

/**
 * Obtiene sesiones que necesitan advertencia de timeout
 * @param {number} warningMinutes - Minutos de inactividad para advertencia
 * @returns {Promise<Array>}
 */
async function getSessionsNeedingWarning(warningMinutes) {
  return SesionRepository.getSessionsNeedingWarning(warningMinutes);
}

/**
 * Obtiene sesiones que deben ser cerradas por timeout
 * @param {number} timeoutMinutes - Minutos de inactividad para cerrar
 * @returns {Promise<Array>}
 */
async function getSessionsToClose(timeoutMinutes) {
  return SesionRepository.getSessionsToClose(timeoutMinutes);
}

/**
 * Actualiza el nombre de usuario de WhatsApp en la sesion
 * @param {string} telefono - Numero de telefono
 * @param {string} nombreUsuario - Nombre de perfil de WhatsApp
 */
async function updateUserName(telefono, nombreUsuario) {
  return SesionRepository.updateUserName(telefono, nombreUsuario);
}

// ============================================================================
// EXPORTACION
// ============================================================================

module.exports = {
  // Funciones de sesion
  getSession,
  getSessionFresh,
  getSessionWithVersion,
  updateSession,
  updateLastActivity,
  saveMessage,
  checkSpam,
  getSessionsNeedingWarning,
  getSessionsToClose,
  updateUserName,

  // Funciones de deduplicacion
  registerMessageAtomic: (messageId, telefono) =>
    SesionRepository.registerMessageAtomic(messageId, telefono),
  isMessageProcessed: (messageId) => SesionRepository.isMessageProcessed(messageId), // Deprecated
  cleanOldProcessedMessages: () => SesionRepository.cleanOldProcessedMessages(),
  cleanOldHistorialSesiones: () => SesionRepository.cleanOldHistorialSesiones(),

  // Funciones de administracion de cache
  clearSessionCache,
  clearDocumentoCache,
  getCacheStats,
  startCacheCleanup,
  stopCacheCleanup,

  // Acceso directo a repositorios (para uso avanzado)
  repositories: {
    sesiones: SesionRepository,
    documentos: DocumentoFirmaRepository,
    eventosDocuSign: EventoDocuSignRepository,
  },
};
