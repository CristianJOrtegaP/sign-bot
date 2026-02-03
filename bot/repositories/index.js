/**
 * AC FIXBOT - Repositories Index
 * Exporta todos los repositorios para acceso centralizado
 */

const SesionRepository = require('./SesionRepository');
const EquipoRepository = require('./EquipoRepository');
const ReporteRepository = require('./ReporteRepository');
const EncuestaRepository = require('./EncuestaRepository');
const CentroServicioRepository = require('./CentroServicioRepository');

module.exports = {
    // Repositorios
    SesionRepository,
    EquipoRepository,
    ReporteRepository,
    EncuestaRepository,
    CentroServicioRepository,

    // Alias convenientes
    sesiones: SesionRepository,
    equipos: EquipoRepository,
    reportes: ReporteRepository,
    encuestas: EncuestaRepository,
    centrosServicio: CentroServicioRepository,

    /**
     * Obtiene estadísticas de todos los cachés
     */
    getCacheStats() {
        return {
            sesiones: SesionRepository.getCacheStats(),
            equipos: EquipoRepository.getCacheStats(),
            reportes: ReporteRepository.getCacheStats(),
            encuestas: EncuestaRepository.getCacheStats(),
            centrosServicio: CentroServicioRepository.getCacheStats()
        };
    },

    /**
     * Limpia todos los cachés
     */
    clearAllCaches() {
        return {
            sesiones: SesionRepository.clearCache(),
            equipos: EquipoRepository.clearCache(),
            reportes: ReporteRepository.clearCache(),
            encuestas: EncuestaRepository.clearCache(),
            centrosServicio: CentroServicioRepository.clearCache()
        };
    },

    /**
     * Detiene todos los intervalos de limpieza (para shutdown)
     */
    stopAllCleanup() {
        SesionRepository.stopCacheCleanup();
        EquipoRepository.stopCacheCleanup();
        ReporteRepository.stopCacheCleanup();
        EncuestaRepository.stopCacheCleanup();
        CentroServicioRepository.stopCacheCleanup();
    }
};
