/**
 * AC FIXBOT - Servicio de Base de Datos (Facade)
 * Este archivo actúa como facade sobre los repositorios
 * Mantiene compatibilidad con código existente mientras usa la nueva arquitectura
 */

const SesionRepository = require('../../../bot/repositories/SesionRepository');
const EquipoRepository = require('../../../bot/repositories/EquipoRepository');
const ReporteRepository = require('../../../bot/repositories/ReporteRepository');
const { logger } = require('../infrastructure/errorHandler');

// ============================================================================
// FUNCIONES DE EQUIPO (delegadas a EquipoRepository)
// ============================================================================

/**
 * Busca un equipo por código SAP
 * @param {string} codigoSAP - Código SAP del equipo
 * @param {boolean} skipCache - Si true, bypasea el caché
 * @returns {Promise<Object|null>}
 */
async function getEquipoBySAP(codigoSAP, skipCache = false) {
  return EquipoRepository.getBySAP(codigoSAP, skipCache);
}

/**
 * Busca un equipo por ID
 * @param {number} equipoId - ID del equipo
 * @returns {Promise<Object|null>}
 */
async function getEquipoById(equipoId) {
  return EquipoRepository.getById(equipoId);
}

// ============================================================================
// FUNCIONES DE REPORTE (delegadas a ReporteRepository)
// ============================================================================

/**
 * Crea un nuevo reporte de falla para refrigerador
 * @param {number} equipoId - ID del equipo
 * @param {number} clienteId - ID del cliente
 * @param {string} telefono - Teléfono del reportante
 * @param {string} descripcion - Descripción del problema
 * @param {string} imagenUrl - URL de la imagen (opcional)
 * @returns {Promise<string>} - Número de ticket generado
 */
async function createReporte(equipoId, clienteId, telefono, descripcion, imagenUrl = null) {
  return ReporteRepository.createRefrigerador(
    equipoId,
    clienteId,
    telefono,
    descripcion,
    imagenUrl
  );
}

/**
 * Crea un nuevo reporte de falla para vehículo
 * @param {string} codigoSAPVehiculo - Código SAP del vehículo
 * @param {string} numeroEmpleado - Número de empleado
 * @param {string} telefono - Teléfono del reportante
 * @param {string} descripcion - Descripción del problema
 * @param {string} imagenUrl - URL de la imagen (opcional)
 * @param {Object} ubicacion - Ubicación del vehículo (opcional)
 * @param {number} centroServicioId - ID del centro de servicio más cercano (opcional)
 * @param {number} tiempoEstimadoMinutos - Tiempo estimado de llegada en minutos (opcional)
 * @param {number} distanciaCentroKm - Distancia al centro de servicio en km (opcional)
 * @returns {Promise<string>} - Número de ticket generado
 */
async function createReporteVehiculo(
  codigoSAPVehiculo,
  numeroEmpleado,
  telefono,
  descripcion,
  imagenUrl = null,
  ubicacion = null,
  centroServicioId = null,
  tiempoEstimadoMinutos = null,
  distanciaCentroKm = null
) {
  return ReporteRepository.createVehiculo(
    codigoSAPVehiculo,
    numeroEmpleado,
    telefono,
    descripcion,
    imagenUrl,
    ubicacion,
    centroServicioId,
    tiempoEstimadoMinutos,
    distanciaCentroKm
  );
}

// ============================================================================
// FUNCIONES DE SESIÓN (delegadas a SesionRepository)
// ============================================================================

/**
 * Obtiene o crea una sesión de chat para un usuario
 * @param {string} telefono - Número de teléfono
 * @returns {Promise<Object>}
 */
async function getSession(telefono) {
  return SesionRepository.getSession(telefono);
}

/**
 * Obtiene sesión bypaseando el caché (lectura fresca desde BD)
 * Útil para evitar race conditions en operaciones críticas como recepción de ubicaciones
 * @param {string} telefono - Número de teléfono
 * @returns {Promise<Object>}
 */
