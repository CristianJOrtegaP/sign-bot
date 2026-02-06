/**
 * Handler: Cache Management
 * Rutas: GET/POST /api/admin/cache?type=...
 *
 * Autenticación: Azure Function Keys (validado automáticamente por Azure)
 */

const db = require('../../core/services/storage/databaseService');
const sessionTimeoutService = require('../../core/services/processing/sessionTimeoutService');
const { applySecurityHeaders } = require('../../core/middleware/securityHeaders');
const audit = require('../../core/services/infrastructure/auditService');

module.exports = async function cacheHandler(context, req) {
  // Autenticación: Azure valida Function Key antes de llegar aquí
  // Si este código se ejecuta, la key ya es válida

  try {
    const type = req.query.type || req.body?.type;
    const codigo = req.query.codigo || req.body?.codigo;
    const telefono = req.query.telefono || req.body?.telefono;

    const result = {
      success: true,
      timestamp: new Date().toISOString(),
      action: '',
      details: {},
    };

    switch (type) {
      case 'equipos':
        if (codigo) {
          const deleted = db.clearEquipoCache(codigo);
          result.action = 'clear_single_equipo';
          result.details = {
            codigo,
            found_and_deleted: deleted,
            message: deleted
              ? `Cache del equipo ${codigo} limpiado exitosamente`
              : `El equipo ${codigo} no estaba en cache`,
          };
        } else {
          const count = db.clearEquipoCache();
          result.action = 'clear_all_equipos';
          result.details = {
            entries_deleted: count,
            message: `${count} equipos eliminados del cache`,
          };
        }
        break;

      case 'sesiones':
        if (telefono) {
          const deleted = db.clearSessionCache(telefono);
          result.action = 'clear_single_session';
          result.details = {
            telefono,
            found_and_deleted: deleted,
            message: deleted
              ? `Cache de la sesion ${telefono} limpiado exitosamente`
              : `La sesion ${telefono} no estaba en cache`,
          };
        } else {
          const count = db.clearSessionCache();
          result.action = 'clear_all_sessions';
          result.details = {
            entries_deleted: count,
            message: `${count} sesiones eliminadas del cache`,
          };
        }
        break;

      case 'all': {
        const equiposCount = db.clearEquipoCache();
        const sesionesCount = db.clearSessionCache();
        result.action = 'clear_all_cache';
        result.details = {
          equipos_deleted: equiposCount,
          sesiones_deleted: sesionesCount,
          total_deleted: equiposCount + sesionesCount,
          message: `Cache limpiado: ${equiposCount} equipos + ${sesionesCount} sesiones`,
        };
        break;
      }

      case 'stats': {
        const stats = db.getCacheStats();
        result.action = 'get_stats';
        result.details = stats;
        break;
      }

      case 'trigger_timeout': {
        const timeoutStats = await sessionTimeoutService.processExpiredSessions();
        result.action = 'trigger_timeout';
        result.details = timeoutStats;
        break;
      }

      default:
        context.res = {
          status: 400,
          headers: applySecurityHeaders({ 'Content-Type': 'application/json' }),
          body: {
            success: false,
            error: 'Tipo de operación no válido',
            available_types: ['equipos', 'sesiones', 'all', 'stats', 'trigger_timeout'],
            examples: [
              'GET /api/admin/cache?type=equipos&codigo=4045101',
              'GET /api/admin/cache?type=sesiones&telefono=5218...',
              'GET /api/admin/cache?type=all',
              'GET /api/admin/cache?type=stats',
              'POST /api/admin/cache?type=trigger_timeout',
            ],
          },
        };
        return;
    }

    context.log('Cache operation:', result.action);
    audit.logCacheClear(type, result.details, req);

    context.res = {
      status: 200,
      headers: applySecurityHeaders({ 'Content-Type': 'application/json' }),
      body: result,
    };
  } catch (error) {
    context.log.error('Error en cache handler:', error);
    context.res = {
      status: 500,
      headers: applySecurityHeaders({ 'Content-Type': 'application/json' }),
      body: {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      },
    };
  }
};
