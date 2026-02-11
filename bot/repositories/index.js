/**
 * SIGN BOT - Repositories Index
 * Exporta todos los repositorios para acceso centralizado
 */

const SesionRepository = require('./SesionRepository');
const DocumentoFirmaRepository = require('./DocumentoFirmaRepository');
const EventoDocuSignRepository = require('./EventoDocuSignRepository');

module.exports = {
  // Repositorios
  SesionRepository,
  DocumentoFirmaRepository,
  EventoDocuSignRepository,

  // Alias convenientes
  sesiones: SesionRepository,
  documentos: DocumentoFirmaRepository,
  eventosDocuSign: EventoDocuSignRepository,

  /**
   * Obtiene estadisticas de todos los caches
   */
  getCacheStats() {
    return {
      sesiones: SesionRepository.getCacheStats(),
      documentos: DocumentoFirmaRepository.getCacheStats(),
      eventosDocuSign: EventoDocuSignRepository.getCacheStats(),
    };
  },

  /**
   * Limpia todos los caches
   */
  clearAllCaches() {
    return {
      sesiones: SesionRepository.clearCache(),
      documentos: DocumentoFirmaRepository.clearCache(),
      eventosDocuSign: EventoDocuSignRepository.clearCache(),
    };
  },

  /**
   * Detiene todos los intervalos de limpieza (para shutdown)
   */
  stopAllCleanup() {
    SesionRepository.stopCacheCleanup();
    DocumentoFirmaRepository.stopCacheCleanup();
    EventoDocuSignRepository.stopCacheCleanup();
  },
};