async function getSessionFresh(telefono) {
  return SesionRepository.getSession(telefono, true);
}

/**
 * Obtiene sesión con versión para optimistic locking
 * SIEMPRE lee desde BD (no cache) para garantizar versión actualizada
 * @param {string} telefono - Número de teléfono
 * @returns {Promise<Object>} Sesión con campo Version
 */
async function getSessionWithVersion(telefono) {
  return SesionRepository.getSessionWithVersion(telefono);
}

/**
 * Actualiza el estado de una sesión
 * @param {string} telefono - Número de teléfono
 * @param {string} estado - Nuevo estado
 * @param {Object} datosTemp - Datos temporales (opcional)
 * @param {number} equipoIdTemp - ID de equipo temporal (opcional)
 * @param {string} origenAccion - Origen de la acción (opcional)
 * @param {string} descripcion - Descripción de la acción (opcional)
 * @param {number} reporteId - ID del reporte si se generó uno (opcional)
 */
async function updateSession(
  telefono,
  estado,
  datosTemp = null,
  equipoIdTemp = null,
  origenAccion = 'BOT',
  descripcion = null,
  reporteId = null
) {
  return SesionRepository.updateSession(
    telefono,
    estado,
    datosTemp,
    equipoIdTemp,
    origenAccion,
    descripcion,
    reporteId
  );
}

/**
 * Guarda un mensaje en el historial de chat
 * @param {string} telefono - Número de teléfono
 * @param {string} tipo - 'U' para usuario, 'B' para bot
 * @param {string} contenido - Contenido del mensaje
 * @param {string} tipoContenido - 'TEXTO', 'IMAGEN', 'BOTON', 'UBICACION'
 * @param {string} intencionDetectada - Intención detectada por IA (opcional)
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
 * Actualiza el contenido de un mensaje placeholder de imagen con la URL real
 * @param {string} telefono - Número de teléfono del usuario
 * @param {string} imageId - ID de la imagen de WhatsApp (para encontrar el placeholder)
 * @param {string} imagenUrl - URL real de la imagen subida a blob storage
 * @returns {Promise<boolean>} - true si se actualizó, false si no se encontró el placeholder
 */
async function updateImagePlaceholder(telefono, imageId, imagenUrl) {
  return SesionRepository.updateImagePlaceholder(telefono, imageId, imagenUrl);
}

/**
 * Verifica si un usuario está haciendo spam
 * @param {string} telefono - Número de teléfono
 * @returns {Promise<{esSpam: boolean, totalMensajes: number, razon: string}>}
 */
async function checkSpam(telefono) {
  return SesionRepository.checkSpam(telefono);
}

/**
 * Registra actividad del usuario (resetea advertencia de timeout)
 * @param {string} telefono - Número de teléfono
 */
async function updateLastActivity(telefono) {
  return SesionRepository.updateLastActivity(telefono);
}

// ============================================================================
// FUNCIONES DE ADMINISTRACIÓN DE CACHÉ (para compatibilidad)
// ============================================================================

/**
 * Limpia el caché de equipos
 * @param {string} codigoSAP - Código SAP específico (opcional)
 * @returns {boolean|number}
 */
function clearEquipoCache(codigoSAP = null) {
  if (codigoSAP) {
    EquipoRepository.invalidateCache(codigoSAP);
    return true;
  }
  return EquipoRepository.clearCache();
}

/**
 * Limpia el caché de sesiones
 * @param {string} telefono - Teléfono específico (opcional)
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
 * Obtiene estadísticas de los cachés
 * @returns {Object}
 */
function getCacheStats() {
  return {
    equipos: EquipoRepository.getCacheStats(),
    sesiones: SesionRepository.getCacheStats(),
    reportes: ReporteRepository.getCacheStats(),
  };
}

