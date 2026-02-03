/**
 * AC FIXBOT - Funcion Administrativa de Limpieza de Cache
 * Permite limpiar el cache de equipos y sesiones manualmente
 *
 * Autenticacion: Requiere header X-API-Key o query param apiKey
 *
 * Endpoints:
 * - GET/POST /api/admin-cache?type=equipos&codigo=4045101  (Limpiar equipo especifico)
 * - GET/POST /api/admin-cache?type=equipos                  (Limpiar todos los equipos)
 * - GET/POST /api/admin-cache?type=sesiones&telefono=5218... (Limpiar sesion especifica)
 * - GET/POST /api/admin-cache?type=sesiones                 (Limpiar todas las sesiones)
 * - GET/POST /api/admin-cache?type=all                      (Limpiar todo)
 * - GET/POST /api/admin-cache?type=stats                    (Ver estadisticas del cache)
 */

const db = require('../core/services/storage/databaseService');
const sessionTimeoutService = require('../core/services/processing/sessionTimeoutService');
const security = require('../core/services/infrastructure/securityService');
const { applySecurityHeaders } = require('../core/middleware/securityHeaders');
const audit = require('../core/services/infrastructure/auditService');

module.exports = async function (context, req) {
    context.log('Solicitud de administracion de cache recibida');

    // Verificar autenticacion
    const authResult = security.verifyAdminApiKey(req);
    if (!authResult.valid) {
        context.log.warn('Acceso denegado a endpoint admin:', authResult.error);
        audit.logAuthFailure(authResult.error, req);
        context.res = {
            status: 401,
            headers: applySecurityHeaders({ 'Content-Type': 'application/json' }),
            body: {
                success: false,
                error: authResult.error,
                timestamp: new Date().toISOString()
            }
        };
        return;
    }

    try {
        const type = req.query.type || req.body?.type;
        const codigo = req.query.codigo || req.body?.codigo;
        const telefono = req.query.telefono || req.body?.telefono;

        const result = {
            success: true,
            timestamp: new Date().toISOString(),
            action: '',
            details: {}
        };

        // Verificar tipo de operacion
        switch (type) {
            case 'equipos':
                if (codigo) {
                    // Limpiar equipo especifico
                    const deleted = db.clearEquipoCache(codigo);
                    result.action = 'clear_single_equipo';
                    result.details = {
                        codigo: codigo,
                        found_and_deleted: deleted,
                        message: deleted
                            ? `Cache del equipo ${codigo} limpiado exitosamente`
                            : `El equipo ${codigo} no estaba en cache`
                    };
                } else {
                    // Limpiar todos los equipos
                    const count = db.clearEquipoCache();
                    result.action = 'clear_all_equipos';
                    result.details = {
                        entries_deleted: count,
                        message: `${count} equipos eliminados del cache`
                    };
                }
                break;

            case 'sesiones':
                if (telefono) {
                    // Limpiar sesion especifica
                    const deleted = db.clearSessionCache(telefono);
                    result.action = 'clear_single_session';
                    result.details = {
                        telefono: telefono,
                        found_and_deleted: deleted,
                        message: deleted
                            ? `Cache de la sesion ${telefono} limpiado exitosamente`
                            : `La sesion ${telefono} no estaba en cache`
                    };
                } else {
                    // Limpiar todas las sesiones
                    const count = db.clearSessionCache();
                    result.action = 'clear_all_sessions';
                    result.details = {
                        entries_deleted: count,
                        message: `${count} sesiones eliminadas del cache`
                    };
                }
                break;

            case 'all': {
                // Limpiar todo
                const equiposCount = db.clearEquipoCache();
                const sesionesCount = db.clearSessionCache();
                result.action = 'clear_all_cache';
                result.details = {
                    equipos_deleted: equiposCount,
                    sesiones_deleted: sesionesCount,
                    total_deleted: equiposCount + sesionesCount,
                    message: `Cache completamente limpiado: ${equiposCount} equipos + ${sesionesCount} sesiones`
                };
                break;
            }

            case 'stats': {
                // Obtener estadisticas
                const stats = db.getCacheStats();
                result.action = 'get_stats';
                result.details = stats;
                break;
            }

            case 'trigger_timeout': {
                // Ejecutar manualmente la limpieza de sesiones (util para testing)
                const timeoutStats = await sessionTimeoutService.processExpiredSessions();
                result.action = 'trigger_timeout';
                result.details = timeoutStats;
                break;
            }

            default:
                result.success = false;
                result.error = 'Tipo de operacion no valido';
                result.available_types = ['equipos', 'sesiones', 'all', 'stats', 'trigger_timeout'];
                result.examples = [
                    'GET /api/adminClearCache?type=equipos&codigo=4045101',
                    'GET /api/adminClearCache?type=equipos',
                    'GET /api/adminClearCache?type=sesiones&telefono=5218112345001',
                    'GET /api/adminClearCache?type=sesiones',
                    'GET /api/adminClearCache?type=all',
                    'GET /api/adminClearCache?type=stats',
                    'GET /api/adminClearCache?type=trigger_timeout'
                ];
                context.res = {
                    status: 400,
                    headers: applySecurityHeaders({ 'Content-Type': 'application/json' }),
                    body: result
                };
                return;
        }

        context.log('Operacion de cache completada:', result.action);

        // Audit log para operaciones exitosas
        audit.logCacheClear(type, result.details, req);

        context.res = {
            status: 200,
            headers: applySecurityHeaders({ 'Content-Type': 'application/json' }),
            body: result
        };

    } catch (error) {
        context.log.error('Error en funcion administrativa:', error);
        context.res = {
            status: 500,
            headers: applySecurityHeaders({ 'Content-Type': 'application/json' }),
            body: {
                success: false,
                error: error.message,
                timestamp: new Date().toISOString()
            }
        };
    }
};