/**
 * Inicia la limpieza automática de cachés
 * (Ya se inicia automáticamente en los repositorios)
 */
function startCacheCleanup() {
  // Los repositorios ya manejan esto internamente
  logger.debug('Los repositorios manejan la limpieza de caché internamente');
}

/**
 * Detiene la limpieza automática de cachés
 */
function stopCacheCleanup() {
  SesionRepository.stopCacheCleanup();
  EquipoRepository.stopCacheCleanup();
  ReporteRepository.stopCacheCleanup();
}

// ============================================================================
// FUNCIONES NUEVAS (aprovechando los repositorios)
// ============================================================================

/**
 * Obtiene un reporte por número de ticket
 * @param {string} numeroTicket - Número de ticket
 * @returns {Promise<Object|null>}
 */
async function getReporteByTicket(numeroTicket) {
  return ReporteRepository.getByTicket(numeroTicket);
}

/**
 * Obtiene reportes de un usuario por teléfono
 * @param {string} telefono - Teléfono del reportante
 * @param {number} limit - Límite de resultados
 * @returns {Promise<Array>}
 */
async function getReportesByTelefono(telefono, limit = 10) {
  return ReporteRepository.getByTelefono(telefono, limit);
}

/**
 * Actualiza el estado de un reporte
 * @param {string} numeroTicket - Número de ticket
 * @param {string} nuevoEstado - Nuevo estado
 * @returns {Promise<boolean>}
 */
async function updateReporteEstado(numeroTicket, nuevoEstado) {
  return ReporteRepository.updateEstado(numeroTicket, nuevoEstado);
}

/**
 * Busca equipos por patrón de SAP (para autocompletado)
 * @param {string} pattern - Patrón de búsqueda
 * @param {number} limit - Límite de resultados
 * @returns {Promise<Array>}
 */
async function searchEquiposBySAP(pattern, limit = 10) {
  return EquipoRepository.searchBySAP(pattern, limit);
}

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
 * Marca una sesión como advertida
 * @param {string} telefono - Número de teléfono
 */
async function markSessionWarningSet(telefono) {
  return SesionRepository.markWarningSet(telefono);
}

/**
 * Actualiza el nombre de usuario de WhatsApp en la sesión
 * @param {string} telefono - Número de teléfono
 * @param {string} nombreUsuario - Nombre de perfil de WhatsApp
 */
async function updateUserName(telefono, nombreUsuario) {
  return SesionRepository.updateUserName(telefono, nombreUsuario);
}

// ============================================================================
// EXPORTACIÓN
// ============================================================================

module.exports = {
  // Funciones de equipo
  getEquipoBySAP,
  getEquipoById,
  searchEquiposBySAP,

  // Funciones de reporte
  createReporte,
  createReporteVehiculo,
  getReporteByTicket,
  getReportesByTelefono,
  updateReporteEstado,

  // Funciones de sesión
  getSession,
  getSessionFresh,
  getSessionWithVersion,
  updateSession,
  updateLastActivity,
  saveMessage,
  updateImagePlaceholder,
  checkSpam,
  getSessionsNeedingWarning,
  getSessionsToClose,
  markSessionWarningSet,
  updateUserName,

  // Funciones de deduplicación
  registerMessageAtomic: (messageId, telefono) =>
    SesionRepository.registerMessageAtomic(messageId, telefono),
  isMessageProcessed: (messageId) => SesionRepository.isMessageProcessed(messageId), // Deprecated
  cleanOldProcessedMessages: () => SesionRepository.cleanOldProcessedMessages(),

  // Funciones de administración de caché
  clearEquipoCache,
  clearSessionCache,
  getCacheStats,
  startCacheCleanup,
  stopCacheCleanup,

  // Acceso directo a repositorios (para uso avanzado)
  repositories: {
    sesiones: SesionRepository,
    equipos: EquipoRepository,
    reportes: ReporteRepository,
  },
};
